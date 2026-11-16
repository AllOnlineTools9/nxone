/**
 * Tax collected at source: tax you add to a customer's bill and hand over.
 *
 * The mirror image of TDS. There it is held back from what you pay a supplier; here it is added
 * to what you charge a customer, collected with the invoice, and paid to the government. The one
 * most small businesses meet is on the sale of goods, which only bites once the business is
 * large enough — but a scrap dealer or a timber merchant meets it from the first sale.
 *
 * Read from published summaries rather than from the Act, so nothing here is marked published.
 */

export interface TcsRule {
  id: string;
  label: string;
  describes: string;
  rate: number;
  /** Collected only on what is above this, per customer per year, where there is a threshold. */
  thresholdMinor?: number;
  /** Only applies once the seller's own turnover is above this. */
  sellerTurnoverMinor?: number;
  /** The rate when the buyer has given no PAN. */
  noPanRate: number;
  source: string;
  status: "published" | "unverified";
}

const SOURCE = "Published summaries of section 206C of the Income-tax Act (2026)";

export const TCS_RULES: TcsRule[] = [
  {
    id: "206C1H",
    label: "Sale of goods",
    describes: "Ordinary goods, once your turnover last year was above ₹10 crore and you sell more than ₹50 lakh to one customer in a year.",
    rate: 0.001,
    thresholdMinor: 50_00_000_00,
    sellerTurnoverMinor: 10_00_00_000_00,
    noPanRate: 0.01,
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "scrap",
    label: "Scrap",
    describes: "Waste and scrap from manufacture or mechanical working of materials.",
    rate: 0.01,
    noPanRate: 0.05,
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "timber",
    label: "Timber and forest produce",
    describes: "Timber obtained under a forest lease or otherwise, and other forest produce.",
    rate: 0.025,
    noPanRate: 0.05,
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "minerals",
    label: "Minerals",
    describes: "Coal, lignite and iron ore.",
    rate: 0.01,
    noPanRate: 0.05,
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "vehicle",
    label: "A motor vehicle above ₹10 lakh",
    describes: "A single vehicle sold for more than ₹10 lakh.",
    rate: 0.01,
    thresholdMinor: 10_00_000_00,
    noPanRate: 0.01,
    source: SOURCE,
    status: "unverified"
  }
];

export const tcsRule = (id: string): TcsRule | undefined => TCS_RULES.find((r) => r.id === id);

export interface TcsInput {
  id: string;
  date: string;
  customer: string;
  /** The value of the sale, before this tax is added. */
  amountMinor: number;
  ruleId?: string;
  buyerPan?: string;
}

export interface TcsCollection {
  saleId: string;
  date: string;
  customer: string;
  ruleId: string;
  label: string;
  /** The part of this sale that is above the threshold, which is what it is charged on. */
  chargeableMinor: number;
  rate: number;
  collectMinor: number;
  noPan: boolean;
  /** True when the threshold was crossed by this sale rather than an earlier one. */
  crossedHere: boolean;
}

/** Rounded to the rupee, which is how it is collected and reported. */
const toRupee = (minor: number) => Math.round(minor / 100) * 100;

/**
 * What to collect across a year's sales to one customer under one rule.
 *
 * Thresholds are per customer per year and apply only to the excess, not to the whole: on a
 * ₹60 lakh year with a ₹50 lakh threshold, the tax is on ₹10 lakh. Charging the whole amount is
 * the usual mistake, and it overcharges the customer rather than the government.
 */
export function collectionsFor(sales: TcsInput[], ruleId: string, sellerTurnoverMinor?: number): TcsCollection[] {
  const rule = tcsRule(ruleId);
  if (!rule) return [];

  // Some rules only start once the seller is large enough. Below that, nothing is collected.
  if (rule.sellerTurnoverMinor && (sellerTurnoverMinor ?? 0) < rule.sellerTurnoverMinor) return [];

  const ordered = [...sales].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const threshold = rule.thresholdMinor ?? 0;
  let running = 0;
  const out: TcsCollection[] = [];

  for (const sale of ordered) {
    const before = running;
    running += sale.amountMinor;

    const chargeable = Math.max(0, running - Math.max(threshold, before));
    const noPan = !sale.buyerPan?.trim();
    const rate = noPan ? rule.noPanRate : rule.rate;

    out.push({
      saleId: sale.id,
      date: sale.date,
      customer: sale.customer,
      ruleId: rule.id,
      label: rule.label,
      chargeableMinor: chargeable,
      rate: chargeable > 0 ? rate : 0,
      collectMinor: chargeable > 0 ? toRupee(chargeable * rate) : 0,
      noPan: chargeable > 0 && noPan,
      crossedHere: before < threshold && running > threshold
    });
  }

  return out;
}

export interface TcsReview {
  collections: TcsCollection[];
  totalMinor: number;
  /** Customers who have crossed a threshold, so every later sale attracts it too. */
  crossed: Array<{ customer: string; ruleId: string; sinceMinor: number }>;
}

export function reviewTcs(input: {
  sales: TcsInput[];
  sellerTurnoverMinor?: number;
}): TcsReview {
  const byPair = new Map<string, TcsInput[]>();
  for (const sale of input.sales) {
    if (!sale.ruleId) continue;
    const key = `${sale.customer}|${sale.ruleId}`;
    byPair.set(key, [...(byPair.get(key) ?? []), sale]);
  }

  const collections: TcsCollection[] = [];
  for (const [key, list] of byPair) {
    const [, ruleId] = key.split("|");
    collections.push(...collectionsFor(list, ruleId, input.sellerTurnoverMinor));
  }
  collections.sort((a, b) => a.date.localeCompare(b.date));

  const crossed = collections
    .filter((c) => c.crossedHere)
    .map((c) => ({ customer: c.customer, ruleId: c.ruleId, sinceMinor: c.chargeableMinor }));

  return {
    collections,
    totalMinor: collections.reduce((sum, c) => sum + c.collectMinor, 0),
    crossed
  };
}

export const TCS_CAVEAT =
  "Rates and thresholds here are read from published summaries rather than from the Act, and which goods attract this is narrower than it looks. Confirm with whoever files your returns before charging it to a customer.";
