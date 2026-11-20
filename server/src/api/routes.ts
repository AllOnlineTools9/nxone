import { and, desc, eq, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import type { RouteContext } from "../http/context";
import { json, problem, rateLimit } from "../http/respond";
import { can } from "../team/seats";
import { dispatch, attempt } from "../webhooks/deliver";
import { EVENTS, checkUrl, eventsFrom, newSecret, type WebhookEvent } from "../webhooks/sign";
import { buildInvoice, documentView, type SellerProfile } from "./build";
import { hashKey, keyFrom, newApiKey } from "./keys";

/**
 * The public API (/v1) and the screen that manages it (/integrations).
 *
 * The API writes the same records the app syncs, so an invoice made through it arrives on the
 * business's devices like one made on another phone. Webhooks fire from here and from sync, so
 * a change made in the app and one made through the API are announced the same way.
 */

const MAX_KEYS = 10;
const MAX_HOOKS = 5;
const PER_MINUTE = 120;

/** The API is part of the Business plan; a trial includes it so it can be tried. */
const apiIncluded = (p: { plan: { id: string }; trialing: boolean } | null) => Boolean(p && (p.plan.id === "business" || p.trialing));

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

export async function apiRoutes(c: RouteContext): Promise<Response | null> {
  if (c.url.pathname.startsWith("/v1/")) return v1(c);
  if (c.url.pathname === "/integrations" || c.url.pathname.startsWith("/integrations/")) return integrations(c);
  return null;
}

/* =================================================================== /v1 */

async function v1(c: RouteContext): Promise<Response> {
  const { req, url, db, env } = c;
  const fail = (status: number, message: string, field?: string) =>
    c.reply(json({ error: { status, message, ...(field ? { field } : {}) } }, { status }));

  const key = keyFrom(req);
  if (!key) return fail(401, "Send your API key as: Authorization: Bearer nx_live_...");
  const row = (await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.keyHash, await hashKey(key))).limit(1))[0];
  if (!row || row.revokedAt) return fail(401, "That API key is not valid, or was revoked.");
  const orgId = row.orgId;

  if (!apiIncluded(await c.planOf(orgId))) return fail(402, "The API is part of the Business plan.");
  if (!(await rateLimit(env.SESSIONS, `api:${row.id}`, PER_MINUTE, 60_000))) return fail(429, `Up to ${PER_MINUTE} requests a minute. Wait a moment and try again.`);
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 10 * 60_000) {
    c.waitUntil(db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.id)));
  }

  // A retried request with the same Idempotency-Key gets the first answer, not a second invoice.
  const idem = req.method === "POST" ? req.headers.get("Idempotency-Key")?.slice(0, 100) : undefined;
  if (idem) {
    const earlier = await env.SESSIONS.get(`idem:${orgId}:${idem}`);
    if (earlier) {
      const { status, body } = JSON.parse(earlier) as { status: number; body: unknown };
      return c.reply(json(body, { status, headers: { "Idempotent-Replay": "true" } }));
    }
  }
  const answer = async (body: unknown, status = 200) => {
    if (idem && status < 500) await env.SESSIONS.put(`idem:${orgId}:${idem}`, JSON.stringify({ status, body }), { expirationTtl: 86_400 });
    return c.reply(json(body, { status }));
  };

  const path = url.pathname.replace(/\/+$/, "");
  const records = (kind: string) => and(eq(schema.records.orgId, orgId), eq(schema.records.kind, kind as "document"), isNull(schema.records.deletedAt));
  const profileRow = async () => (await db.select().from(schema.records).where(records("profile")).limit(1))[0];
  const announce = (happenings: Array<{ event: WebhookEvent; kind: string; body: Record<string, unknown> }>) =>
    c.waitUntil(dispatch(db, c.uid, orgId, happenings));

  /* ---------- the business ---------- */
  if (path === "/v1/me" && req.method === "GET") {
    const p = JSON.parse((await profileRow())?.body ?? "{}") as SellerProfile;
    return c.reply(json({ business: { name: p.name ?? null, country: p.country ?? null, currency: p.currency ?? null, taxId: p.taxId ?? null }, key: { name: row.name, prefix: row.prefix } }));
  }

  /* ---------- documents ---------- */
  if (path === "/v1/documents" && req.method === "GET") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const kind = url.searchParams.get("kind");
    const status = url.searchParams.get("status");
    const since = Date.parse(url.searchParams.get("updated_since") ?? "") || 0;
    const rows = await env.DB.prepare(
      `SELECT body FROM records WHERE org_id = ?3 AND kind = 'document' AND deleted_at IS NULL
       AND (?1 IS NULL OR json_extract(body, '$.kind') = ?1) AND (?2 IS NULL OR json_extract(body, '$.status') = ?2)
       AND updated_at > ?4 ORDER BY updated_at DESC LIMIT ?5 OFFSET ?6`
    ).bind(kind, status, orgId, since, limit + 1, offset).all<{ body: string }>();
    const list = (rows.results ?? []).map((r) => documentView(JSON.parse(r.body)));
    return c.reply(json({ data: list.slice(0, limit), hasMore: list.length > limit, nextOffset: offset + limit }));
  }

  const docMatch = path.match(/^\/v1\/documents\/([A-Za-z0-9_-]{3,60})(\/payments)?$/);
  if (docMatch) {
    const found = (await db.select().from(schema.records).where(and(records("document"), eq(schema.records.localId, docMatch[1]))).limit(1))[0];
    if (!found) return fail(404, "No document with that id.");
    const body = JSON.parse(found.body) as Record<string, unknown>;

    if (!docMatch[2] && req.method === "GET") return c.reply(json({ data: documentView(body) }));

    if (docMatch[2] && req.method === "POST") {
      const input = (await req.json().catch(() => ({}))) as { amount?: unknown; date?: unknown };
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount <= 0) return fail(400, "amount must be more than 0.", "amount");
      const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toISOString().slice(0, 10);
      if (body.kind !== "invoice" || body.status === "draft" || body.status === "cancelled") return fail(409, "Payments can only be recorded against a sent invoice.");
      const p = JSON.parse((await profileRow())?.body ?? "{}") as SellerProfile;
      if (p.lockedUpTo && date <= p.lockedUpTo) return fail(409, `The books are closed up to ${p.lockedUpTo}.`, "date");

      const total = Number(body.totalMinor ?? 0);
      const paid = Math.min(total, Number(body.paidMinor ?? 0) + Math.round(amount * 100));
      const status = paid >= total ? "paid" : "partly-paid";
      const now = new Date();
      const next = { ...body, paidMinor: paid, status, paidOn: date, updatedAt: now.toISOString(), version: found.version + 1 };
      await db.update(schema.records).set({ body: JSON.stringify(next), version: found.version + 1, updatedAt: now })
        .where(eq(schema.records.id, found.id));
      await c.audit({ orgId, action: "api.payment", summary: `${body.number}: ${amount} recorded through the API (${row.name})` });
      announce([
        { event: "document.updated", kind: "document", body: next },
        ...(status === "paid" && body.status !== "paid" ? [{ event: "document.paid" as const, kind: "document", body: next }] : [])
      ]);
      return answer({ data: documentView(next) });
    }
    return fail(405, "That method is not allowed here.");
  }

  /* ---------- making an invoice ---------- */
  if (path === "/v1/invoices" && req.method === "POST") {
    const pRow = await profileRow();
    if (!pRow) return fail(409, "Set up the business in NXOne first: its name, address and tax number go on every invoice.");
    const profile = JSON.parse(pRow.body) as SellerProfile & Record<string, unknown>;
    const used = await env.DB.prepare(
      `SELECT json_extract(body, '$.number') AS n FROM records WHERE org_id = ? AND kind = 'document' AND deleted_at IS NULL AND json_extract(body, '$.kind') = 'invoice'`
    ).bind(orgId).all<{ n: string }>();
    const usedNumbers = (used.results ?? []).map((r) => r.n).filter(Boolean);

    const input = await req.json().catch(() => null);
    if (!input || typeof input !== "object") return fail(400, "Send the invoice as JSON.");
    const built = buildInvoice(input, profile, { today: new Date().toISOString().slice(0, 10), usedNumbers });
    if (!built.ok) return fail(400, built.says, built.field);

    const now = new Date();
    const id = newId("dc");
    const saved = {
      id, kind: "invoice", number: built.doc.number, clientName: built.doc.buyer.name, issueDate: built.doc.issueDate,
      dueDate: built.doc.dueDate, currency: built.doc.currency, totalMinor: built.totalMinor, paidMinor: 0,
      status: built.status, doc: built.doc, createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 1
    };
    await db.insert(schema.records).values({ id: c.uid("re"), orgId, kind: "document", localId: id, body: JSON.stringify(saved), version: 1, updatedAt: now, deletedAt: null, updatedBy: null });

    // The series moves on, so the next invoice made in the app does not take the same number.
    const nextProfile = { ...profile, nextNumbers: { ...(profile.nextNumbers ?? {}), invoice: built.nextNumber }, updatedAt: now.toISOString(), version: pRow.version + 1 };
    await db.update(schema.records).set({ body: JSON.stringify(nextProfile), version: pRow.version + 1, updatedAt: now }).where(eq(schema.records.id, pRow.id));

    // Remember the customer, as saving in the app does.
    const happenings: Array<{ event: WebhookEvent; kind: string; body: Record<string, unknown> }> = [{ event: "document.created", kind: "document", body: saved }];
    const buyer = built.doc.buyer;
    const clients = await db.select({ body: schema.records.body }).from(schema.records).where(records("client"));
    const known = clients.some((r) => {
      const b = JSON.parse(r.body) as { name?: string; taxId?: string };
      return (buyer.taxId && b.taxId === buyer.taxId) || (b.name ?? "").trim().toLowerCase() === buyer.name.trim().toLowerCase();
    });
    if (!known) {
      const cid = newId("cl");
      const client = { id: cid, name: buyer.name, email: buyer.email, phone: buyer.phone, taxId: buyer.taxId, address: buyer.address, region: buyer.region, createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 1 };
      await db.insert(schema.records).values({ id: c.uid("re"), orgId, kind: "client", localId: cid, body: JSON.stringify(client), version: 1, updatedAt: now, deletedAt: null, updatedBy: null });
      happenings.push({ event: "customer.created", kind: "client", body: client });
    }

    await c.audit({ orgId, action: "api.invoice", summary: `${saved.number} created through the API (${row.name})` });
    announce(happenings);
    return answer({ data: documentView(saved) }, 201);
  }

  /* ---------- customers ---------- */
  if (path === "/v1/customers" && req.method === "GET") {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const rows = await db.select({ body: schema.records.body }).from(schema.records).where(records("client"))
      .orderBy(desc(schema.records.updatedAt)).limit(limit + 1).offset(offset);
    const list = rows.map((r) => {
      const b = JSON.parse(r.body) as Record<string, unknown>;
      return { id: b.id, name: b.name, email: b.email ?? null, phone: b.phone ?? null, taxId: b.taxId ?? null, address: b.address ?? null, region: b.region ?? null };
    });
    return c.reply(json({ data: list.slice(0, limit), hasMore: list.length > limit, nextOffset: offset + limit }));
  }

  if (path === "/v1/customers" && req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const s = (k: string, max: number) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : undefined);
    const name = s("name", 120);
    if (!name) return fail(400, "name is needed.", "name");
    const now = new Date();
    const id = newId("cl");
    const client = {
      id, name, email: s("email", 200), phone: s("phone", 30), taxId: s("taxId", 20)?.toUpperCase(), address: s("address", 500),
      region: s("region", 10)?.toUpperCase(), createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 1
    };
    await db.insert(schema.records).values({ id: c.uid("re"), orgId, kind: "client", localId: id, body: JSON.stringify(client), version: 1, updatedAt: now, deletedAt: null, updatedBy: null });
    announce([{ event: "customer.created", kind: "client", body: client }]);
    return answer({ data: { id, name: client.name, email: client.email ?? null, phone: client.phone ?? null, taxId: client.taxId ?? null, address: client.address ?? null, region: client.region ?? null } }, 201);
  }

  return fail(404, "There is no such endpoint. See https://nxone.io/developers/");
}

