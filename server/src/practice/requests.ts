/**
 * Pure pieces of an accountant asking a business for access: who can be asked, how long a
 * request lasts, what the email says, and what the books summary may show.
 */

export const REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** A practice may ask this many businesses a day. Enough for a firm onboarding its clients. */
export const DAILY_REQUESTS = 60;

export type RequestState = "pending" | "accepted" | "declined" | "expired";

export function requestState(r: { acceptedAt: Date | null; declinedAt: Date | null; expiresAt: Date }, now = Date.now()): RequestState {
  if (r.acceptedAt) return "accepted";
  if (r.declinedAt) return "declined";
  if (r.expiresAt.getTime() < now) return "expired";
  return "pending";
}

/** One line, no header tricks, and short enough to read in a subject. */
export const cleanLine = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

export function requestEmail(link: string, opts: { from: string; businessName?: string; note?: string; days: number }) {
  const whose = opts.businessName ? `the books of ${opts.businessName}` : "your books";
  return {
    subject: `${opts.from} would like to see ${whose} on NXOne`,
    text: [
      `${opts.from} has asked for accountant access to ${whose} on NXOne.`,
      ...(opts.note ? ["", `They wrote: "${opts.note}"`] : []),
      "",
      "With accountant access they can see your invoices, bills and returns, and export them for filing and for Tally. They cannot change or send anything.",
      "",
      "To say yes or no:",
      link,
      "",
      `The link expires in ${opts.days} days. If you do not use NXOne yet, it is free, and opening the link lets you start. You can remove their access at any time from People.`,
      "",
      "If you do not know who this is, ignore this email. Nothing happens unless you say yes.",
      "",
      "NXOne"
    ].join("\n")
  };
}

export function grantedEmail(opts: { business: string; by: string; origin: string }) {
  return {
    subject: `${opts.business} gave you access on NXOne`,
    text: [
      `${opts.by} said yes: ${opts.business} is now in your client list.`,
      "",
      `${opts.origin}/practice/`,
      "",
      "NXOne"
    ].join("\n")
  };
}

/** The parts of a business profile a practice list shows. Nothing about bank details or logos. */
export function profileSummary(body: unknown) {
  const p = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  return {
    name: str("name"),
    taxId: str("taxId"),
    country: str("country"),
    region: str("region"),
    gstScheme: str("gstScheme"),
    quarterlyGst: typeof p.quarterlyGst === "boolean" ? p.quarterlyGst : undefined,
    registrations: Array.isArray(p.registrations) ? (p.registrations as unknown[]).filter((r): r is string => typeof r === "string") : undefined,
    lockedUpTo: str("lockedUpTo")
  };
}
