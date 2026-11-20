import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { hashToken, isEmail, normaliseEmail, randomToken } from "../auth/tokens";
import * as schema from "../db/schema";
import type { RouteContext } from "../http/context";
import { json, problem, rateLimit } from "../http/respond";
import { can } from "../team/seats";
import {
  DAILY_REQUESTS, REQUEST_TTL_MS, cleanLine, grantedEmail, profileSummary, requestEmail, requestState
} from "./requests";

/**
 * The practice: one sign-in for an accountant who looks after many businesses.
 *
 * Access is always given by the business, never taken. An accountant asks by email; the owner
 * opens the link, signs in, and says yes, which adds the accountant to that business as an
 * accountant seat: able to see and export, unable to change or send. Accountant seats are free
 * on every plan, so saying yes never costs the business anything.
 *
 * The client list reads each business's books from the server copy, without touching the
 * accountant's own business on their device.
 */

const PAGE = 500;

export async function practiceRoutes(c: RouteContext): Promise<Response | null> {
  const { url, req, db } = c;
  if (!url.pathname.startsWith("/practice/")) return null;

  /* ---------- what a request link is, before anyone signs in ---------- */
  if (url.pathname === "/practice/request-info" && req.method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    if (token.length < 20) return c.reply(problem(404, "That link is not complete. Open it from the email again."));
    const row = (await db.select().from(schema.accessRequests).where(eq(schema.accessRequests.tokenHash, await hashToken(token))).limit(1))[0];
    if (!row) return c.reply(problem(404, "That link is not valid, or a newer one was sent."));
    const from = (await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.requesterId)).limit(1))[0];
    return c.reply(json({ from: from?.email ?? "An accountant", businessName: row.businessName, note: row.note, state: requestState(row) }));
  }

  /* ---------- saying no, with only the link ---------- */
  if (url.pathname === "/practice/decline" && req.method === "POST") {
    const { token } = (await req.json().catch(() => ({}))) as { token?: string };
    if (!token) return c.reply(problem(400, "No link was sent."));
    const row = (await db.select().from(schema.accessRequests).where(eq(schema.accessRequests.tokenHash, await hashToken(token))).limit(1))[0];
    if (!row || requestState(row) !== "pending") return c.reply(json({ ok: true }));
    await db.update(schema.accessRequests).set({ declinedAt: new Date() }).where(eq(schema.accessRequests.id, row.id));
    return c.reply(json({ ok: true }));
  }

  const found = await c.session();
  if (!found) return c.reply(problem(401, "Not signed in."));
  const me = found.session;

  /* ---------- every business this person can see ---------- */
  if (url.pathname === "/practice/clients" && req.method === "GET") {
    const mine = await db.select({ orgId: schema.memberships.orgId, role: schema.memberships.role })
      .from(schema.memberships).where(eq(schema.memberships.userId, me.userId));
    if (!mine.length) return c.reply(json({ clients: [] }));
    const ids = mine.map((m) => m.orgId);

    const orgs = await db.select().from(schema.organisations).where(inArray(schema.organisations.id, ids));
    const marks = ids.map(() => "?").join(",");
    const stats = await c.env.DB.prepare(
      `SELECT org_id, kind, COUNT(*) AS n, MAX(updated_at) AS last FROM records
       WHERE deleted_at IS NULL AND org_id IN (${marks}) GROUP BY org_id, kind`
    ).bind(...ids).all<{ org_id: string; kind: string; n: number; last: number }>();
    const profiles = await db.select({ orgId: schema.records.orgId, body: schema.records.body }).from(schema.records)
      .where(and(inArray(schema.records.orgId, ids), eq(schema.records.kind, "profile"), isNull(schema.records.deletedAt)));

    const clients = mine.map((m) => {
      const org = orgs.find((o) => o.id === m.orgId);
      const rows = (stats.results ?? []).filter((s) => s.org_id === m.orgId);
      const profileRow = profiles.find((p) => p.orgId === m.orgId);
      let profile = {};
      try { profile = profileSummary(profileRow ? JSON.parse(profileRow.body) : null); } catch { /* an unreadable profile shows as empty */ }
      return {
        orgId: m.orgId,
        role: m.role,
        current: m.orgId === me.orgId,
        name: org?.name ?? "A business",
        plan: org?.plan ?? "free",
        profile,
        counts: Object.fromEntries(rows.map((r) => [r.kind, r.n])),
        lastActivity: rows.reduce((max, r) => Math.max(max, Number(r.last) || 0), 0) || null
      };
    });
    return c.reply(json({ clients }));
  }

  /* ---------- one business's books, read only ---------- */
  if (url.pathname === "/practice/records" && req.method === "GET") {
    const orgId = url.searchParams.get("org") ?? "";
    const member = orgId ? await c.membership(me.userId, orgId) : undefined;
    if (!member) return c.reply(problem(403, "You do not have access to that business."));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const kinds = ["profile", "client", "item", "document", "expense", "asset", "entry"] as const;

    const rows = await db.select({ kind: schema.records.kind, localId: schema.records.localId, body: schema.records.body })
      .from(schema.records)
      .where(and(eq(schema.records.orgId, orgId), isNull(schema.records.deletedAt), inArray(schema.records.kind, [...kinds])))
      .orderBy(asc(schema.records.id)).limit(PAGE + 1).offset(offset);

    // Reading a client's books is recorded in their history, so the business can see who looked.
    if (offset === 0 && member.role === "accountant") {
      await c.audit({ orgId, userId: me.userId, action: "practice.read", summary: `Books read by ${me.email}` });
    }
    const page = rows.slice(0, PAGE).map((r) => {
      try { return { kind: r.kind, localId: r.localId, body: JSON.parse(r.body) as unknown }; } catch { return null; }
    }).filter(Boolean);
    return c.reply(json({ records: page, more: rows.length > PAGE, next: offset + PAGE }));
  }

  /* ---------- asking a business for access ---------- */
  if (url.pathname === "/practice/request" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { email?: string; businessName?: string; note?: string };
    const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
    if (!email || !isEmail(email)) return c.reply(problem(400, "That does not look like an email address."));
    if (email === normaliseEmail(me.email)) return c.reply(problem(400, "That is your own address. Ask the business owner's email instead."));
    if (!(await rateLimit(c.env.SESSIONS, `practice-ask:${me.userId}`, DAILY_REQUESTS, 24 * 60 * 60 * 1000))) {
      return c.reply(problem(429, `That is ${DAILY_REQUESTS} requests today, the daily limit. The rest can go tomorrow.`));
    }

    const businessName = cleanLine(body.businessName, 120) || null;
    const note = cleanLine(body.note, 300) || null;
    const token = randomToken();
    const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);

    // Asking the same address again replaces the earlier link rather than piling up requests.
    const earlier = (await db.select().from(schema.accessRequests)
      .where(and(eq(schema.accessRequests.requesterId, me.userId), eq(schema.accessRequests.email, email))))
      .find((r) => requestState(r) === "pending");
    if (earlier) {
      await db.update(schema.accessRequests).set({ tokenHash: await hashToken(token), expiresAt, businessName, note, createdAt: new Date() })
        .where(eq(schema.accessRequests.id, earlier.id));
    } else {
      await db.insert(schema.accessRequests).values({
        id: c.uid("ar"), requesterId: me.userId, email, businessName, note,
        tokenHash: await hashToken(token), createdAt: new Date(), expiresAt, acceptedAt: null, acceptedOrgId: null, declinedAt: null
      });
    }

    const mail = requestEmail(`${c.env.APP_ORIGIN}/grant-access/?token=${token}`, {
      from: me.email, businessName: businessName ?? undefined, note: note ?? undefined, days: Math.round(REQUEST_TTL_MS / 86_400_000)
    });
    const sent = await c.send({ to: email, ...mail });
    return c.reply(json({ ok: true, sent, resent: Boolean(earlier) }));
  }

  /* ---------- the requests this accountant has sent ---------- */
  if (url.pathname === "/practice/requests" && req.method === "GET") {
    const rows = await db.select().from(schema.accessRequests).where(eq(schema.accessRequests.requesterId, me.userId));
    const requests = rows
      .map((r) => ({ id: r.id, email: r.email, businessName: r.businessName, state: requestState(r), sentAt: r.createdAt.getTime(), expiresAt: r.expiresAt.getTime() }))
      .sort((a, b) => b.sentAt - a.sentAt)
      .slice(0, 200);
    return c.reply(json({ requests }));
  }

  if (url.pathname === "/practice/request/cancel" && req.method === "POST") {
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    if (!id) return c.reply(problem(400, "No request was named."));
    await db.update(schema.accessRequests).set({ declinedAt: new Date() })
      .where(and(eq(schema.accessRequests.id, id), eq(schema.accessRequests.requesterId, me.userId), isNull(schema.accessRequests.acceptedAt)));
    return c.reply(json({ ok: true }));
  }

  /* ---------- the business saying yes ---------- */
  if (url.pathname === "/practice/grant" && req.method === "POST") {
    const { token } = (await req.json().catch(() => ({}))) as { token?: string };
    if (!token) return c.reply(problem(400, "No link was sent."));
    if (!me.orgId) return c.reply(problem(400, "Set up your business first, then open the link again."));
    const member = await c.membership(me.userId, me.orgId);
    if (!member || !can(member.role).manageTeam) {
      return c.reply(problem(403, "Only the owner or a manager of the business can give an accountant access."));
    }

    const row = (await db.select().from(schema.accessRequests).where(eq(schema.accessRequests.tokenHash, await hashToken(token))).limit(1))[0];
    if (!row) return c.reply(problem(404, "That link is not valid, or a newer one was sent."));
    const state = requestState(row);
    if (state !== "pending") {
      return c.reply(problem(410, state === "accepted" ? "This request was already accepted." : state === "declined" ? "This request was declined or withdrawn." : "This request has expired. Ask your accountant to send it again."));
    }
    if (row.requesterId === me.userId) return c.reply(problem(400, "You cannot give yourself access. Open this link signed in as the business owner."));

    const already = await c.membership(row.requesterId, me.orgId);
    if (!already) {
      await db.insert(schema.memberships).values({ id: c.uid("me"), userId: row.requesterId, orgId: me.orgId, role: "accountant", createdAt: new Date() });
    }
    await db.update(schema.accessRequests).set({ acceptedAt: new Date(), acceptedOrgId: me.orgId }).where(eq(schema.accessRequests.id, row.id));

    const org = (await db.select().from(schema.organisations).where(eq(schema.organisations.id, me.orgId)).limit(1))[0];
    const profile = (await db.select({ body: schema.records.body }).from(schema.records)
      .where(and(eq(schema.records.orgId, me.orgId), eq(schema.records.kind, "profile"), isNull(schema.records.deletedAt))).limit(1))[0];
    let business = org?.name ?? "A business";
    try { business = profileSummary(profile ? JSON.parse(profile.body) : null).name || business; } catch { /* keep the org name */ }

    const requester = (await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.requesterId)).limit(1))[0];
    await c.audit({ orgId: me.orgId, userId: me.userId, action: "practice.granted", summary: `Accountant access for ${requester?.email ?? "an accountant"}` });
    if (requester) c.waitUntil(c.send({ to: requester.email, ...grantedEmail({ business, by: me.email, origin: c.env.APP_ORIGIN }) }));

    return c.reply(json({ ok: true, business, accountant: requester?.email }));
  }

  /* ---------- an accountant stepping away from a client ---------- */
  if (url.pathname === "/practice/leave" && req.method === "POST") {
    const { org } = (await req.json().catch(() => ({}))) as { org?: string };
    const member = org ? await c.membership(me.userId, org) : undefined;
    if (!member) return c.reply(problem(404, "You are not on that business."));
    if (member.role !== "accountant") return c.reply(problem(400, "Only an accountant seat can be left from here. Owners and managers use People."));
    await db.delete(schema.memberships).where(and(eq(schema.memberships.userId, me.userId), eq(schema.memberships.orgId, org!)));
    await c.audit({ orgId: org!, userId: me.userId, action: "practice.left", summary: `${me.email} stopped being the accountant` });
    return c.reply(json({ ok: true }));
  }

  return c.reply(problem(404, "There is nothing here."));
}