/* ========================================================= /integrations */

async function integrations(c: RouteContext): Promise<Response> {
  const { req, url, db } = c;
  const found = await c.session();
  if (!found?.session.orgId) return c.reply(problem(401, "Not signed in."));
  const orgId = found.session.orgId;
  const member = await c.membership(found.session.userId, orgId);
  if (!member || !can(member.role).manageTeam) return c.reply(problem(403, "Only an owner or a manager can manage the API and webhooks."));
  const plan = await c.planOf(orgId);
  const allowed = apiIncluded(plan);

  const view = async () => {
    const keys = await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt)));
    const hooks = await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.orgId, orgId), isNull(schema.webhooks.revokedAt)));
    return {
      allowed, plan: plan?.plan.name ?? "Free", events: EVENTS,
      keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt.getTime(), lastUsedAt: k.lastUsedAt?.getTime() ?? null })),
      webhooks: hooks.map((h) => ({ id: h.id, url: h.url, events: JSON.parse(h.events) as string[], secretEnd: h.secret.slice(-4), createdAt: h.createdAt.getTime() }))
    };
  };

  if (url.pathname === "/integrations" && req.method === "GET") return c.reply(json(await view()));
  if (req.method !== "POST" && !url.pathname.endsWith("/deliveries")) return c.reply(problem(405, "That method is not allowed here."));
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const needPlan = () => c.reply(problem(402, "The API and webhooks are part of the Business plan."));

  if (url.pathname === "/integrations/keys") {
    if (!allowed) return needPlan();
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (!name) return c.reply(problem(400, "Give the key a name, such as the website that will use it."));
    const live = await db.select({ id: schema.apiKeys.id }).from(schema.apiKeys).where(and(eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt)));
    if (live.length >= MAX_KEYS) return c.reply(problem(409, `A business can have up to ${MAX_KEYS} keys. Revoke one you no longer use.`));
    const { key, prefix } = newApiKey();
    await db.insert(schema.apiKeys).values({ id: c.uid("ak"), orgId, name, prefix, keyHash: await hashKey(key), createdBy: found.session.userId, createdAt: new Date(), lastUsedAt: null, revokedAt: null });
    await c.audit({ orgId, userId: found.session.userId, action: "api.key-created", summary: name });
    return c.reply(json({ key, ...(await view()) }));
  }

  if (url.pathname === "/integrations/keys/revoke") {
    const id = String(body.id ?? "");
    await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, orgId)));
    await c.audit({ orgId, userId: found.session.userId, action: "api.key-revoked", summary: id });
    return c.reply(json(await view()));
  }

  if (url.pathname === "/integrations/webhooks") {
    if (!allowed) return needPlan();
    const checked = checkUrl(body.url);
    if (!checked.ok) return c.reply(problem(400, checked.says));
    const live = await db.select({ id: schema.webhooks.id }).from(schema.webhooks).where(and(eq(schema.webhooks.orgId, orgId), isNull(schema.webhooks.revokedAt)));
    if (live.length >= MAX_HOOKS) return c.reply(problem(409, `A business can have up to ${MAX_HOOKS} webhooks.`));
    const secret = newSecret();
    await db.insert(schema.webhooks).values({ id: c.uid("wh"), orgId, url: checked.url, secret, events: JSON.stringify(eventsFrom(body.events)), createdBy: found.session.userId, createdAt: new Date(), revokedAt: null });
    await c.audit({ orgId, userId: found.session.userId, action: "api.webhook-added", summary: checked.url });
    return c.reply(json({ secret, ...(await view()) }));
  }

  if (url.pathname === "/integrations/webhooks/remove") {
    await db.update(schema.webhooks).set({ revokedAt: new Date() }).where(and(eq(schema.webhooks.id, String(body.id ?? "")), eq(schema.webhooks.orgId, orgId)));
    return c.reply(json(await view()));
  }

  const hookFor = async (id: string) =>
    (await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, orgId), isNull(schema.webhooks.revokedAt))).limit(1))[0];

  if (url.pathname === "/integrations/webhooks/test") {
    const hook = await hookFor(String(body.id ?? ""));
    if (!hook) return c.reply(problem(404, "No such webhook."));
    const id = c.uid("wd");
    const payload = JSON.stringify({ id, event: "ping", createdAt: new Date().toISOString(), data: { message: "A test from NXOne. If you can read this, the webhook works." } });
    await db.insert(schema.webhookDeliveries).values({ id, webhookId: hook.id, event: "ping", payload, status: null, ok: false, attempts: 0, error: null, createdAt: new Date(), deliveredAt: null });
    const ok = await attempt(db, hook, id, "ping", payload);
    const row = (await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, id)).limit(1))[0];
    return c.reply(json({ ok, status: row?.status ?? null, error: row?.error ?? null }));
  }

  if (url.pathname === "/integrations/webhooks/deliveries") {
    const hook = await hookFor(url.searchParams.get("id") ?? "");
    if (!hook) return c.reply(problem(404, "No such webhook."));
    const rows = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, hook.id))
      .orderBy(desc(schema.webhookDeliveries.createdAt)).limit(25);
    return c.reply(json({
      deliveries: rows.map((d) => ({ id: d.id, event: d.event, ok: d.ok, status: d.status, attempts: d.attempts, error: d.error, createdAt: d.createdAt.getTime() }))
    }));
  }

  if (url.pathname === "/integrations/webhooks/redeliver") {
    const delivery = (await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, String(body.id ?? ""))).limit(1))[0];
    const hook = delivery ? await hookFor(delivery.webhookId) : undefined;
    if (!delivery || !hook) return c.reply(problem(404, "No such delivery."));
    const ok = await attempt(db, hook, delivery.id, delivery.event, delivery.payload);
    return c.reply(json({ ok }));
  }

  return c.reply(problem(404, "There is nothing here."));
}
