/**
 * What the law takes out of a salary, and what the employer adds on top.
 *
 * Every rule here is dated and sourced, the way the tax rules are, because these figures change
 * at budgets and notifications and a payroll run from March must not be recomputed with April's
 * numbers. Where a rule is one we have not checked against the notification ourselves it says so,
 * and where we simply do not have it - a state whose professional tax slab we have not encoded -
 * it says that too instead of returning nil, which would look like an answer.
 *
 * Money is integer minor units: paise.
 */

export type RuleStatus = "published" | "unverified";

export interface Dated {
  effectiveFrom: string;
  effectiveUntil?: string;
  source: string;
  status: RuleStatus;
}

const onDate = <T extends Dated>(rules: T[], date: string): T | undefined =>
  [...rules]
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    .find((r) => r.effectiveFrom <= date && (!r.effectiveUntil || r.effectiveUntil >= date));

const pctOf = (minor: number, percent: number) => Math.round((minor * percent) / 100);

/* ------------------------------------------------------- provident fund */

export interface PfRule extends Dated {
  /** Both sides contribute this much of the provident-fund wage. */
  employeePercent: number;
  employerPercent: number;
  /** Of the employer's share, this much goes to the pension scheme instead of the fund. */
  pensionPercent: number;
  /** The wage above which contribution may be capped. */
  ceilingMinor: number;
  /** Employer-only: life insurance and the administration charge. */
  edliPercent: number;
  adminPercent: number;
  adminMinimumMinor: number;
}

export const PF_RULES: PfRule[] = [{
  effectiveFrom: "2014-09-01",
  employeePercent: 12, employerPercent: 12, pensionPercent: 8.33,
  ceilingMinor: 1500000,
  edliPercent: 0.5, adminPercent: 0.5, adminMinimumMinor: 50000,
  source: "EPF and MP Act, with the wage ceiling notified from September 2014",
  status: "published"
}];

export interface PfResult {
  /** The wage the percentages were taken on, after any ceiling. */
  wageMinor: number;
  employeeMinor: number;
  /** The employer's share, split the way the challan splits it. */
  employerPensionMinor: number;
  employerFundMinor: number;
  employerTotalMinor: number;
  edliMinor: number;
  adminMinor: number;
  /** Everything the employer pays over and above the salary. */
  employerCostMinor: number;
  rule: PfRule;
}

/**
 * Provident fund on one person for one month.
 *
 * The pension share is always taken on the ceiling even when the rest is not, which is the part
 * people get wrong by hand: the employer's 12% does not split 8.33/3.67 of the actual wage, it
 * sends 8.33% of the ceiling wage to pension and whatever is left of the 12% to the fund.
 */
export function providentFund(opts: {
  /** Basic pay plus dearness allowance. Not the gross. */
  pfWageMinor: number;
  date: string;
  /** Most employers cap at the ceiling; some contribute on the full wage. */
  capAtCeiling?: boolean;
}): PfResult | undefined {
  const rule = onDate(PF_RULES, opts.date);
  if (!rule) return undefined;

  const capped = opts.capAtCeiling === false ? opts.pfWageMinor : Math.min(opts.pfWageMinor, rule.ceilingMinor);
  const pensionWage = Math.min(opts.pfWageMinor, rule.ceilingMinor);

  const employeeMinor = pctOf(capped, rule.employeePercent);
  const employerTotalMinor = pctOf(capped, rule.employerPercent);
  const employerPensionMinor = pctOf(pensionWage, rule.pensionPercent);
  const employerFundMinor = Math.max(0, employerTotalMinor - employerPensionMinor);
  const edliMinor = pctOf(pensionWage, rule.edliPercent);
  const adminMinor = pctOf(capped, rule.adminPercent);

  return {
    wageMinor: capped,
    employeeMinor,
    employerPensionMinor,
    employerFundMinor,
    employerTotalMinor,
    edliMinor,
    adminMinor,
    employerCostMinor: employerTotalMinor + edliMinor + adminMinor,
    rule
  };
}

/* ----------------------------------------------------- employee insurance */

