import { owedOn } from "./owed";
import type { SavedDocument } from "../store/types";

/**
 * Closing an invoice other than by being paid in full, and taking back a payment that bounced.
 * Each returns the document as it should now be saved, or a refusal in words. The books follow
 * from the document (see ledgerFor), so nothing here posts anything itself.
 */

export type Settled = { ok: true; doc: SavedDocument } | { ok: false; says: string };

const statusFor = (d: SavedDocument): SavedDocument["status"] =>
  owedOn(d) === 0 ? "paid" : d.paidMinor > 0 ? "partly-paid" : d.status === "paid" || d.status === "partly-paid" ? "sent" : d.status;

/** "They paid 9,800 against 10,000: let the 200 go." The rest becomes a discount allowed. */
export function allowDiscount(d: SavedDocument, discountMinor: number, on: string, note?: string): Settled {
  const owed = owedOn(d);
  if (d.kind !== "invoice" || d.status === "draft" || d.status === "cancelled") return { ok: false, says: "Only a sent invoice can be settled." };
  if (!(discountMinor > 0)) return { ok: false, says: "The discount must be more than nothing." };
  if (discountMinor > owed) return { ok: false, says: "That is more than is still owed." };
  const next: SavedDocument = { ...d, settlement: { ...d.settlement, discountMinor: (d.settlement?.discountMinor ?? 0) + discountMinor, on, note: note ?? d.settlement?.note } };
  return { ok: true, doc: { ...next, status: statusFor(next) } };
}

/** "They will not pay": what is left is written off as a bad debt. */
export function writeOff(d: SavedDocument, on: string, note?: string, amountMinor = owedOn(d)): Settled {
  const owed = owedOn(d);
  if (d.kind !== "invoice" || d.status === "draft" || d.status === "cancelled") return { ok: false, says: "Only a sent invoice can be written off." };
  if (!(amountMinor > 0) || amountMinor > owed) return { ok: false, says: owed ? "That is more than is still owed." : "Nothing is owed on this invoice." };
  const next: SavedDocument = { ...d, settlement: { ...d.settlement, writtenOffMinor: (d.settlement?.writtenOffMinor ?? 0) + amountMinor, on, note: note ?? d.settlement?.note } };
  return { ok: true, doc: { ...next, status: statusFor(next) } };
}

/** A payment that came back: it is owed again, and any bank charge is the business's cost. */
export function paymentBounced(d: SavedDocument, amountMinor: number, on: string, chargesMinor = 0, note?: string): Settled {
  if (!(amountMinor > 0)) return { ok: false, says: "Say how much came back." };
  if (amountMinor > d.paidMinor) return { ok: false, says: "That is more than was received on this invoice." };
  if (on < (d.paidOn ?? d.issueDate)) return { ok: false, says: "A payment cannot come back before it was received." };
  const next: SavedDocument = {
    ...d,
    paidMinor: d.paidMinor - amountMinor,
    bounces: [...(d.bounces ?? []), { on, amountMinor, chargesMinor: chargesMinor > 0 ? chargesMinor : undefined, note }]
  };
  return { ok: true, doc: { ...next, status: statusFor(next) } };
}
