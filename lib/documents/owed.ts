import type { SavedDocument } from "../store/types";

/**
 * What a customer still owes on a document: the total, less money received, less anything
 * settled another way (a discount allowed, an amount written off). Every screen that shows a
 * balance uses this, so a settled invoice never shows as owing somewhere and paid elsewhere.
 */
export function settledMinor(d: Pick<SavedDocument, "settlement">): number {
  return (d.settlement?.discountMinor ?? 0) + (d.settlement?.writtenOffMinor ?? 0);
}

export function owedOn(d: Pick<SavedDocument, "totalMinor" | "paidMinor" | "settlement">): number {
  return Math.max(0, d.totalMinor - (d.paidMinor ?? 0) - settledMinor(d));
}