export interface EsiRule extends Dated {
  employeePercent: number;
  employerPercent: number;
  /** Gross monthly wage at or below which a person is covered. */
  ceilingMinor: number;
  disabilityCeilingMinor: number;
}

export const ESI_RULES: EsiRule[] = [{
  effectiveFrom: "2019-07-01",
  employeePercent: 0.75, employerPercent: 3.25,
  ceilingMinor: 2100000, disabilityCeilingMinor: 2500000,
  source: "ESI Act, rates notified from July 2019",
  status: "published"
}];

/**
 * The two halves of the ESI year. A person who rises above the ceiling partway through one keeps
 * contributing until it ends, which is the rule that catches employers out at appraisal time.
 */
export function contributionPeriod(date: string): { from: string; to: string; label: string } {
  const [y, m] = date.split("-").map(Number);
  return m >= 4 && m <= 9
    ? { from: `${y}-04-01`, to: `${y}-09-30`, label: `April to September ${y}` }
    : m >= 10
      ? { from: `${y}-10-01`, to: `${y + 1}-03-31`, label: `October ${y} to March ${y + 1}` }
      : { from: `${y - 1}-10-01`, to: `${y}-03-31`, label: `October ${y - 1} to March ${y}` };
}

export interface EsiResult {
  covered: boolean;
  /** Set when the person is over the ceiling but still covered to the end of the half-year. */
  coveredToPeriodEnd?: string;
  employeeMinor: number;
  employerMinor: number;
  rule: EsiRule;
}

export function employeeInsurance(opts: {
  grossMinor: number;
  date: string;
  hasDisability?: boolean;
  /** Was this person contributing when the current half-year began? */
  coveredAtPeriodStart?: boolean;
}): EsiResult | undefined {
  const rule = onDate(ESI_RULES, opts.date);
  if (!rule) return undefined;

  const ceiling = opts.hasDisability ? rule.disabilityCeilingMinor : rule.ceilingMinor;
  const under = opts.grossMinor <= ceiling;
  const carriedOn = !under && opts.coveredAtPeriodStart === true;
  const covered = under || carriedOn;

  return {
    covered,
    ...(carriedOn ? { coveredToPeriodEnd: contributionPeriod(opts.date).to } : {}),
    employeeMinor: covered ? pctOf(opts.grossMinor, rule.employeePercent) : 0,
    employerMinor: covered ? pctOf(opts.grossMinor, rule.employerPercent) : 0,
    rule
  };
}

/* ------------------------------------------------------ professional tax */

export interface PtSlab { aboveMinor: number; amountMinor: number }

export interface PtRule extends Dated {
  region: string;
  /** Monthly slabs, read from the top down. */
  slabs: PtSlab[];
  /** Some states charge a different amount in one month of the year. */
  februaryMinor?: number;
  note?: string;
}

/**
 * Professional tax, which is a state tax with a different answer in every state.
 *
 * Only the states we have encoded are here. For anywhere else `professionalTax` says it does not
 * know rather than returning nil - a wrong nil is indistinguishable from a correct one on a
 * payslip, and that is how an employer finds out at assessment.
 */
