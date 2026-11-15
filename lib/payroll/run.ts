import {
  contributionPeriod, employeeInsurance, financialYear, professionalTax, providentFund, taxOnSalary,
  type EsiResult, type PfResult, type TaxResult
} from "./statutory";

/**
 * A month's payroll: what each person is paid, what is held back, and what it costs the business.
 *
 * A salary run is arithmetic over a structure, so the structure is the thing worth getting right.
 * Everything a payslip shows traces to a named rule with a date on it, and anything the rules
 * cannot answer — a state whose professional tax we do not hold — is carried through to the
 * payslip as a question rather than filled in with a nil.
 */

export interface Employee {
  id: string;
  name: string;
  /** Payroll number, as it appears on the ECR. */
  code?: string;
  joined: string;
  left?: string;
  /** The month's pay, split the way the law cares about. */
  basicMinor: number;
  daMinor?: number;
  hraMinor?: number;
  otherAllowancesMinor?: number;
  /** The state they work in, which decides professional tax. */
  region?: string;
  pf?: { enrolled: boolean; uan?: string; capAtCeiling?: boolean };
  esi?: { enrolled: boolean; number?: string; hasDisability?: boolean; coveredAtPeriodStart?: boolean };
  tax?: { regime?: "new" | "old"; declaredDeductionsMinor?: number; overrideMonthlyMinor?: number };
  bank?: { accountNumber?: string; ifsc?: string };
  pan?: string;
  deletedAt?: string;
}

export interface PayslipLine { label: string; amountMinor: number; note?: string }

export interface Payslip {
  employeeId: string;
  name: string;
  code?: string;
  month: string;
  /** Days actually worked, where somebody joined or left partway through. */
  paidDays: number;
  monthDays: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  /** What the employer pays beyond the gross. */
  employerCostMinor: number;
  pf?: PfResult;
  esi?: EsiResult;
  tax?: TaxResult;
  /** Anything the rules could not settle, carried to the payslip rather than guessed. */
  unanswered: string[];
}

