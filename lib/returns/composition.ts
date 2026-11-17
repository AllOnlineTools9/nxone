/**
 * The composition scheme: a smaller business's simpler bargain with GST.
 *
 * You pay a small percentage of turnover instead of tax on each sale, file one short return a
 * quarter instead of two every month, and in exchange you may not charge GST to your customers
 * and may not claim any credit on what you buy.
 *
 * It matters here because almost everything else in this product assumes regular registration.
 * A composition dealer who used the GST screens as they stand would collect tax they are not
 * allowed to collect and claim credit they are not entitled to - so the honest thing is to know
 * which scheme a business is on, and be plain about what does and does not apply.
 *
 * Rates are read from published summaries rather than from the notifications, so nothing here is
 * marked published.
 */

export type GstScheme = "regular" | "composition" | "unregistered";

export interface CompositionRate {
  id: string;
  label: string;
  describes: string;
  /** The rate on turnover, as a fraction. */
  rate: number;
  /** Split between central and state, which is how it is actually paid. */
  split: { cgst: number; sgst: number };
  source: string;
  status: "published" | "unverified";
}

const SOURCE = "Published summaries of the composition scheme rates under section 10 of the CGST Act (2026)";

export const COMPOSITION_RATES: CompositionRate[] = [
  {
    id: "trader",
    label: "A trader or a manufacturer",
    describes: "Buying and selling goods, or making them.",
    rate: 0.01,
    split: { cgst: 0.005, sgst: 0.005 },
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "restaurant",
    label: "A restaurant",
    describes: "Serving food and drink, where no alcohol is served.",
    rate: 0.05,
    split: { cgst: 0.025, sgst: 0.025 },
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "services",
    label: "A service provider",
    describes: "Services, under the separate scheme for small service providers.",
    rate: 0.06,
    split: { cgst: 0.03, sgst: 0.03 },
    source: SOURCE,
    status: "unverified"
  }
];

export const compositionRate = (id?: string): CompositionRate =>
  COMPOSITION_RATES.find((r) => r.id === id) ?? COMPOSITION_RATES[0];

/** Turnover limits, above which the scheme is no longer available. */
export const LIMITS = {
  goods: 150_000_000_0,
  goodsSpecialStates: 75_000_000_0,
  services: 50_000_000_0
};

/** The declaration a composition dealer's bill of supply has to carry. */
export const COMPOSITION_DECLARATION =
  "Composition taxable person, not eligible to collect tax on supplies.";

/**
 * What a composition dealer issues is a bill of supply, not a tax invoice. The difference is not
 * cosmetic: a tax invoice entitles the customer to claim credit, and issuing one while on this
 * scheme is a claim nobody is allowed to make.
 */
export const documentTitleFor = (scheme: GstScheme, fallback: string): string =>
  scheme === "composition"
    ? "Bill of Supply"
    // Calling it a tax invoice when no tax is charged would assert a right to credit that the
    // customer does not have. It is simply an invoice.
    : scheme === "unregistered" && fallback === "Tax Invoice"
      ? "Invoice"
      : fallback;

export interface Cmp08 {
  quarter: string;
  from: string;
  to: string;
  /** Turnover for the quarter, which is the whole basis of the return. */
  turnoverMinor: number;
  rate: number;
  cgstMinor: number;
  sgstMinor: number;
  /** Tax owed on inward supplies under reverse charge, which applies to this scheme too. */
  reverseChargeMinor: number;
  totalMinor: number;
  notes: string[];
}

/**
 * The quarterly return. Short by design: a turnover figure and the tax on it, which is the whole
 * point of the scheme.
 */
