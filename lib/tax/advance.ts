import { financialYearOf } from "../tds/sections";

/**
 * Advance tax: paying the year's income tax in four goes, before the year ends.
 *
 * Nobody sends a bill for this. The dates pass, the instalments are missed, and interest runs
 * from each one — so a business that pays its whole tax on time in July still pays interest for
 * the three quarters it was supposed to have paid earlier. It is the quietest recurring penalty
 * a small business meets, and the only thing needed to avoid it is knowing the dates and roughly
 * what the year will make, both of which the books already contain.
 *
 * Rates and rules are read from published summaries rather than from the Act, so nothing here is
 * marked published, and the screen says so.
 */

export type TaxpayerKind = "individual" | "firm" | "company" | "company-concessional";

export interface InstalmentRule {
  /** The day it is due, as month and day inside the financial year. */
  on: { month: number; day: number };
  /** How much of the year's tax should have been paid by then, cumulatively. */
  cumulative: number;
  label: string;
}

export const INSTALMENTS: InstalmentRule[] = [
  { on: { month: 6, day: 15 }, cumulative: 0.15, label: "First instalment" },
  { on: { month: 9, day: 15 }, cumulative: 0.45, label: "Second instalment" },
  { on: { month: 12, day: 15 }, cumulative: 0.75, label: "Third instalment" },
  { on: { month: 3, day: 15 }, cumulative: 1.00, label: "Fourth instalment" }
];

/** Below this, advance tax is not required at all and nothing here applies. */
export const NOT_REQUIRED_BELOW_MINOR = 1_000_000;

export interface RateRule {
  kind: TaxpayerKind;
  label: string;
  describes: string;
  /** A flat rate, or the slabs for an individual. */
  flatRate?: number;
  slabs?: Array<{ upToMinor: number | null; rate: number }>;
  surchargeFrom?: Array<{ overMinor: number; rate: number }>;
  cessRate: number;
  source: string;
  status: "published" | "unverified";
}

const SOURCE = "Published income tax rate summaries for the current year (2026)";

export const RATES: RateRule[] = [
  {
    kind: "individual",
    label: "A person or a proprietor",
    describes: "Your business income is taxed as part of your own income, at slab rates.",
    slabs: [
      { upToMinor: 40_000_000, rate: 0 },
      { upToMinor: 80_000_000, rate: 0.05 },
      { upToMinor: 120_000_000, rate: 0.10 },
      { upToMinor: 160_000_000, rate: 0.15 },
      { upToMinor: 200_000_000, rate: 0.20 },
      { upToMinor: 240_000_000, rate: 0.25 },
      { upToMinor: null, rate: 0.30 }
    ],
    surchargeFrom: [
      { overMinor: 5_000_000_00, rate: 0.10 },
      { overMinor: 10_000_000_00, rate: 0.15 },
      { overMinor: 20_000_000_00, rate: 0.25 }
    ],
    cessRate: 0.04,
    source: `${SOURCE}, new regime slabs`,
    status: "unverified"
  },
  {
    kind: "firm",
    label: "A partnership or an LLP",
    describes: "Taxed at a flat rate on the firm's profit.",
    flatRate: 0.30,
    cessRate: 0.04,
    source: SOURCE,
    status: "unverified"
  },
  {
    kind: "company",
    label: "A company",
    describes: "A domestic company on the ordinary rate.",
    flatRate: 0.25,
    cessRate: 0.04,
    source: SOURCE,
    status: "unverified"
  },
  {
    kind: "company-concessional",
    label: "A company on the concessional rate",
    describes: "A domestic company that has opted into the lower rate and given up most deductions.",
    flatRate: 0.22,
    cessRate: 0.04,
    source: SOURCE,
    status: "unverified"
  }
];

export const rateFor = (kind: TaxpayerKind): RateRule => RATES.find((r) => r.kind === kind) ?? RATES[0];