export interface PayRun {
  month: string;
  label: string;
  payslips: Payslip[];
  totals: {
    employees: number;
    grossMinor: number;
    netMinor: number;
    employeePfMinor: number;
    employerPfMinor: number;
    pensionMinor: number;
    edliMinor: number;
    pfAdminMinor: number;
    employeeEsiMinor: number;
    employerEsiMinor: number;
    professionalTaxMinor: number;
    taxDeductedMinor: number;
    /** Gross plus the employer's own contributions: the true cost of the month. */
    costMinor: number;
  };
  /** What has to be paid where, by when. */
  challans: Array<{ name: string; amountMinor: number; dueOn: string; detail: string }>;
  unanswered: string[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/** The 15th of the month after, which is when provident fund, insurance and tax fall due. */
const fifteenthAfter = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-15` : `${y}-${pad(m + 1)}-15`;
};

const seventhAfter = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-07` : `${y}-${pad(m + 1)}-07`;
};

/**
 * How much of the month somebody was on the payroll. Joining on the 20th means twelve days of
 * pay, not a month of it, and the statutory wages are taken on what was actually earned.
 */
export function paidDaysFor(employee: Employee, month: string): { paid: number; total: number } {
  const total = daysIn(month);
  const first = `${month}-01`;
  const last = `${month}-${pad(total)}`;
  if (employee.joined > last) return { paid: 0, total };
  if (employee.left && employee.left < first) return { paid: 0, total };

  const from = employee.joined > first ? Number(employee.joined.slice(8, 10)) : 1;
  const to = employee.left && employee.left < last ? Number(employee.left.slice(8, 10)) : total;
  return { paid: Math.max(0, to - from + 1), total };
}

export function payslipFor(employee: Employee, month: string): Payslip {
  const date = `${month}-01`;
  const { paid, total } = paidDaysFor(employee, month);
  const part = (minor: number) => (paid === total ? minor : Math.round((minor * paid) / total));

  const basic = part(employee.basicMinor);
  const da = part(employee.daMinor ?? 0);
  const hra = part(employee.hraMinor ?? 0);
  const other = part(employee.otherAllowancesMinor ?? 0);
  const grossMinor = basic + da + hra + other;
  const unanswered: string[] = [];

  const earnings: PayslipLine[] = [
    { label: "Basic", amountMinor: basic },
    ...(da ? [{ label: "Dearness allowance", amountMinor: da }] : []),
    ...(hra ? [{ label: "House rent allowance", amountMinor: hra }] : []),
    ...(other ? [{ label: "Other allowances", amountMinor: other }] : [])
  ];

  const deductions: PayslipLine[] = [];
  let employerCostMinor = 0;

  /* ---- provident fund, on basic and dearness allowance only ---- */
  let pf: PfResult | undefined;
  if (employee.pf?.enrolled && paid > 0) {
    pf = providentFund({ pfWageMinor: basic + da, date, capAtCeiling: employee.pf.capAtCeiling });
    if (pf) {
      deductions.push({ label: "Provident fund", amountMinor: pf.employeeMinor, note: `12% of ${(pf.wageMinor / 100).toFixed(0)}` });
      employerCostMinor += pf.employerCostMinor;
    }
  }

  /* ---- employee insurance, on the whole gross ---- */
  let esi: EsiResult | undefined;
  if (employee.esi?.enrolled && paid > 0) {
    esi = employeeInsurance({
      grossMinor, date,
      hasDisability: employee.esi.hasDisability,
      coveredAtPeriodStart: employee.esi.coveredAtPeriodStart
    });
    if (esi?.covered) {
      deductions.push({
        label: "Employee insurance",
        amountMinor: esi.employeeMinor,
        note: esi.coveredToPeriodEnd ? `Above the ceiling, but covered until ${esi.coveredToPeriodEnd}` : undefined
      });
      employerCostMinor += esi.employerMinor;
    }
  }

  /* ---- professional tax, which depends entirely on the state ---- */
  if (paid > 0) {
    const pt = professionalTax({ grossMinor, region: employee.region, date });
    if (pt.known && pt.amountMinor > 0) deductions.push({ label: "Professional tax", amountMinor: pt.amountMinor });
    else if (!pt.known) unanswered.push(`${employee.name}: ${pt.reason}`);
  }

  /* ---- tax on salary ---- */
  let tax: TaxResult | undefined;
  if (paid > 0) {
    const annual = (employee.basicMinor + (employee.daMinor ?? 0) + (employee.hraMinor ?? 0) + (employee.otherAllowancesMinor ?? 0)) * 12;
    tax = taxOnSalary({
      annualSalaryMinor: annual, date,
      regime: employee.tax?.regime,
      deductionsMinor: employee.tax?.declaredDeductionsMinor,
      monthsRemaining: 12
    });
    const monthly = employee.tax?.overrideMonthlyMinor ?? tax?.monthlyMinor ?? 0;
    if (monthly > 0) {
      deductions.push({
        label: "Tax deducted at source",
        amountMinor: monthly,
        note: employee.tax?.overrideMonthlyMinor ? "Set by hand" : tax?.basis
      });
    }
  }

  const deductionsMinor = deductions.reduce((a, d) => a + d.amountMinor, 0);

  return {
    employeeId: employee.id,
    name: employee.name,
    code: employee.code,
    month,
    paidDays: paid,
    monthDays: total,
    earnings,
    deductions,
    grossMinor,
    deductionsMinor,
    netMinor: grossMinor - deductionsMinor,
    employerCostMinor,
    pf, esi, tax,
    unanswered
  };
}

export function payRun(employees: Employee[], month: string): PayRun {
  const live = employees.filter((e) => !e.deletedAt);
  const payslips = live.map((e) => payslipFor(e, month)).filter((p) => p.paidDays > 0);

  const sum = (fn: (p: Payslip) => number) => payslips.reduce((a, p) => a + fn(p), 0);
  const pt = sum((p) => p.deductions.find((d) => d.label === "Professional tax")?.amountMinor ?? 0);
  const tds = sum((p) => p.deductions.find((d) => d.label === "Tax deducted at source")?.amountMinor ?? 0);

  const totals = {
    employees: payslips.length,
    grossMinor: sum((p) => p.grossMinor),
    netMinor: sum((p) => p.netMinor),
    employeePfMinor: sum((p) => p.pf?.employeeMinor ?? 0),
    employerPfMinor: sum((p) => p.pf?.employerFundMinor ?? 0),
    pensionMinor: sum((p) => p.pf?.employerPensionMinor ?? 0),
    edliMinor: sum((p) => p.pf?.edliMinor ?? 0),
    pfAdminMinor: sum((p) => p.pf?.adminMinor ?? 0),
    employeeEsiMinor: sum((p) => (p.esi?.covered ? p.esi.employeeMinor : 0)),
    employerEsiMinor: sum((p) => (p.esi?.covered ? p.esi.employerMinor : 0)),
    professionalTaxMinor: pt,
    taxDeductedMinor: tds,
    costMinor: sum((p) => p.grossMinor + p.employerCostMinor)
  };

  // The administration charge has a floor per establishment, not per person.
  const pfRule = payslips.find((p) => p.pf)?.pf?.rule;
  const admin = pfRule && totals.pfAdminMinor > 0 ? Math.max(totals.pfAdminMinor, pfRule.adminMinimumMinor) : totals.pfAdminMinor;

  const pfTotal = totals.employeePfMinor + totals.employerPfMinor + totals.pensionMinor + totals.edliMinor + admin;
  const esiTotal = totals.employeeEsiMinor + totals.employerEsiMinor;

  const challans = [
    ...(pfTotal > 0 ? [{
      name: "Provident fund", amountMinor: pfTotal, dueOn: fifteenthAfter(month),
      detail: `Employee ${(totals.employeePfMinor / 100).toFixed(0)}, employer ${(totals.employerPfMinor / 100).toFixed(0)}, pension ${(totals.pensionMinor / 100).toFixed(0)}, insurance ${(totals.edliMinor / 100).toFixed(0)}, administration ${(admin / 100).toFixed(0)}`
    }] : []),
    ...(esiTotal > 0 ? [{
      name: "Employee insurance", amountMinor: esiTotal, dueOn: fifteenthAfter(month),
      detail: `Employee ${(totals.employeeEsiMinor / 100).toFixed(0)}, employer ${(totals.employerEsiMinor / 100).toFixed(0)}, for ${contributionPeriod(`${month}-01`).label}`
    }] : []),
    ...(tds > 0 ? [{
      name: "Tax deducted at source", amountMinor: tds, dueOn: seventhAfter(month),
      detail: `Deducted from ${payslips.filter((p) => p.deductions.some((d) => d.label === "Tax deducted at source")).length} salaries, for ${financialYear(`${month}-01`).label}`
    }] : []),
    ...(pt > 0 ? [{
      name: "Professional tax", amountMinor: pt, dueOn: fifteenthAfter(month),
      detail: "Paid to the state, on its own cycle"
    }] : [])
  ];

  return {
    month,
    label: `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`,
    payslips,
    totals: { ...totals, pfAdminMinor: admin },
    challans,
    unanswered: [...new Set(payslips.flatMap((p) => p.unanswered))]
  };
}

/**
 * The provident fund's own file format, which is what actually gets uploaded. Tab separated, one
 * line per member, in the order the portal expects.
 */
export function ecrFor(run: PayRun, employees: Employee[]): string {
  return run.payslips.map((p) => {
    const employee = employees.find((e) => e.id === p.employeeId);
    const pf = p.pf;
    const rupees = (minor: number) => Math.round(minor / 100);
    return [
      employee?.pf?.uan ?? "",
      p.name,
      rupees(pf?.wageMinor ?? 0),            // gross wages
      rupees(pf?.wageMinor ?? 0),            // EPF wages
      rupees(pf?.wageMinor ?? 0),            // EPS wages
      rupees(pf?.wageMinor ?? 0),            // EDLI wages
      rupees(pf?.employeeMinor ?? 0),        // EPF contribution due
      rupees(pf?.employerPensionMinor ?? 0), // EPS contribution due
      rupees(pf?.employerFundMinor ?? 0),    // EPF employer share due
      0,                                      // NCP days
      0                                       // refund of advances
    ].join("#~#");
  }).join("\n");
}