export function cmp08(input: {
  documents: Array<{ issueDate: string; totalMinor: number; status: string; kind: string; deletedAt?: string }>;
  reverseChargeMinor?: number;
  rateId?: string;
  from: string;
  to: string;
  quarter: string;
}): Cmp08 {
  const rate = compositionRate(input.rateId);

  const turnoverMinor = input.documents
    .filter((d) =>
      !d.deletedAt && d.status !== "cancelled" && d.status !== "draft" &&
      (d.kind === "invoice" || d.kind === "receipt") &&
      d.issueDate >= input.from && d.issueDate <= input.to)
    .reduce((sum, d) => sum + d.totalMinor, 0);

  const cgst = Math.round(turnoverMinor * rate.split.cgst);
  const sgst = Math.round(turnoverMinor * rate.split.sgst);
  const reverseCharge = input.reverseChargeMinor ?? 0;

  const notes = [
    "Turnover here is everything billed in the quarter, because under this scheme tax is on turnover rather than on each sale.",
    "No credit is claimed against this. That is the bargain: a lower rate, and nothing to set off."
  ];
  if (reverseCharge > 0) {
    notes.push("Reverse charge still applies on this scheme, and is paid on top at the ordinary rate - being on composition does not exempt you from it.");
  }

  return {
    quarter: input.quarter,
    from: input.from,
    to: input.to,
    turnoverMinor,
    rate: rate.rate,
    cgstMinor: cgst,
    sgstMinor: sgst,
    reverseChargeMinor: reverseCharge,
    totalMinor: cgst + sgst + reverseCharge,
    notes
  };
}

/** The quarter a date falls in, and when its CMP-08 is due: the 18th of the following month. */
export function compositionQuarter(iso: string): { id: string; from: string; to: string; label: string; dueOn: string } {
  const [y, m] = iso.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const table = [
    { id: "Q1", months: [4, 5, 6], dueMonth: 7, dueYear: 0 },
    { id: "Q2", months: [7, 8, 9], dueMonth: 10, dueYear: 0 },
    { id: "Q3", months: [10, 11, 12], dueMonth: 1, dueYear: 1 },
    { id: "Q4", months: [1, 2, 3], dueMonth: 4, dueYear: 1 }
  ];
  const row = table.find((q) => q.months.includes(m))!;
  const first = row.months[0];
  const last = row.months[row.months.length - 1];
  const yearOf = (month: number) => (month >= 4 ? startYear : startYear + 1);
  const lastDay = new Date(Date.UTC(yearOf(last), last, 0)).getUTCDate();
  const fyLabel = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

  return {
    id: row.id,
    from: `${yearOf(first)}-${String(first).padStart(2, "0")}-01`,
    to: `${yearOf(last)}-${String(last).padStart(2, "0")}-${lastDay}`,
    label: `${row.id} ${fyLabel}`,
    dueOn: `${startYear + row.dueYear}-${String(row.dueMonth).padStart(2, "0")}-18`
  };
}

/**
 * Whether a business has outgrown the scheme. Worth knowing before the limit is crossed, because
 * crossing it means switching to regular registration, not paying a penalty at the year end.
 */
export function outgrown(turnoverMinor: number, kind: "goods" | "services", specialState = false): {
  limitMinor: number;
  leftMinor: number;
  over: boolean;
  says?: string;
} {
  const limit = kind === "services"
    ? LIMITS.services
    : specialState ? LIMITS.goodsSpecialStates : LIMITS.goods;
  const left = limit - turnoverMinor;

  return {
    limitMinor: limit,
    leftMinor: left,
    over: left < 0,
    says: left < 0
      ? "Turnover has passed the limit for this scheme. You have to move to regular registration - and from that point you charge GST on your sales and can claim credit on your purchases."
      : left < limit * 0.1
        ? "Turnover is close to the limit for this scheme. Worth planning the switch to regular registration before it happens rather than after."
        : undefined
  };
}

/** What does not apply on this scheme, said once rather than left to be discovered. */
export const COMPOSITION_EXCLUSIONS = [
  { what: "GSTR-1 and GSTR-3B", why: "You file CMP-08 each quarter and GSTR-4 once a year instead." },
  { what: "Charging GST on an invoice", why: "You issue a bill of supply, with no tax on it, and carry the declaration." },
  { what: "Input credit", why: "Nothing you buy can be claimed back. That is the trade for the lower rate." },
  { what: "E-invoicing", why: "It does not apply to this scheme." },
  { what: "Selling to other states", why: "The scheme is for supplies within your own state." }
];

export const COMPOSITION_CAVEAT =
  "Rates and limits here are read from published summaries rather than from the notifications, and the rules on who may join differ by trade and by state. Confirm with whoever files your returns before relying on a figure.";
