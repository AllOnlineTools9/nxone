import { TDS_SECTIONS, depositBy, financialYearOf, quarterOf, sectionById, type DeducteeType, type TdsSection } from "./sections";

/**
 * Working out what should have been deducted, and what was.
 *
 * The part people get wrong is not the rate, it is the threshold. Under 194C you deduct nothing
 * until payments to that supplier cross ₹1,00,000 in the year — and then you deduct on the whole
 * lot, including the payments you already made without deducting. That retrospective step is
 * what catches businesses out, so it is the thing this module exists to catch.
 */

export interface PaymentInput {
  id: string;
  date: string;
  supplier: string;
  supplierPan?: string;
  /** Individuals and HUFs attract a lower rate under some sections. */
  supplierType?: DeducteeType;
  /** The amount before GST: tax is deducted on the value of the service, not on the GST. */
  netMinor: number;
  /** What was actually deducted and held back, if anything. */
  tdsMinor?: number;
  tdsSection?: string;
}

export interface Deduction {
  paymentId: string;
  date: string;
  supplier: string;
  sectionId: string;
  rate: number;
  /** What the rules say should be held back from this payment. */
  shouldBeMinor: number;
  /** What was actually held back. */
  wasMinor: number;
  shortfallMinor: number;
  /** True when this payment is only caught because the year's total crossed the line. */
  becauseOfAggregate: boolean;
  /** True when the higher no-PAN rate was used. */
  noPan: boolean;
  depositBy: string;
  quarter: string;
}

/** Rounded to the rupee, which is how TDS is deposited and reported. */
const toRupee = (minor: number): number => Math.round(minor / 100) * 100;

function rateFor(section: TdsSection, payment: PaymentInput): { rate: number; noPan: boolean } {
  if (!payment.supplierPan?.trim()) return { rate: section.noPanRate, noPan: true };
  return { rate: section.rate[payment.supplierType ?? "other"], noPan: false };
}

/** Whether a month's payments to one supplier cross a monthly threshold, as rent does. */
const monthOf = (iso: string) => iso.slice(0, 7);

/**
 * What should have been deducted across a set of payments to one supplier under one section.
 *
 * Payments are taken in date order, because that is how the threshold is crossed: everything
 * before the crossing point becomes deductible at the moment it is crossed, not before.
 */
