import { addDays, nextNumber } from "../format";
import { kindConfig } from "./kinds";
import type { DocumentData, DocumentKind } from "./types";

/**
 * Turning one document into the next one.
 *
 * A quotation that gets accepted becomes an invoice. An invoice that gets paid becomes a receipt.
 * An invoice sent in error becomes a credit note. These are the ordinary next steps of a job, and
 * until now each one meant typing the whole thing again - which is both tedious and the most
 * reliable way to introduce a difference between two documents that are supposed to agree.
 *
 * The new document keeps everything that is still true (who, what, how much, the tax treatment)
 * and takes a fresh number, today's date, and whatever the new kind needs that the old one did
 * not have. It points back at where it came from, so the pair can be read together later.
 */

export interface Conversion {
  to: DocumentKind;
  /** What the button says. */
  label: string;
  /** Why you would. */
  describes: string;
}

const CONVERSIONS: Partial<Record<DocumentKind, Conversion[]>> = {
  quote: [
    { to: "invoice", label: "Make an invoice", describes: "They accepted it. Bill them for the same thing." },
    { to: "proforma", label: "Make a proforma", describes: "They need something to raise a payment against before the real invoice." }
  ],
  proforma: [
    { to: "invoice", label: "Make an invoice", describes: "Turn it into the real thing." }
  ],
  invoice: [
    { to: "receipt", label: "Make a receipt", describes: "They have paid. Give them something that says so." },
    { to: "credit-note", label: "Make a credit note", describes: "Cancel some or all of it: a return, an overcharge, work not done." }
  ],
  "delivery-note": [
    { to: "invoice", label: "Make an invoice", describes: "The goods are delivered. Bill for them." }
  ]
};

export const conversionsFor = (kind: DocumentKind): Conversion[] => CONVERSIONS[kind] ?? [];

export const canConvert = (from: DocumentKind, to: DocumentKind) =>
  conversionsFor(from).some((c) => c.to === to);

/** What a conversion needs from outside: the next number in the series, and today. */
export interface ConvertOptions {
  today: string;
  /** From the profile's own series. Without one, the old number is stepped on instead. */
  number?: string;
  /** Payment details to put on a kind that shows them when the old one did not. */
  profile?: { paymentDetails?: string; upiId?: string; paymentLink?: string };
}

/**
 * Wording that belonged to the old kind is replaced; wording the person wrote themselves is kept.
 * Comparing against the old kind's default is how we tell the two apart, which is imperfect only
 * in the harmless direction: text the person happened to type identical to the default is
 * replaced by the new default, and text they changed is theirs and stays.
 */
const carry = (written: string | undefined, oldDefault: string | undefined, newDefault: string | undefined) =>
  !written || written === (oldDefault ?? "") ? (newDefault ?? "") : written;

export function convertTo(doc: DocumentData, to: DocumentKind, opts: ConvertOptions): DocumentData {
  const from = kindConfig(doc.kind);
  const target = kindConfig(to);
  const issueDate = opts.today;

  const reference = doc.number;
  const showsPayment = target.showPaymentDetails;

  return {
    ...doc,
    kind: to,
    number: opts.number ?? nextNumber(doc.number),
    issueDate,
    dueDate: target.secondDateLabel ? addDays(issueDate, target.secondDateDays ?? 0) : undefined,

    // Where it came from, printed on the document and kept in the record.
    reference,

    terms: carry(doc.terms, from.defaultTerms, target.defaultTerms),
    notes: carry(doc.notes, from.defaultNotes, target.defaultNotes),

    // An invoice needs bank details a quotation never carried.
    paymentDetails: showsPayment ? (doc.paymentDetails || opts.profile?.paymentDetails) : undefined,
    payment: showsPayment
      ? (doc.payment ?? { upiId: opts.profile?.upiId, paymentLink: opts.profile?.paymentLink, includeAmount: true })
      : undefined,

    // A receipt says money arrived; everything else starts owing the whole amount again.
    amountPaid: undefined,
    paymentReference: to === "receipt" ? doc.paymentReference : undefined
  };
}

/** The sentence a screen shows to say what just happened, and what the pair are to each other. */
export function describeConversion(from: DocumentData, to: DocumentKind): string {
  const name = kindConfig(to).title.toLowerCase();
  return `This ${name} was made from ${from.number}. Both are kept, and this one refers to it.`;
}
