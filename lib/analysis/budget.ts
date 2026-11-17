import { balances, type JournalEntry } from "../ledger/journal";
import { accountByCode } from "../ledger/accounts";
import { financialYearOf } from "../tds/sections";

/**
 * What you meant to spend, against what you did.
 *
 * A budget is only useful if it is checked while there is still time to act on it, which is why
 * this works in months rather than in years: knowing in March that the year overran is history,
 * knowing in July that one account is running at twice its rate is a decision.
 *
 * So the figure that matters is not the variance to date. It is the rate: at this pace, what
 * will the year come to, and is that more than was set aside.
 */

export interface BudgetLine {
  /** The account this is a budget for. */
  code: string;
  /** The amount for the whole year, in minor units. */
  yearMinor: number;
  /** Set when a particular month differs - rent that goes up in October, say. */
  monthly?: Record<string, number>;
}

export interface BudgetComparison {
  code: string;
  name: string;
  /** Budgeted for the part of the year that has gone. */
  expectedToDateMinor: number;
  /** Actually spent in that time. */
  actualToDateMinor: number;
  varianceMinor: number;
  /** Negative means spending faster than budgeted. */
  variancePercent: number;
  /** The whole year's budget. */
  yearMinor: number;
  /** What the year will come to at the rate so far. */
  projectedMinor: number;
  /** How the year is going to end up against the budget. */
  outlook: "under" | "on-track" | "over" | "well-over";
  says?: string;
}

export interface BudgetReview {
  year: string;
  /** How much of the year has gone, as a fraction. */
  elapsed: number;
  lines: BudgetComparison[];
  totalBudgetMinor: number;
  totalActualMinor: number;
  totalProjectedMinor: number;
  /** The ones worth looking at, worst first. */
  attention: BudgetComparison[];
}

/** A month's share of a budget, taking any month-specific figure into account. */
export function budgetForMonth(line: BudgetLine, month: string): number {
  if (line.monthly && line.monthly[month] !== undefined) return line.monthly[month];
  const named = Object.values(line.monthly ?? {});
  const namedTotal = named.reduce((sum, n) => sum + n, 0);
  const unnamedMonths = 12 - named.length;
  if (unnamedMonths <= 0) return 0;
  return Math.round((line.yearMinor - namedTotal) / unnamedMonths);
}