/** Tax on a year's profit, before anything already paid. */
export function taxOnProfit(profitMinor: number, kind: TaxpayerKind): {
  taxMinor: number;
  surchargeMinor: number;
  cessMinor: number;
  totalMinor: number;
  effectiveRate: number;
} {
  const rule = rateFor(kind);
  const profit = Math.max(0, profitMinor);

  let tax = 0;
  if (rule.slabs) {
    let last = 0;
    for (const slab of rule.slabs) {
      const ceiling = slab.upToMinor ?? Infinity;
      if (profit > last) tax += Math.min(profit, ceiling) - last > 0 ? (Math.min(profit, ceiling) - last) * slab.rate : 0;
      last = ceiling;
      if (profit <= ceiling) break;
    }
  } else {
    tax = profit * (rule.flatRate ?? 0);
  }

  const band = [...(rule.surchargeFrom ?? [])].reverse().find((s) => profit > s.overMinor);
  const surcharge = band ? tax * band.rate : 0;
  const cess = (tax + surcharge) * rule.cessRate;
  const total = Math.round(tax + surcharge + cess);

  return {
    taxMinor: Math.round(tax),
    surchargeMinor: Math.round(surcharge),
    cessMinor: Math.round(cess),
    totalMinor: total,
    effectiveRate: profit > 0 ? total / profit : 0
  };
}

/* ------------------------------------------------------------------ the year */

export interface Instalment {
  label: string;
  dueOn: string;
  cumulative: number;
  /** What should have been paid by this date, in total. */
  shouldHavePaidMinor: number;
  /** What this instalment alone asks for. */
  thisInstalmentMinor: number;
  /** What has actually been paid by this date. */
  paidByMinor: number;
  shortfallMinor: number;
  state: "paid" | "short" | "due" | "ahead";
  /** True once the date has gone by. */
  past: boolean;
  /** Interest running because this instalment was short, under 234C. */
  interestMinor: number;
}

export interface AdvanceTaxYear {
  year: string;
  kind: TaxpayerKind;
  /** The profit the estimate is built on. */
  estimatedProfitMinor: number;
  /** How the profit was arrived at, so nobody treats a projection as a fact. */
  basis: string;
  estimatedTaxMinor: number;
  /** Tax already deducted at source on your income, which counts towards the year. */
  tdsCreditMinor: number;
  /** What is left to pay across the four instalments. */
  payableMinor: number;
  paidMinor: number;
  instalments: Instalment[];
  interestMinor: number;
  required: boolean;
  notes: string[];
}

/** Interest under 234C: one per cent a month, for three months on each short instalment. */
export const INTEREST_RATE_MONTHLY = 0.01;
const MONTHS_PER_SHORTFALL = 3;

/** The date an instalment falls on, inside a given financial year. */
function dueDate(rule: InstalmentRule, fyFrom: string): string {
  const startYear = Number(fyFrom.slice(0, 4));
  const year = rule.on.month >= 4 ? startYear : startYear + 1;
  return `${year}-${String(rule.on.month).padStart(2, "0")}-${String(rule.on.day).padStart(2, "0")}`;
}

