import { calculate } from "../documents/totals";
import { booksView, convertMinor, rateFor } from "../fx";
import { openingOf } from "../ledger/opening";
import { ledgerFor } from "../ledger/posting";
import { cashFlow, profitAndLoss } from "../ledger/statements";
import { monthPeriod } from "../store/reports";
import type { CatalogueItem, Expense, Profile, SavedDocument } from "../store/types";
import type { StockItem } from "../stock/ledger";
import type { Baseline } from "./scenario";

/**
 * A typical month, worked out from the books rather than asked for.
 *
 * The scenario simulator needs four figures: sales, the costs that move with sales, the costs
 * that do not, and the cash in hand. Three of those come from an average of whole months already
 * recorded — the month in progress is left out, because a month that is four days old would halve
 * every figure. The fourth comes from the ledger as it stands today.
 *
 * Every figure is offered to the owner to correct. A "typical month" is a judgement, and the
 * person running the business makes it better than an average does; what this saves them is
 * typing it from nothing.
 */

/**
 * The costs that move with sales. Cost of sales plainly does; card and transfer fees do too,
 * because they are charged per sale. Everything else is treated as standing, which is the
 * cautious way round: it means a scenario never flatters you by assuming a cost will shrink.
 */
export const VARIABLE_CODES = new Set(["5000", "6090"]);

export interface CategoryShare {
  code: string;
  name: string;
  /** Averaged over the window, in minor units. */
  monthlyMinor: number;
}