export const PT_RULES: PtRule[] = [
  {
    region: "KA", effectiveFrom: "2023-04-01",
    slabs: [{ aboveMinor: 2500000, amountMinor: 20000 }, { aboveMinor: 0, amountMinor: 0 }],
    source: "Karnataka Tax on Professions Act, amended 2023", status: "published"
  },
  {
    region: "MH", effectiveFrom: "2023-04-01",
    slabs: [
      { aboveMinor: 1000000, amountMinor: 20000 },
      { aboveMinor: 750000, amountMinor: 17500 },
      { aboveMinor: 0, amountMinor: 0 }
    ],
    februaryMinor: 30000,
    note: "Maharashtra exempts women up to a higher wage. That exemption is not applied here; check it for women on your payroll.",
    source: "Maharashtra State Tax on Professions Act", status: "unverified"
  },
  {
    region: "WB", effectiveFrom: "2022-04-01",
    slabs: [
      { aboveMinor: 4000000, amountMinor: 20000 },
      { aboveMinor: 2500000, amountMinor: 15000 },
      { aboveMinor: 1500000, amountMinor: 13000 },
      { aboveMinor: 1000000, amountMinor: 11000 },
      { aboveMinor: 0, amountMinor: 0 }
    ],
    source: "West Bengal State Tax on Professions Act", status: "unverified"
  },
  {
    region: "TG", effectiveFrom: "2020-04-01",
    slabs: [
      { aboveMinor: 2000000, amountMinor: 20000 },
      { aboveMinor: 1500000, amountMinor: 15000 },
      { aboveMinor: 0, amountMinor: 0 }
    ],
    source: "Telangana Tax on Professions Act", status: "unverified"
  },
  {
    region: "AP", effectiveFrom: "2020-04-01",
    slabs: [
      { aboveMinor: 2000000, amountMinor: 20000 },
      { aboveMinor: 1500000, amountMinor: 15000 },
      { aboveMinor: 0, amountMinor: 0 }
    ],
    source: "Andhra Pradesh Tax on Professions Act", status: "unverified"
  },
  {
    region: "GJ", effectiveFrom: "2022-04-01",
    slabs: [{ aboveMinor: 1200000, amountMinor: 20000 }, { aboveMinor: 0, amountMinor: 0 }],
    source: "Gujarat State Tax on Professions Act, amended 2022", status: "unverified"
  }
];

/** States that levy no professional tax at all, so nil there is an answer rather than a gap. */
export const NO_PROFESSIONAL_TAX = ["DL", "HR", "UP", "UT", "RJ", "AN", "CH", "JK", "LA", "GA", "AR", "HP"];

/** States that collect it half-yearly, which a monthly payslip should not pretend to deduct. */
export const HALF_YEARLY_PT = ["TN", "KL"];

export type PtVerdict =
  | { known: true; amountMinor: number; rule: PtRule }
  | { known: true; amountMinor: 0; none: true }
  | { known: false; reason: string };

export function professionalTax(opts: { grossMinor: number; region: string | undefined; date: string }): PtVerdict {
  const region = (opts.region ?? "").toUpperCase();
  if (!region) return { known: false, reason: "No state is set for this employee, and professional tax depends on the state." };
  if (NO_PROFESSIONAL_TAX.includes(region)) return { known: true, amountMinor: 0, none: true };
  if (HALF_YEARLY_PT.includes(region)) {
    return { known: false, reason: `${region} collects professional tax half-yearly rather than monthly, so it is not deducted here. Pay it on its own cycle.` };
  }

  const rule = onDate(PT_RULES.filter((r) => r.region === region), opts.date);
  if (!rule) return { known: false, reason: `We do not hold the professional tax slabs for ${region}. Put the amount in by hand and check it against your state's own table.` };

  const month = Number(opts.date.slice(5, 7));
  const slab = rule.slabs.find((s) => opts.grossMinor > s.aboveMinor);
  const amountMinor = month === 2 && rule.februaryMinor && slab && slab.amountMinor > 0 ? rule.februaryMinor : (slab?.amountMinor ?? 0);
  return { known: true, amountMinor, rule };
}

/* ------------------------------------------------------- tax on salary */

export interface TaxSlab { uptoMinor: number | null; percent: number }

export interface RegimeRule extends Dated {
  regime: "new" | "old";
  financialYearFrom: string;
  slabs: TaxSlab[];
  standardDeductionMinor: number;
  /** Income at or below which the rebate wipes the tax out entirely. */
  rebateUptoMinor: number;
  rebateMaxMinor: number;
  cessPercent: number;
}

/**
 * The slabs. These change at every budget, so each carries the financial year it belongs to and
 * a payroll run uses the one in force on its own date rather than today's.
 */
