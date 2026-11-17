import { balances, type JournalEntry } from "../ledger/journal";
import { balanceSheet, profitAndLoss } from "../ledger/statements";
import { fromMinor, type Money } from "../money";
import { financialYearOf } from "../tds/sections";
import type { Expense, SavedDocument } from "../store/types";

/**
 * Closing a financial year.
 *
 * Nothing in these books is a stored balance - every figure is derived from the documents and
 * bills behind it - so closing a year is not an act of arithmetic. It is an act of agreement:
 * somebody looks at the year, satisfies themselves it is complete, and says so. After that the
 * period is locked, and corrections become credit notes rather than edits.
 *
 * So the useful part is not the closing entry. It is the list of things that are usually wrong
 * when somebody thinks a year is finished: invoices still in draft, bills with no account,
 * payments sitting unmatched, equipment nobody depreciated. Those are what make a closed year
 * reopen.
 */

export interface YearEnd {
  label: string;
  from: string;
  to: string;
  /** What the year made, on its own. */
  profit: Money;
  /** Profit kept from every year before this one. */
  broughtForward: Money;
  /** The two added together: what the balance sheet will show as retained earnings. */
  carriedForward: Money;
  totalAssets: Money;
  totalLiabilities: Money;
  balanced: boolean;
  /** Every account with a balance at the year end, which is what next year opens on. */
  opening: Array<{ code: string; name: string; type: string; minor: number }>;
}

export function yearEnd(entries: JournalEntry[], currency: string, anyDateInYear: string): YearEnd {
  const fy = financialYearOf(anyDateInYear);
  const pl = profitAndLoss(entries, currency, fy.from, fy.to);
  const sheet = balanceSheet(entries, currency, fy.to, fy.from);

  // Only what carries into next year: income and expense accounts start the new year at nothing,
  // which is the whole point of a year end.
  const opening = balances(entries, currency, undefined, fy.to)
    .filter((row) => row.type === "asset" || row.type === "liability" || row.type === "equity")
    .filter((row) => row.balance.minor !== 0)
    .map((row) => ({ code: row.code, name: row.name, type: row.type, minor: row.balance.minor }));

  return {
    label: fy.label,
    from: fy.from,
    to: fy.to,
    profit: pl.netProfit,
    broughtForward: sheet.retainedEarlier ?? fromMinor(0, currency),
    carriedForward: sheet.retained,
    totalAssets: sheet.totalAssets,
    totalLiabilities: sheet.totalLiabilities,
    balanced: sheet.balanced,
    opening
  };
}

/* ------------------------------------------------------- before you close it */

export type CheckSeverity = "stop" | "look";

export interface YearEndCheck {
  id: string;
  severity: CheckSeverity;
  title: string;
  /** What is wrong and what it costs if it is left. */
  says: string;
  count: number;
  /** Where to go and fix it. */
  fixAt?: string;
}

export interface ReadyToClose {
  checks: YearEndCheck[];
  /** True when nothing in the way. A "look" on its own does not stop anybody. */
  clear: boolean;
}

export function readyToClose(input: {
  documents: SavedDocument[];
  expenses: Expense[];
  entries: JournalEntry[];
  currency: string;
  anyDateInYear: string;
  /** Things the business owns, to notice equipment nobody has depreciated. */
  assets?: Array<{ purchasedOn: string; disposedOn?: string }>;
  /** Whether a lock already covers this year. */
  lockedUpTo?: string;
}): ReadyToClose {
  const fy = financialYearOf(input.anyDateInYear);
  const inYear = <T extends { issueDate?: string; date?: string }>(list: T[]) =>
    list.filter((row) => {
      const on = row.issueDate ?? row.date ?? "";
      return on >= fy.from && on <= fy.to;
    });

  const checks: YearEndCheck[] = [];

  const drafts = inYear(input.documents).filter((d) => d.status === "draft");
  if (drafts.length > 0) {
    checks.push({
      id: "drafts", severity: "stop", count: drafts.length,
      title: drafts.length === 1 ? "An invoice is still a draft" : `${drafts.length} invoices are still drafts`,
      says: "A draft is not in your books at all. If it was really sent, the year is understated by that much; if it was not, it should be deleted rather than left to be found next year.",
      fixAt: "/documents"
    });
  }

  const unpaid = inYear(input.documents).filter(
    (d) => d.kind === "invoice" && d.status !== "cancelled" && d.status !== "draft" && d.paidMinor < d.totalMinor
  );
  if (unpaid.length > 0) {
    checks.push({
      id: "unpaid", severity: "look", count: unpaid.length,
      title: `${unpaid.length} ${unpaid.length === 1 ? "invoice is" : "invoices are"} still owed`,
      says: "Not a problem in itself - they carry forward as money owed to you. But a year end is the moment to decide whether any of them are never going to be paid, because writing one off belongs in the year it went bad.",
      fixAt: "/receivables"
    });
  }

  const unaccounted = inYear(input.expenses).filter((e) => !e.category || e.category === "6900");
  if (unaccounted.length > 0) {
    checks.push({
      id: "uncategorised", severity: "look", count: unaccounted.length,
      title: `${unaccounted.length} ${unaccounted.length === 1 ? "bill sits" : "bills sit"} in general expenses`,
      says: "They are in the books and the profit is right, but nobody can see what the money went on. Worth a few minutes now rather than when an accountant asks in September.",
      fixAt: "/expenses"
    });
  }

  const owned = (input.assets ?? []).filter((a) => a.purchasedOn <= fy.to && (!a.disposedOn || a.disposedOn > fy.to));
  if (owned.length === 0) {
    const largeBills = inYear(input.expenses).filter((e) => e.netMinor >= 1_000_000);
    if (largeBills.length > 0) {
      checks.push({
        id: "assets", severity: "look", count: largeBills.length,
        title: `${largeBills.length} large ${largeBills.length === 1 ? "bill" : "bills"} and nothing on the register`,
        says: "Anything you will still be using in two years belongs on the asset register, spread over those years. Charged in full to this year, the year looks worse than it was and the next three look better.",
        fixAt: "/assets"
      });
    }
  }

  const sheet = balanceSheet(input.entries, input.currency, fy.to, fy.from);
  if (!sheet.balanced) {
    checks.push({
      id: "balance", severity: "stop", count: 1,
      title: "The balance sheet does not balance",
      says: "Something is missing from the books. Closing a year that does not balance carries the problem forward, where it is far harder to find.",
      fixAt: "/books"
    });
  }

  if (input.lockedUpTo && input.lockedUpTo >= fy.to) {
    checks.push({
      id: "already-locked", severity: "look", count: 1,
      title: "This year is already closed",
      says: "The books are locked to this date or later, so nothing in the year can change. Closing again changes nothing.",
      fixAt: "/settings"
    });
  }

  return { checks, clear: !checks.some((c) => c.severity === "stop") };
}

/** The years there is anything to close, newest first. */
export function yearsWithActivity(documents: SavedDocument[], expenses: Expense[]): string[] {
  const years = new Set<string>();
  for (const d of documents) if (d.issueDate) years.add(financialYearOf(d.issueDate).label);
  for (const e of expenses) if (e.date) years.add(financialYearOf(e.date).label);
  return [...years].sort().reverse();
}

/** The first day of a financial year written as 2026-27. */
export const yearStarting = (label: string): string => `${label.slice(0, 4)}-04-01`;