/** The months of a financial year, as YYYY-MM, from April. */
export function monthsOfYear(from: string): string[] {
  const start = Number(from.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((3 + i) % 12) + 1;
    const year = month >= 4 ? start : start + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

export function reviewBudget(input: {
  budgets: BudgetLine[];
  entries: JournalEntry[];
  currency: string;
  today: string;
}): BudgetReview {
  const fy = financialYearOf(input.today);
  const months = monthsOfYear(fy.from);
  const goneMonths = months.filter((m) => m <= input.today.slice(0, 7));

  // Two different measures, because they answer different questions. The budget for the year so
  // far is owed in whole months - April's budget is due in April. The rate of spending has to be
  // measured in days, or the first week of April counts as a twelfth of the year and five days
  // of spending gets projected across the whole of it.
  const elapsed = Math.min(1, goneMonths.length / 12);
  const elapsedDays = Math.min(1, Math.max(0,
    (Date.parse(input.today) - Date.parse(fy.from)) / (Date.parse(fy.to) - Date.parse(fy.from))));

  const actuals = balances(input.entries, input.currency, fy.from, input.today);

  const lines: BudgetComparison[] = input.budgets.map((budget) => {
    const account = accountByCode(budget.code);
    const actual = actuals.find((row) => row.code === budget.code)?.balance.minor ?? 0;
    const expected = goneMonths.reduce((sum, m) => sum + budgetForMonth(budget, m), 0);
    const variance = expected - actual;

    // Projected at the rate so far. Under about a month of actual days, the rate says nothing,
    // so the budget itself is a better guess than extrapolating from one week.
    const projected = elapsedDays >= 1 / 12 ? Math.round(actual / elapsedDays) : budget.yearMinor;

    const over = projected - budget.yearMinor;
    const outlook: BudgetComparison["outlook"] =
      budget.yearMinor === 0 ? "on-track"
        : over > budget.yearMinor * 0.2 ? "well-over"
          : over > budget.yearMinor * 0.05 ? "over"
            : over < -budget.yearMinor * 0.05 ? "under"
              : "on-track";

    return {
      code: budget.code,
      name: account?.name ?? budget.code,
      expectedToDateMinor: expected,
      actualToDateMinor: actual,
      varianceMinor: variance,
      variancePercent: expected === 0 ? 0 : (variance / expected) * 100,
      yearMinor: budget.yearMinor,
      projectedMinor: projected,
      outlook,
      says: outlook === "well-over"
        ? `At this rate the year comes to ${Math.round((projected / budget.yearMinor) * 100)}% of what was set aside. Something has changed, or the budget was wrong.`
        : outlook === "over"
          ? "Running ahead of the budget. Still recoverable if it is caught now."
          : outlook === "under"
            ? "Running under. Worth knowing whether that is thrift or something that has not been billed yet."
            : undefined
    };
  });

  return {
    year: fy.label,
    elapsed: elapsedDays,
    lines: lines.sort((a, b) => a.name.localeCompare(b.name)),
    totalBudgetMinor: lines.reduce((sum, l) => sum + l.yearMinor, 0),
    totalActualMinor: lines.reduce((sum, l) => sum + l.actualToDateMinor, 0),
    totalProjectedMinor: lines.reduce((sum, l) => sum + l.projectedMinor, 0),
    attention: lines
      .filter((l) => l.outlook === "over" || l.outlook === "well-over")
      .sort((a, b) => (b.projectedMinor - b.yearMinor) - (a.projectedMinor - a.yearMinor))
  };
}

/**
 * A starting budget from what was actually spent last year.
 *
 * Most people never set a budget because the blank form is the obstacle. Last year's figures are
 * a defensible first draft, and arguing with a number already on the page is far easier than
 * inventing one.
 */
export function fromLastYear(entries: JournalEntry[], currency: string, today: string): BudgetLine[] {
  const thisYear = financialYearOf(today);
  const lastYear = financialYearOf(`${Number(thisYear.from.slice(0, 4)) - 1}-06-01`);

  return balances(entries, currency, lastYear.from, lastYear.to)
    .filter((row) => row.type === "expense" && row.balance.minor > 0)
    .map((row) => ({ code: row.code, yearMinor: row.balance.minor }))
    .sort((a, b) => b.yearMinor - a.yearMinor);
}

/**
 * A first draft for a business with no last year to copy: this year's spending so far, scaled
 * to a whole year and rounded to the nearest hundred so it reads as a target, not a calculation.
 *
 * Under about a month of trading the rate says nothing, so the figures so far are used as they
 * stand rather than multiplied up from a few days.
 */
export function fromThisYear(entries: JournalEntry[], currency: string, today: string): BudgetLine[] {
  const fy = financialYearOf(today);
  const elapsed = Math.min(1, Math.max(0,
    (Date.parse(today) - Date.parse(fy.from)) / (Date.parse(fy.to) - Date.parse(fy.from))));
  const scale = elapsed >= 1 / 12 ? 1 / elapsed : 1;

  return balances(entries, currency, fy.from, today)
    .filter((row) => row.type === "expense" && row.balance.minor > 0)
    .map((row) => ({ code: row.code, yearMinor: Math.round((row.balance.minor * scale) / 10_000) * 10_000 }))
    .filter((line) => line.yearMinor > 0)
    .sort((a, b) => b.yearMinor - a.yearMinor);
}

/**
 * The best first draft available, and where it came from, so the screen can say so rather than
 * presenting an extrapolation as though it were last year's actual figures.
 */
export function firstDraft(entries: JournalEntry[], currency: string, today: string): {
  lines: BudgetLine[];
  source: "last-year" | "this-year" | "nothing";
} {
  const last = fromLastYear(entries, currency, today);
  if (last.length > 0) return { lines: last, source: "last-year" };
  const current = fromThisYear(entries, currency, today);
  if (current.length > 0) return { lines: current, source: "this-year" };
  return { lines: [], source: "nothing" };
}
