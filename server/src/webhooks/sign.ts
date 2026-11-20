/**
 * Webhooks: what happened, sent to an address the business chose, signed so the receiver can
 * tell it came from NXOne and was not changed or replayed.
 *
 * The signature header reads "t=<unix seconds>,v1=<hex HMAC-SHA256 of '<t>.<body>'>", keyed
 * with the webhook's secret. A receiver recomputes it and rejects anything older than five minutes.
 */

export const EVENTS = ["document.created", "document.updated", "document.paid", "customer.created", "expense.created"] as const;
export type WebhookEvent = (typeof EVENTS)[number] | "ping";

export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `whsec_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function signature(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

/** Only public https addresses: no local network, no plain http, nothing pointing back at us. */
export function checkUrl(raw: unknown): { ok: true; url: string } | { ok: false; says: string } {
  if (typeof raw !== "string" || raw.length > 500) return { ok: false, says: "Give the full address, starting https://." };
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, says: "That is not a web address." }; }
  if (u.protocol !== "https:") return { ok: false, says: "The address must start https://, so what is sent cannot be read on the way." };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.startsWith("[")) {
    return { ok: false, says: "Use a public address with a domain name, not an IP address or a local one." };
  }
  if (host === "nxone.io" || host.endsWith(".nxone.io")) return { ok: false, says: "That address is NXOne itself." };
  if (u.username || u.password) return { ok: false, says: "Leave the user name and password out of the address." };
  return { ok: true, url: u.toString() };
}

export function eventsFrom(raw: unknown): WebhookEvent[] {
  const wanted = Array.isArray(raw) ? raw : [];
  const picked = EVENTS.filter((e) => wanted.includes(e));
  return picked.length ? [...picked] : [...EVENTS];
}

/**
 * What to tell webhooks about, from one record before and after a change. Saves from the app and
 * from the API both pass through here, so either way the same events go out.
 */
export function eventsForChange(kind: string, before: Record<string, unknown> | undefined, after: Record<string, unknown>): WebhookEvent[] {
  if (after.deletedAt) return [];
  if (kind === "client") return before ? [] : ["customer.created"];
  if (kind === "expense") return before ? [] : ["expense.created"];
  if (kind !== "document") return [];
  if (!before) return after.status === "paid" ? ["document.created", "document.paid"] : ["document.created"];
  const out: WebhookEvent[] = ["document.updated"];
  if (after.status === "paid" && before.status !== "paid") out.push("document.paid");
  return out;
}