export function advanceTaxYear(input: {
  /** Profit for the year so far, from the books. */
  profitSoFarMinor: number;
  /** How much of the year has gone, 0 to 1, used to project the rest. */
  yearElapsed?: number;
  /** An estimate the person has typed, which always beats a projection. */
  statedProfitMinor?: number;
  kind: TaxpayerKind;
  today: string;
  /** Payments already made against this year's advance tax. */
  payments?: Array<{ date: string; amountMinor: number }>;
  /** TDS others have deducted from your income this year. */
  tdsCreditMinor?: number;
}): AdvanceTaxYear {
  const fy = financialYearOf(input.today);
  const elapsed = input.yearElapsed ?? elapsedOf(input.today);

  const projected = input.statedProfitMinor ?? (elapsed > 0.05
    ? Math.round(input.profitSoFarMinor / elapsed)
    : input.profitSoFarMinor);

  const basis = input.statedProfitMinor !== undefined
    ? "Your own estimate for the year."
    : elapsed > 0.05
      ? `The books show ${Math.round(elapsed * 100)}% of the year gone, so this projects the rest at the same rate. Change it if you know better — a quiet month or a big job in March moves it a long way.`
      : "Too little of the year has gone to project anything; this is what the books show so far.";

  const tax = taxOnProfit(projected, input.kind);
  const tdsCredit = input.tdsCreditMinor ?? 0;
  const payable = Math.max(0, tax.totalMinor - tdsCredit);
  const payments = input.payments ?? [];
  const paid = payments.reduce((sum, p) => sum + p.amountMinor, 0);

  const instalments: Instalment[] = INSTALMENTS.map((rule) => {
    const on = dueDate(rule, fy.from);
    const shouldHave = Math.round(payable * rule.cumulative);
    const paidBy = payments.filter((p) => p.date <= on).reduce((sum, p) => sum + p.amountMinor, 0);
    const shortfall = Math.max(0, shouldHave - paidBy);
    const past = on < input.today;

    return {
      label: rule.label,
      dueOn: on,
      cumulative: rule.cumulative,
      shouldHavePaidMinor: shouldHave,
      thisInstalmentMinor: shouldHave - Math.round(payable * previousCumulative(rule)),
      paidByMinor: paidBy,
      shortfallMinor: shortfall,
      state: shortfall === 0 ? (paidBy > shouldHave ? "ahead" : "paid") : past ? "short" : "due",
      past,
      // Only a date already gone by earns interest; a future instalment is not late yet.
      interestMinor: past && shortfall > 0 ? Math.round(shortfall * INTEREST_RATE_MONTHLY * MONTHS_PER_SHORTFALL) : 0
    };
  });

  const notes: string[] = [];
  const required = payable >= NOT_REQUIRED_BELOW_MINOR;
  if (!required) {
    notes.push("Below ₹10,000 of tax for the year, advance tax is not required at all. Nothing here applies unless the year turns out bigger than it looks.");
  }
  if (tdsCredit > 0) {
    notes.push("Tax already deducted from your income counts towards the year, so only the rest is spread across the instalments.");
  }
  if (input.statedProfitMinor === undefined && elapsed < 0.9) {
    notes.push("This is a projection from a part year. The fourth instalment is the one to get right, because by March the year is known.");
  }

  return {
    year: fy.label,
    kind: input.kind,
    estimatedProfitMinor: projected,
    basis,
    estimatedTaxMinor: tax.totalMinor,
    tdsCreditMinor: tdsCredit,
    payableMinor: payable,
    paidMinor: paid,
    instalments,
    interestMinor: required ? instalments.reduce((sum, i) => sum + i.interestMinor, 0) : 0,
    required,
    notes
  };
}

const previousCumulative = (rule: InstalmentRule): number => {
  const at = INSTALMENTS.findIndex((r) => r.label === rule.label);
  return at <= 0 ? 0 : INSTALMENTS[at - 1].cumulative;
};

/** How much of the financial year has gone by, as a fraction. */
export function elapsedOf(today: string): number {
  const fy = financialYearOf(today);
  const whole = Date.parse(fy.to) - Date.parse(fy.from);
  const gone = Date.parse(today) - Date.parse(fy.from);
  return Math.min(1, Math.max(0, gone / whole));
}

/** The next instalment to worry about, or nothing when the year is settled. */
export function nextDue(year: AdvanceTaxYear, today: string): Instalment | undefined {
  return year.instalments.find((i) => i.dueOn >= today && i.shortfallMinor > 0);
}

export const ADVANCE_TAX_CAVEAT =
  "Rates and the interest rule are read from published summaries rather than from the Act, and the estimate is only as good as the profit it is built on. Treat it as a prompt to pay something on time, not as a computation.";
