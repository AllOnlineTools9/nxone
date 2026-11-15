import { decimalsFor, fromMinor, type Money } from "./money";
import type { Expense, SavedDocument } from "./store/types";

/**
 * Money in more than one currency.
 *
 * The books are kept in one currency — whatever the business itself counts in. An invoice billed
 * in another currency is converted at a rate recorded on the invoice, not at whatever rate
 * happens to be true today, because the amount earned was settled on the day it was earned.
 *
 * No rate is ever invented. NXOne has no connection to a rate feed and will not pretend to one:
 * the rate is typed by the person billing, who knows what their bank gave them, and it is carried
 * forward from the last invoice in that currency as a starting point rather than as a fact. A
 * document without a rate is not quietly left out of the accounts — it is reported, and the
 * screens ask for the missing number.
 */

export interface Rate {
  /** The currency the document is written in. */
  from: string;
  /** The currency the books are kept in. */
  to: string;
  /** How many units of `to` one unit of `from` buys. 1 USD = 83.2 INR is a rate of 83.2. */
  rate: number;
  /** Where the number came from, which the screens say out loud. */
  source: "same" | "recorded" | "carried";
  /** The date the rate was recorded, when it was carried from another document. */
  date?: string;
}

export const sameCurrency = (currency: string): Rate => ({ from: currency, to: currency, rate: 1, source: "same" });

/**
 * Converting minor units between currencies, which is not a simple multiplication: a currency
 * with no decimals and one with three do not share a scale, so the amount is taken up to its real
 * value, converted, and put back down on the other currency's scale.
 */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  if (from.toUpperCase() === to.toUpperCase()) return Math.round(minor);
  const major = minor / 10 ** decimalsFor(from);
  return Math.round(major * rate * 10 ** decimalsFor(to));
}

export const convert = (amount: Money, to: string, rate: number): Money =>
  fromMinor(convertMinor(amount.minor, amount.currency, to, rate), to);

/** A rate that can be stated: positive, finite, and not absurd enough to be a typo for something else. */
export const usableRate = (rate: number | undefined | null): rate is number =>
  typeof rate === "number" && Number.isFinite(rate) && rate > 0;

/**
 * The rate to use for one document. Its own recorded rate wins; failing that, the rate from the
 * most recent document in the same currency, which is marked as carried so a screen can say where
 * it came from. Nothing else is offered, so the answer may be nothing.
 */
export function rateFor(
  currency: string,
  base: string,
  documents: SavedDocument[] = [],
  recorded?: number
): Rate | undefined {
  if (currency.toUpperCase() === base.toUpperCase()) return sameCurrency(base);
  if (usableRate(recorded)) return { from: currency, to: base, rate: recorded, source: "recorded" };

  const carried = [...documents]
    .filter((d) => !d.deletedAt && d.currency === currency && usableRate(d.doc.fxRate))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];

  return carried
    ? { from: currency, to: base, rate: carried.doc.fxRate as number, source: "carried", date: carried.issueDate }
    : undefined;
}

/** The last rate recorded for each foreign currency, for filling a new document in. */
export function knownRates(documents: SavedDocument[], base: string): Record<string, Rate> {
  const out: Record<string, Rate> = {};
  for (const d of [...documents].sort((a, b) => a.issueDate.localeCompare(b.issueDate))) {
    if (d.deletedAt || d.currency === base || !usableRate(d.doc.fxRate)) continue;
    out[d.currency] = { from: d.currency, to: base, rate: d.doc.fxRate, source: "carried", date: d.issueDate };
  }
  return out;
}

/**
 * What the accounts cannot take in yet. A screen shows this rather than a total that quietly
 * leaves money out, which is the failure nobody notices.
 */
export interface Unrated {
  documents: SavedDocument[];
  expenses: Expense[];
  currencies: string[];
  totalDocuments: number;
}

export function unrated(documents: SavedDocument[], expenses: Expense[], base: string): Unrated {
  const docs = documents.filter((d) =>
    !d.deletedAt && d.currency !== base && d.status !== "draft" && d.status !== "cancelled"
    && (d.kind === "invoice" || d.kind === "proforma" || d.kind === "credit-note")
    && !rateFor(d.currency, base, documents, d.doc.fxRate));

  const bills = expenses.filter((e) => !e.deletedAt && e.currency !== base && !usableRate(e.fxRate));

  return {
    documents: docs,
    expenses: bills,
    currencies: [...new Set([...docs.map((d) => d.currency), ...bills.map((e) => e.currency)])].sort(),
    totalDocuments: docs.length + bills.length
  };
}

/** "1 USD = 83.2000 INR", written the way a person would check it against their bank statement. */
export function describeRate(rate: Rate): string {
  if (rate.source === "same") return "";
  return `1 ${rate.from} = ${rate.rate.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${rate.to}`;
}

/* --------------------------------------------- one set of books, one currency */

export type Converted<T> = T & { convertedFrom?: { currency: string; rate: number } };

/**
 * The documents and bills as the money screens should see them: every amount in the books'
 * currency, converted at each document's own rate.
 *
 * The document itself is left alone. An invoice is a document sent to a customer and it says what
 * it said — only the summary figures the screens add up are converted, and each carries a note of
 * where it came from so a screen can show both. Anything without a rate is left out here and
 * listed by `unrated`, so it can be asked for rather than lost.
 */
export function booksView(documents: SavedDocument[], expenses: Expense[], base: string): {
  documents: Array<Converted<SavedDocument>>;
  expenses: Array<Converted<Expense>>;
} {
  const docs: Array<Converted<SavedDocument>> = [];
  for (const d of documents) {
    if (d.currency === base) { docs.push(d); continue; }
    const rate = rateFor(d.currency, base, documents, d.doc.fxRate);
    if (!rate) continue;
    docs.push({
      ...d,
      currency: base,
      totalMinor: convertMinor(d.totalMinor, d.currency, base, rate.rate),
      paidMinor: convertMinor(d.paidMinor, d.currency, base, usableRate(d.paymentFxRate) ? d.paymentFxRate : rate.rate),
      convertedFrom: { currency: d.currency, rate: rate.rate }
    });
  }

  const bills: Array<Converted<Expense>> = [];
  for (const e of expenses) {
    if (e.currency === base) { bills.push(e); continue; }
    if (!usableRate(e.fxRate)) continue;
    bills.push({
      ...e,
      currency: base,
      netMinor: convertMinor(e.netMinor, e.currency, base, e.fxRate),
      taxMinor: convertMinor(e.taxMinor, e.currency, base, e.fxRate),
      convertedFrom: { currency: e.currency, rate: e.fxRate }
    });
  }

  return { documents: docs, expenses: bills };
}
