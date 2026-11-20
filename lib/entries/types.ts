import type { JournalLine } from "../ledger/journal";

/**
 * Something recorded in the books that is not an invoice or a bill: the owner putting money in
 * or taking it out, a loan and its repayments, a fixed deposit, tax paid to the government, cash
 * moved between the drawer and the bank, and the adjustments an accountant makes at year end.
 *
 * Stored as the entry itself (balanced debits and credits), with the sentence it came from when
 * it was typed in words, so it can be read back the way it was said.
 */

/** How Tally and a day book name the voucher. */
export type VoucherType = "journal" | "payment" | "receipt" | "contra";

export interface ManualEntry {
  id: string;
  date: string;
  narration: string;
  voucher: VoucherType;
  lines: JournalLine[];
  /** The sentence it was made from, when it was typed in words. */
  sentence?: string;
  /** Which kind of entry it was read as, such as "drawings" or "gst-paid". */
  template?: string;
  /** A partner, lender, bank or customer the entry concerns, for the ledger and for Tally. */
  party?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
  deletedAt?: string;
  syncedAt?: string;
}
