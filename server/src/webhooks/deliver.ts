import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { documentView } from "../api/build";
import * as schema from "../db/schema";
import { signature, type WebhookEvent } from "./sign";

type Db = DrizzleD1Database<typeof schema>;

const TIMEOUT_MS = 10_000;
const BACKOFF_MS = [0, 1_000, 4_000];

/** What a webhook receives about a record: never the whole stored body, only what is useful. */
export function dataFor(kind: string, body: Record<string, unknown>): Record<string, unknown> {
  if (kind === "document") return documentView(body);
  if (kind === "client") {
    return { id: body.id, name: body.name, email: body.email ?? null, phone: body.phone ?? null, taxId: body.taxId ?? null, region: body.region ?? null };
  }
  if (kind === "expense") {
    return {
      id: body.id, date: body.date, supplier: body.supplier, currency: body.currency, category: body.category,
      net: Number(body.netMinor ?? 0) / 100, tax: Number(body.taxMinor ?? 0) / 100, reference: body.reference ?? null
    };
  }
  return { id: body.id };
}

/** One delivery, tried up to three times within the request's own lifetime. */
export async function attempt(db: Db, hook: { url: string; secret: string }, deliveryId: string, event: string, payload: string): Promise<boolean> {
  let status: number | null = null;
  let error: string | null = null;
  let tries = 0;
  for (const wait of BACKOFF_MS) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    tries++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const ts = Math.floor(Date.now() / 1000);
      const res = await fetch(hook.url, {
        method: "POST", body: payload, signal: ctrl.signal, redirect: "manual",
        headers: {
          "Content-Type": "application/json", "User-Agent": "NXOne-Webhooks/1",
          "NXOne-Event": event, "NXOne-Delivery": deliveryId, "NXOne-Signature": await signature(hook.secret, ts, payload)
        }
      });
      status = res.status;
      error = res.ok ? null : `Answered ${res.status}`;
      if (res.ok) break;
      // A 4xx other than rate limiting will not get better by asking again.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (e) {
      error = e instanceof Error && e.name === "AbortError" ? "No answer within 10 seconds" : "Could not connect";
    } finally {
      clearTimeout(timer);
    }
  }
  const ok = status !== null && status >= 200 && status < 300;
  await db.update(schema.webhookDeliveries)
    .set({ status, ok, attempts: tries, error, deliveredAt: ok ? new Date() : null })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
  return ok;
}

/**
 * Sends events to every webhook of the business that asked for them. Runs after the response,
 * so a slow receiver never slows down saving.
 */
export async function dispatch(
  db: Db, uid: (p: string) => string, orgId: string,
  happenings: Array<{ event: WebhookEvent; kind: string; body: Record<string, unknown> }>
): Promise<void> {
  if (!happenings.length) return;
  const hooks = await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.orgId, orgId), isNull(schema.webhooks.revokedAt)));
  if (!hooks.length) return;
  const jobs: Promise<boolean>[] = [];
  for (const h of hooks) {
    let wanted: string[] = [];
    try { wanted = JSON.parse(h.events) as string[]; } catch { /* treat as none */ }
    for (const happening of happenings.slice(0, 50)) {
      if (!wanted.includes(happening.event)) continue;
      const id = uid("wd");
      const payload = JSON.stringify({ id, event: happening.event, createdAt: new Date().toISOString(), data: dataFor(happening.kind, happening.body) });
      await db.insert(schema.webhookDeliveries).values({ id, webhookId: h.id, event: happening.event, payload, status: null, ok: false, attempts: 0, error: null, createdAt: new Date(), deliveredAt: null });
      jobs.push(attempt(db, h, id, happening.event, payload));
    }
  }
  await Promise.allSettled(jobs);
}