export interface DerivedBaseline {
  baseline: Baseline;
  basis: {
    /** "July 2026 to September 2026", for the screen. */
    label: string;
    from: string;
    to: string;
    months: number;
    /** True when the average rests on too little to trust: the owner should check it. */
    thin: boolean;
    /** True when the window held nothing at all and the current month was used instead. */
    usedCurrentMonth: boolean;
  };
  variable: CategoryShare[];
  fixed: CategoryShare[];
  /** The customer the business leans on most, so "what if I lose them" can name a real one. */
  biggestCustomer?: { name: string; monthlyMinor: number; sharePercent: number };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The last `months` whole calendar months, not including the one in progress. */
export function wholeMonthsBefore(today: string, months: number): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - months, 1));
  const end = new Date(Date.UTC(y, m - 1, 0));
  return {
    from: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-01`,
    to: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
  };
}

const forLedger = (expenses: Expense[]) =>
  expenses.filter((e) => !e.deletedAt).map((e) => ({
    id: e.id, date: e.date, supplier: e.supplier, description: e.description, category: e.category,
    currency: e.currency, netMinor: e.netMinor, taxMinor: e.taxMinor, paidFrom: e.paidFrom, stockQuantity: e.stockQuantity, fxRate: e.fxRate
  }));

const isSale = (d: SavedDocument) => d.kind === "invoice" || d.kind === "proforma";
const owedOn = (d: SavedDocument) => Math.max(0, d.totalMinor - d.paidMinor);

export function baselineFrom(opts: {
  documents: SavedDocument[];
  expenses: Expense[];
  profile?: Profile;
  today: string;
  currency: string;
  /** Whole months to average over. Default 3: long enough to even out a quiet month. */
  months?: number;
  /** The catalogue, so a business that keeps stock gets its real cost of sales. */
  items?: CatalogueItem[];
}): DerivedBaseline {
  const { documents, expenses, profile, today, currency } = opts;
  const months = Math.max(1, Math.floor(opts.months ?? 3));

  const opening = openingOf(profile);
  const ledger = ledgerFor(documents, forLedger(expenses), currency, opening, { items: (opts.items ?? []) as StockItem[] });

  // Receivables and the customer ranking below work off converted figures, as the ledger does.
  const converted = booksView(documents, expenses, currency);

  const window = wholeMonthsBefore(today, months);
  let divisor = months;
  let pl = profitAndLoss(ledger, currency, window.from, window.to);
  let basisFrom = window.from;
  let basisTo = window.to;
  let usedCurrentMonth = false;

  // Nothing in the whole months behind us: a business a fortnight old still deserves an answer,
  // so the month in progress is used and plainly labelled as such.
  if (pl.totalIncome.minor === 0 && pl.totalExpenses.minor === 0) {
    const current = monthPeriod(today);
    pl = profitAndLoss(ledger, currency, current.from, today);
    divisor = 1;
    basisFrom = current.from;
    basisTo = today;
    usedCurrentMonth = true;
  }

  const share = (rows: typeof pl.expenses): CategoryShare[] =>
    rows
      .map((r) => ({ code: r.code, name: r.name, monthlyMinor: Math.round(r.balance.minor / divisor) }))
      .filter((r) => r.monthlyMinor !== 0)
      .sort((a, b) => b.monthlyMinor - a.monthlyMinor);

  const variable = share(pl.expenses.filter((r) => VARIABLE_CODES.has(r.code)));
  const fixed = share(pl.expenses.filter((r) => !VARIABLE_CODES.has(r.code)));

  const cash = cashFlow(ledger, currency, "1900-01-01", today).closing.minor;

  const receivables = converted.documents
    .filter((d) => isSale(d) && !d.deletedAt && d.currency === currency && d.status !== "draft" && d.status !== "cancelled" && d.status !== "paid")
    .reduce((a, d) => a + owedOn(d), 0);

  const payables = converted.expenses
    .filter((e) => !e.deletedAt && e.currency === currency && !e.paidFrom)
    .reduce((a, e) => a + e.netMinor + e.taxMinor, 0);

  // Who the sales actually came from, excluding tax so it sits on the same footing as income.
  const byCustomer = new Map<string, number>();
  for (const d of documents) {
    if (!isSale(d) || d.deletedAt) continue;
    if (d.status === "draft" || d.status === "cancelled") continue;
    if (d.issueDate < basisFrom || d.issueDate > basisTo) continue;
    const rate = rateFor(d.currency, currency, documents, d.doc.fxRate);
    if (!rate) continue;
    const sold = convertMinor(calculate(d.doc).taxableTotal.minor, d.currency, currency, rate.rate);
    byCustomer.set(d.clientName, (byCustomer.get(d.clientName) ?? 0) + sold);
  }
  const ranked = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]);
  const soldTotal = ranked.reduce((a, [, v]) => a + v, 0);
  const biggestCustomer = ranked.length && soldTotal > 0
    ? { name: ranked[0][0], monthlyMinor: Math.round(ranked[0][1] / divisor), sharePercent: Math.round((ranked[0][1] / soldTotal) * 100) }
    : undefined;

  const label = usedCurrentMonth
    ? `${monthPeriod(today).label} so far`
    : divisor === 1
      ? monthPeriod(basisTo).label
      : `${monthPeriod(basisFrom).label} to ${monthPeriod(basisTo).label}`;

  return {
    baseline: {
      currency,
      monthlyIncomeMinor: Math.round(pl.totalIncome.minor / divisor),
      monthlyVariableCostMinor: variable.reduce((a, r) => a + r.monthlyMinor, 0),
      monthlyFixedCostMinor: fixed.reduce((a, r) => a + r.monthlyMinor, 0),
      cashMinor: cash,
      receivablesMinor: receivables,
      payablesMinor: payables
    },
    basis: { label, from: basisFrom, to: basisTo, months: divisor, thin: usedCurrentMonth || divisor < 2, usedCurrentMonth },
    variable,
    fixed,
    biggestCustomer
  };
}

/** Whether there is enough recorded for the simulator to mean anything. */
export function enoughToSimulate(derived: DerivedBaseline): boolean {
  const b = derived.baseline;
  return b.monthlyIncomeMinor > 0 || b.monthlyVariableCostMinor + b.monthlyFixedCostMinor > 0;
}