export const REGIMES: RegimeRule[] = [
  {
    regime: "new", financialYearFrom: "2025-04-01", effectiveFrom: "2025-04-01",
    slabs: [
      { uptoMinor: 40000000, percent: 0 },
      { uptoMinor: 80000000, percent: 5 },
      { uptoMinor: 120000000, percent: 10 },
      { uptoMinor: 160000000, percent: 15 },
      { uptoMinor: 200000000, percent: 20 },
      { uptoMinor: 240000000, percent: 25 },
      { uptoMinor: null, percent: 30 }
    ],
    standardDeductionMinor: 7500000,
    rebateUptoMinor: 120000000, rebateMaxMinor: 6000000, cessPercent: 4,
    source: "Finance Act 2025, section 115BAC rates",
    status: "published"
  },
  {
    regime: "old", financialYearFrom: "2025-04-01", effectiveFrom: "2025-04-01",
    slabs: [
      { uptoMinor: 25000000, percent: 0 },
      { uptoMinor: 50000000, percent: 5 },
      { uptoMinor: 100000000, percent: 20 },
      { uptoMinor: null, percent: 30 }
    ],
    standardDeductionMinor: 5000000,
    rebateUptoMinor: 50000000, rebateMaxMinor: 1250000, cessPercent: 4,
    source: "Income Tax Act, rates for individuals below 60",
    status: "published"
  }
];

/** The financial year a date falls in, which in India begins in April. */
export function financialYear(date: string): { from: string; to: string; label: string } {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${start}-${String(start + 1).slice(2)}` };
}

export interface TaxResult {
  /** Income after the standard deduction and anything else claimed. */
  taxableMinor: number;
  beforeRebateMinor: number;
  rebateMinor: number;
  cessMinor: number;
  annualMinor: number;
  monthlyMinor: number;
  regime: RegimeRule;
  /** Said on the payslip, because an estimate presented as a fact is a complaint waiting to happen. */
  basis: string;
}

/**
 * Tax on a salary for the year, and the slice of it to deduct this month.
 *
 * This is an estimate and is labelled as one: it assumes the salary runs unchanged to the end of
 * the year and counts only what the employer has been told about. The person's own return is
 * where it is settled.
 */
export function taxOnSalary(opts: {
  annualSalaryMinor: number;
  date: string;
  regime?: "new" | "old";
  /** Deductions the employee has declared, under the old regime. */
  deductionsMinor?: number;
  /** Months left in the financial year to spread it over. Twelve at the start of the year. */
  monthsRemaining?: number;
}): TaxResult | undefined {
  const wanted = opts.regime ?? "new";
  const rule = onDate(REGIMES.filter((r) => r.regime === wanted), opts.date);
  if (!rule) return undefined;

  const deductions = wanted === "old" ? (opts.deductionsMinor ?? 0) : 0;
  const taxableMinor = Math.max(0, opts.annualSalaryMinor - rule.standardDeductionMinor - deductions);

  let tax = 0;
  let last = 0;
  for (const slab of rule.slabs) {
    const top = slab.uptoMinor ?? Number.MAX_SAFE_INTEGER;
    if (taxableMinor > last) tax += pctOf(Math.min(taxableMinor, top) - last, slab.percent);
    last = top;
    if (taxableMinor <= top) break;
  }

  // The rebate wipes out the tax below the threshold. Just above it, marginal relief keeps the
  // extra tax from exceeding the extra income, which is the cliff the relief exists to smooth.
  let rebate = 0;
  if (taxableMinor <= rule.rebateUptoMinor) rebate = Math.min(tax, rule.rebateMaxMinor);
  else {
    const over = taxableMinor - rule.rebateUptoMinor;
    if (tax > over) rebate = tax - over;
  }

  const beforeCess = Math.max(0, tax - rebate);
  const cessMinor = pctOf(beforeCess, rule.cessPercent);
  const annualMinor = beforeCess + cessMinor;
  const months = Math.max(1, Math.min(12, Math.round(opts.monthsRemaining ?? 12)));

  return {
    taxableMinor,
    beforeRebateMinor: tax,
    rebateMinor: rebate,
    cessMinor,
    annualMinor,
    monthlyMinor: Math.round(annualMinor / months),
    regime: rule,
    basis: `Estimated on a salary of this size running to the end of ${financialYear(opts.date).label}, under the ${wanted} regime, spread over ${months} month${months === 1 ? "" : "s"}. Your own return settles it.`
  };
}
