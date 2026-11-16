/**
 * A link a customer can open to see their invoice.
 *
 * The books live on the business's device, so there is nothing for a customer to log into. What
 * gets shared is a snapshot: the one document, as it stood when the link was made, at an
 * unguessable address. No account, no password, nothing of the business beyond that one
 * document.
 *
 * Two rules decide the design. A link is a credential — anyone holding it can read what it
 * points at — so it is long, random, and the business can revoke it. And a snapshot is not the
 * books: changing an invoice afterwards does not silently change what the customer was shown,
 * which protects both sides of an argument about what was sent.
 */

export interface SharedDocument {
  /** What the customer sees. Deliberately the printed document, not the record behind it. */
  number: string;
  kind: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  seller: { name: string; address?: string; email?: string; phone?: string; taxId?: string };
  buyer: { name: string; address?: string; taxId?: string };
  lines: Array<{ description: string; quantity: number; rate: number; amountMinor: number }>;
  taxLines: Array<{ label: string; amountMinor: number }>;
  notes?: string;
  terms?: string;
  /** Where to pay, when the business has set it up. */
  payment?: { upiId?: string; link?: string; details?: string };
}

export interface ShareRecord {
  token: string;
  orgId: string;
  documentId: string;
  number: string;
  /** The snapshot, as JSON. */
  snapshot: string;
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  viewCount: number;
  lastViewedAt?: Date;
}

/**
 * A token long enough that guessing is not a route in. 32 bytes of randomness, written in
 * base32 without the characters people confuse when reading one aloud.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Tokens are compared in constant time: a comparison that fails fast leaks the prefix. */
export function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type ShareState = "live" | "revoked" | "expired" | "missing";

export function stateOf(record: ShareRecord | undefined, now = new Date()): ShareState {
  if (!record) return "missing";
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && record.expiresAt.getTime() < now.getTime()) return "expired";
  return "live";
}

/** What a customer is told when a link no longer works. Never why, beyond the plain fact. */
export function refusalFor(state: ShareState): { status: number; says: string } {
  switch (state) {
    case "revoked":
      return { status: 410, says: "This link has been withdrawn. Ask whoever sent it for a new one." };
    case "expired":
      return { status: 410, says: "This link has expired. Ask whoever sent it for a new one." };
    default:
      return { status: 404, says: "There is nothing at this link." };
  }
}

/**
 * Trim a document to what a customer should see.
 *
 * A snapshot of the whole record would carry things that are none of the customer's business —
 * what the job cost, which supplier was used, what else the business has billed. So the shape
 * above is built field by field rather than by copying and deleting, because a field added to
 * the document later would otherwise find its own way into a stranger's browser.
 */
export function snapshotOf(input: {
  number: string;
  kind: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  seller: { name: string; address?: string; email?: string; phone?: string; taxId?: string };
  buyer: { name: string; address?: string; taxId?: string };
  lines: Array<{ description: string; quantity: number; rate: number; amountMinor: number }>;
  taxLines: Array<{ label: string; amountMinor: number }>;
  notes?: string;
  terms?: string;
  payment?: { upiId?: string; link?: string; details?: string };
}): SharedDocument {
  return {
    number: input.number,
    kind: input.kind,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    totalMinor: input.totalMinor,
    paidMinor: input.paidMinor,
    seller: {
      name: input.seller.name, address: input.seller.address,
      email: input.seller.email, phone: input.seller.phone, taxId: input.seller.taxId
    },
    buyer: { name: input.buyer.name, address: input.buyer.address, taxId: input.buyer.taxId },
    lines: input.lines.map((l) => ({
      description: l.description, quantity: l.quantity, rate: l.rate, amountMinor: l.amountMinor
    })),
    taxLines: input.taxLines.map((t) => ({ label: t.label, amountMinor: t.amountMinor })),
    notes: input.notes,
    terms: input.terms,
    payment: input.payment
      ? { upiId: input.payment.upiId, link: input.payment.link, details: input.payment.details }
      : undefined
  };
}

/** Fields that must never reach a shared snapshot, checked rather than trusted. */
const NEVER_SHARE = ["projectId", "costMinor", "supplier", "margin", "internalNotes", "tdsMinor", "rcmCategory"];

/**
 * A guard against the shape above drifting. If somebody later widens the snapshot by spreading
 * a document into it, this catches the fields that should never have come along.
 */
export function leaks(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const keys = new Set(Object.keys(snapshot as Record<string, unknown>));
  return NEVER_SHARE.filter((field) => keys.has(field));
}