export function deductionsFor(payments: PaymentInput[], sectionId: string): Deduction[] {
  const section = sectionById(sectionId);
  if (!section) return [];

  const ordered = [...payments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const out: Deduction[] = [];

  if (section.threshold.basis === "monthly") {
    const byMonth = new Map<string, PaymentInput[]>();
    for (const payment of ordered) {
      const key = monthOf(payment.date);
      byMonth.set(key, [...(byMonth.get(key) ?? []), payment]);
    }
    for (const [, inMonth] of byMonth) {
      const total = inMonth.reduce((sum, p) => sum + p.netMinor, 0);
      const over = total > (section.threshold.aggregateMinor ?? 0);
      for (const payment of inMonth) {
        out.push(describe(payment, section, over, inMonth.length > 1 && over));
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  let running = 0;
  let crossed = false;
  const waiting: PaymentInput[] = [];

  for (const payment of ordered) {
    running += payment.netMinor;
    const single = section.threshold.singleMinor;
    const aggregate = section.threshold.aggregateMinor ?? Infinity;
    const bySingle = Boolean(single && payment.netMinor > single);
    const byAggregate = running > aggregate;

    if (!crossed && byAggregate) {
      // The year's total has just gone past the line, so everything paid earlier becomes
      // deductible too — the retrospective step that catches people out.
      crossed = true;
      for (const earlier of waiting) out.push(describe(earlier, section, true, true));
      waiting.length = 0;
      out.push(describe(payment, section, true, !bySingle));
      continue;
    }

    if (crossed || bySingle) {
      out.push(describe(payment, section, true, false));
      continue;
    }

    waiting.push(payment);
  }

  // Anything still waiting never crossed a threshold, so nothing was due on it.
  for (const payment of waiting) out.push(describe(payment, section, false, false));
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function describe(payment: PaymentInput, section: TdsSection, due: boolean, becauseOfAggregate: boolean): Deduction {
  const { rate, noPan } = rateFor(section, payment);
  const shouldBe = due ? toRupee(payment.netMinor * rate) : 0;
  const was = payment.tdsMinor ?? 0;
  return {
    paymentId: payment.id,
    date: payment.date,
    supplier: payment.supplier,
    sectionId: section.id,
    rate: due ? rate : 0,
    shouldBeMinor: shouldBe,
    wasMinor: was,
    shortfallMinor: shouldBe - was,
    becauseOfAggregate: due && becauseOfAggregate,
    noPan: due && noPan,
    depositBy: depositBy(payment.date),
    quarter: quarterOf(payment.date).label
  };
}

/* ----------------------------------------------------------------- the whole year */

export interface TdsReview {
  deductions: Deduction[];
  /** Payments where tax was due and not held back. The expensive ones. */
  missed: Deduction[];
  totalDueMinor: number;
  totalDeductedMinor: number;
  shortfallMinor: number;
  /** What is deducted but not yet shown as paid over, grouped by when it is due. */
  owed: Array<{ depositBy: string; minor: number; late: boolean }>;
  /** Suppliers approaching a threshold: worth knowing before the next bill, not after. */
  approaching: Array<{ supplier: string; sectionId: string; spentMinor: number; thresholdMinor: number; leftMinor: number }>;
}

/**
 * Everything attracting TDS in a financial year, what was missed, and who is about to cross a
 * line. The warning matters as much as the arithmetic: once a threshold is crossed the deduction
 * applies to payments already made, so knowing you are close is what lets somebody deduct on
 * time rather than find out in January.
 */
export function reviewYear(payments: PaymentInput[], today: string, warnWithinMinor = 2_000_000): TdsReview {
  const fy = financialYearOf(today);
  const inYear = payments.filter((p) => p.date >= fy.from && p.date <= fy.to);

  const groups = new Map<string, PaymentInput[]>();
  for (const payment of inYear) {
    if (!payment.tdsSection) continue;
    const key = `${payment.supplier}|${payment.tdsSection}`;
    groups.set(key, [...(groups.get(key) ?? []), payment]);
  }

  const deductions: Deduction[] = [];
  const approaching: TdsReview["approaching"] = [];

  for (const [key, list] of groups) {
    const [supplier, sectionId] = key.split("|");
    deductions.push(...deductionsFor(list, sectionId));

    const section = sectionById(sectionId);
    const limit = section?.threshold.aggregateMinor;
    if (!section || !limit || section.threshold.basis === "monthly") continue;
    const spent = list.reduce((sum, p) => sum + p.netMinor, 0);
    const left = limit - spent;
    if (left > 0 && left <= warnWithinMinor) {
      approaching.push({ supplier, sectionId, spentMinor: spent, thresholdMinor: limit, leftMinor: left });
    }
  }

  deductions.sort((a, b) => a.date.localeCompare(b.date));
  const missed = deductions.filter((d) => d.shortfallMinor > 0);

  const owedBy = new Map<string, number>();
  for (const d of deductions.filter((x) => x.wasMinor > 0)) {
    owedBy.set(d.depositBy, (owedBy.get(d.depositBy) ?? 0) + d.wasMinor);
  }

  return {
    deductions,
    missed,
    totalDueMinor: deductions.reduce((sum, d) => sum + d.shouldBeMinor, 0),
    totalDeductedMinor: deductions.reduce((sum, d) => sum + d.wasMinor, 0),
    shortfallMinor: missed.reduce((sum, d) => sum + d.shortfallMinor, 0),
    owed: [...owedBy.entries()]
      .map(([by, minor]) => ({ depositBy: by, minor, late: by < today }))
      .sort((a, b) => a.depositBy.localeCompare(b.depositBy)),
    approaching: approaching.sort((a, b) => a.leftMinor - b.leftMinor)
  };
}

/* ----------------------------------------------------------------------- the return */

export interface DeducteeRow {
  supplier: string;
  pan: string;
  sectionId: string;
  newCode?: string;
  paidMinor: number;
  deductedMinor: number;
  rate: number;
  dates: string[];
}

/** The deductee-wise rows a 26Q is built from, which is what whoever files it will ask you for. */
export function form26q(deductions: Deduction[], quarterLabel: string, pans: Map<string, string>): DeducteeRow[] {
  const rows = new Map<string, DeducteeRow>();
  for (const d of deductions.filter((x) => x.quarter === quarterLabel && x.wasMinor > 0)) {
    const key = `${d.supplier}|${d.sectionId}`;
    const existing = rows.get(key) ?? {
      supplier: d.supplier, pan: pans.get(d.supplier) ?? "", sectionId: d.sectionId,
      newCode: sectionById(d.sectionId)?.newCode, paidMinor: 0, deductedMinor: 0, rate: d.rate, dates: []
    };
    existing.paidMinor += d.rate > 0 ? Math.round(d.shouldBeMinor / d.rate) : 0;
    existing.deductedMinor += d.wasMinor;
    existing.dates.push(d.date);
    rows.set(key, existing);
  }
  return [...rows.values()].sort((a, b) => b.deductedMinor - a.deductedMinor);
}

export function form26qCsv(rows: DeducteeRow[], quarterLabel: string): string {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const amount = (minor: number) => (minor / 100).toFixed(2);
  const out: Array<Array<string | number>> = [
    ["Quarter", "Deductee", "PAN", "Section", "Payment code", "Amount paid", "Tax deducted", "Rate %", "Deduction dates"]
  ];
  for (const r of rows) {
    out.push([
      quarterLabel, r.supplier, r.pan || "NOT PROVIDED", r.sectionId, r.newCode ?? "",
      amount(r.paidMinor), amount(r.deductedMinor), (r.rate * 100).toFixed(2), r.dates.join(" ")
    ]);
  }
  out.push(["", "Total", "", "", "", amount(rows.reduce((s, r) => s + r.paidMinor, 0)), amount(rows.reduce((s, r) => s + r.deductedMinor, 0)), "", ""]);
  return out.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

/** Sections offered for an expense, best guess first. */
export const sectionsForSuggestion = () => TDS_SECTIONS;
