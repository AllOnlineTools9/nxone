import { calculate } from "../documents/totals";
import { balances } from "../ledger/journal";
import { ledgerFor } from "../ledger/posting";
import type { Expense, Profile, SavedDocument } from "../store/types";
import { B2CL_THRESHOLDS, type Gstr1, type ReturnPeriod } from "./gstr1";
import { rateFor } from "../fx";
import { checkGstin } from "./states";

/**
 * What to put right before filing.
 *
 * Everything here is something the books can see and a person cannot: a tax number with a
 * mistyped character, an invoice still sitting in drafts and therefore missing from the return, a
 * number missing from the series. None of it is advice about the law. It is arithmetic and
 * spelling, done on the way out of the door.
 */

export type Severity = "stop" | "check";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** The documents it concerns, so the screen can list them. */
  documents?: Array<{ id: string; number: string; clientName: string }>;
  action?: { label: string; href: string };
}

const named = (d: SavedDocument) => ({ id: d.id, number: d.number, clientName: d.clientName });

export function checksFor(opts: {
  documents: SavedDocument[];
  expenses: Expense[];
  profile?: Profile;
  period: ReturnPeriod;
  return: Gstr1;
  currency?: string;
}): Finding[] {
  const { documents, expenses, profile, period, currency = "INR" } = opts;
  const out: Finding[] = [];

  const indian = documents.filter((d) => !d.deletedAt && d.doc.country?.toUpperCase() === "IN"
    && d.issueDate >= period.from && d.issueDate <= period.to);
  const sales = indian.filter((d) => d.kind === "invoice" || d.kind === "credit-note");
  const live = sales.filter((d) => d.status !== "draft" && d.status !== "cancelled");

  /* ---- your own number ---- */
  const mine = checkGstin(profile?.taxId);
  if (!profile?.taxId) {
    out.push({
      id: "own-gstin-missing", severity: "stop",
      title: "Your own GSTIN is not set",
      detail: "A return is filed against a GSTIN. Add yours in your business details and it will also appear on every invoice.",
      action: { label: "Business details", href: "/settings/" }
    });
  } else if (!mine.valid) {
    out.push({
      id: "own-gstin-invalid", severity: "stop",
      title: "Your own GSTIN does not look right",
      detail: `${mine.says} It is on every invoice you have sent, so it is worth fixing now.`,
      action: { label: "Business details", href: "/settings/" }
    });
  }

  /* ---- drafts, which are invisible to the return ---- */
  const drafts = sales.filter((d) => d.status === "draft");
  if (drafts.length) {
    out.push({
      id: "drafts", severity: "stop",
      title: `${drafts.length} invoice${drafts.length === 1 ? " is" : "s are"} still a draft`,
      detail: "Drafts are left out of the return entirely. If they were really sent, mark them sent; if they were not, they do not belong in this month.",
      documents: drafts.map(named),
      action: { label: "See them", href: "/documents/" }
    });
  }

  /* ---- customers' numbers ---- */
  const badGstin = live
    .map((d) => ({ d, verdict: checkGstin(d.doc.buyer.taxId, d.doc.buyer.region) }))
    .filter(({ d, verdict }) => (d.doc.buyer.taxId ?? "").trim() !== "" && !verdict.valid);
  if (badGstin.length) {
    out.push({
      id: "buyer-gstin", severity: "stop",
      title: `${badGstin.length} customer tax number${badGstin.length === 1 ? "" : "s"} cannot be right`,
      detail: `${badGstin[0].verdict.says} A number that does not check out is rejected by the portal, and until it is fixed your customer cannot claim the credit.`,
      documents: badGstin.map(({ d }) => named(d)),
      action: { label: "See the documents", href: "/documents/" }
    });
  }

  /* ---- place of supply ---- */
  const noPos = live.filter((d) => !(d.doc.placeOfSupply || d.doc.buyer.region));
  if (noPos.length) {
    out.push({
      id: "place-of-supply", severity: "stop",
      title: `${noPos.length} document${noPos.length === 1 ? " has" : "s have"} no place of supply`,
      detail: "Every line of the return carries a state. Without one the return cannot say where the supply happened, and the tax may be under the wrong head.",
      documents: noPos.map(named)
    });
  }

  /* ---- HSN codes ---- */
  const noHsn = live.filter((d) => d.doc.items.some((i) => !i.code));
  if (noHsn.length) {
    out.push({
      id: "hsn", severity: "check",
      title: `${noHsn.length} document${noHsn.length === 1 ? " has lines" : "s have lines"} with no HSN or SAC code`,
      detail: "The HSN summary is part of the return, and how many digits you need depends on your turnover. Codes can be found and attached from the HSN finder.",
      documents: noHsn.map(named),
      action: { label: "Find codes", href: "/hsn-code-finder/" }
    });
  }

  /* ---- the threshold that moved ---- */
  const [older, newer] = B2CL_THRESHOLDS;
  const ambiguous = live.filter((d) => {
    const totals = calculate(d.doc);
    const unregistered = !checkGstin(d.doc.buyer.taxId).valid;
    return unregistered && totals.supply.interRegion
      && totals.total.minor > newer.amountMinor && totals.total.minor <= older.amountMinor;
  });
  if (ambiguous.length && newer.status === "unverified") {
    out.push({
      id: "b2cl-threshold", severity: "check",
      title: `${ambiguous.length} sale${ambiguous.length === 1 ? "" : "s"} sit${ambiguous.length === 1 ? "s" : ""} between the two B2CL thresholds`,
      detail: `An inter-state sale to somebody without a GSTIN is listed invoice by invoice above the threshold and summarised below it. The figure was reduced from ₹2,50,000 to ₹1,00,000 by ${newer.source}, which we have not verified ourselves. Confirm which applies to ${period.label} before filing; it changes which section these appear in, not the tax.`,
      documents: ambiguous.map(named)
    });
  }

  /* ---- foreign-currency invoices with no rate ---- */
  const noRate = live.filter((d) => d.currency !== "INR" && !rateFor(d.currency, "INR", documents, d.doc.fxRate));
  if (noRate.length) {
    out.push({
      id: "no-fx-rate", severity: "stop",
      title: `${noRate.length} invoice${noRate.length === 1 ? " is" : "s are"} in another currency with no exchange rate`,
      detail: `A return is written in rupees, so an invoice in ${[...new Set(noRate.map((d) => d.currency))].join(" or ")} needs the rate it was worth on the day. Without one it cannot go on the return, and it is left off these figures.`,
      documents: noRate.map(named),
      action: { label: "See the documents", href: "/documents/" }
    });
  }

  /* ---- gaps in the numbering ---- */
  const gaps = opts.return.docs.flatMap((row) => row.missing);
  if (gaps.length) {
    out.push({
      id: "series-gaps", severity: "check",
      title: `${gaps.length} number${gaps.length === 1 ? " is" : "s are"} missing from your invoice series`,
      detail: `Nothing accounts for ${gaps.slice(0, 6).join(", ")}${gaps.length > 6 ? ` and ${gaps.length - 6} more` : ""}. Usually that is an invoice issued outside NXOne, or one cancelled without being recorded. The return asks for the numbers you issued and how many were cancelled, so it is worth knowing which.`
    });
  }

  /* ---- what the books say the tax was ---- */
  const ledger = ledgerFor(documents, expenses.filter((e) => !e.deletedAt).map((e) => ({
    id: e.id, date: e.date, supplier: e.supplier, category: e.category, currency: e.currency,
    netMinor: e.netMinor, taxMinor: e.taxMinor, paidFrom: e.paidFrom, stockQuantity: e.stockQuantity
  })), currency);
  const posted = balances(ledger, currency, period.from, period.to).find((r) => r.code === "2100")?.balance.minor ?? 0;
  const inReturn = opts.return.totals.taxMinor;
  const drift = Math.abs(posted - inReturn);
  if (drift > 100) {
    out.push({
      id: "ledger-drift", severity: "check",
      title: "The tax on the return and the tax in your accounts do not match",
      detail: `The return adds up to ${(inReturn / 100).toFixed(2)} and the accounts hold ${(posted / 100).toFixed(2)} for ${period.label}, a difference of ${(drift / 100).toFixed(2)}. Usually a document was edited after it was sent, or one was cancelled without being marked cancelled.`,
      action: { label: "See the accounts", href: "/books/" }
    });
  }

  /* ---- anything the documents themselves complained about ---- */
  const warned = live
    .map((d) => ({ d, warnings: calculate(d.doc).warnings }))
    .filter(({ warnings }) => warnings.length);
  if (warned.length) {
    out.push({
      id: "document-warnings", severity: "check",
      title: `${warned.length} document${warned.length === 1 ? "" : "s"} carried a warning when it was made`,
      detail: warned[0].warnings[0],
      documents: warned.map(({ d }) => named(d))
    });
  }

  /* ---- cancelled, which the return still wants counted ---- */
  const cancelled = sales.filter((d) => d.status === "cancelled");
  if (cancelled.length) {
    out.push({
      id: "cancelled", severity: "check",
      title: `${cancelled.length} cancelled document${cancelled.length === 1 ? "" : "s"} in this period`,
      detail: "These are left out of the figures but counted in the list of documents issued, which is what the return asks for.",
      documents: cancelled.map(named)
    });
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "stop" ? -1 : 1));
}

/** Whether the return is fit to file, in one line. */
export function verdictOf(findings: Finding[]): { ready: boolean; says: string } {
  const stops = findings.filter((f) => f.severity === "stop").length;
  const checks = findings.length - stops;
  if (stops) return { ready: false, says: `${stops} thing${stops === 1 ? "" : "s"} would be wrong on the return as it stands.` };
  if (checks) return { ready: true, says: `Nothing is obviously wrong. ${checks} thing${checks === 1 ? "" : "s"} worth a look first.` };
  return { ready: true, says: "Nothing here looks wrong." };
}
