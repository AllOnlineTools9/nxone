import type { Expense } from "../store/types";

/**
 * Money an employee spent that the business owes them back.
 *
 * It is a cost like any other, but it moves differently: the money left the employee's pocket,
 * not the business's, so until it is repaid the business owes them. Treating a claim as paid the
 * day it is approved understates what is owed and overstates the bank — and the person who is
 * out of pocket is the one who notices.
 */

export type ClaimState = "submitted" | "approved" | "paid" | "rejected";

export interface Claim {
  id: string;
  employeeId: string;
  employeeName: string;
  /** When the money was spent, which is the date the cost belongs to. */
  spentOn: string;
  description: string;
  /** Which account the cost goes to. */
  category: string;
  amountMinor: number;
  currency: string;
  state: ClaimState;
  submittedOn: string;
  decidedOn?: string;
  paidOn?: string;
  /** Why it was turned down, which the person is owed. */
  reason?: string;
  receiptId?: string;
}

export interface ClaimSummary {
  /** Waiting on somebody to decide. */
  waiting: Claim[];
  /** Approved and not yet repaid: what the business owes its people. */
  owedMinor: number;
  owedBy: Array<{ employeeId: string; employeeName: string; minor: number; oldestDays: number }>;
  paidThisYearMinor: number;
}

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000));

export function summariseClaims(claims: Claim[], today: string): ClaimSummary {
  const live = claims.filter((c) => c.state !== "rejected");
  const approved = live.filter((c) => c.state === "approved");

  const byPerson = new Map<string, { employeeId: string; employeeName: string; minor: number; oldest: string }>();
  for (const claim of approved) {
    const entry = byPerson.get(claim.employeeId) ?? {
      employeeId: claim.employeeId, employeeName: claim.employeeName, minor: 0, oldest: claim.spentOn
    };
    entry.minor += claim.amountMinor;
    if (claim.spentOn < entry.oldest) entry.oldest = claim.spentOn;
    byPerson.set(claim.employeeId, entry);
  }

  return {
    waiting: live.filter((c) => c.state === "submitted").sort((a, b) => a.submittedOn.localeCompare(b.submittedOn)),
    owedMinor: approved.reduce((sum, c) => sum + c.amountMinor, 0),
    owedBy: [...byPerson.values()]
      .map((e) => ({ employeeId: e.employeeId, employeeName: e.employeeName, minor: e.minor, oldestDays: daysBetween(e.oldest, today) }))
      .sort((a, b) => b.oldestDays - a.oldestDays),
    paidThisYearMinor: live.filter((c) => c.state === "paid").reduce((sum, c) => sum + c.amountMinor, 0)
  };
}

/**
 * A claim as a cost in the books.
 *
 * Dated the day the money was spent, not the day it was approved: the cost belongs to the month
 * it was incurred in, and approving a September lunch in November does not move it into
 * November. Until it is repaid it sits as owed to the employee rather than paid out of the bank.
 */
export function asExpense(claim: Claim): Omit<Expense, "id" | "createdAt" | "updatedAt"> & { id?: string } {
  return {
    date: claim.spentOn,
    supplier: claim.employeeName,
    description: claim.description,
    category: claim.category,
    currency: claim.currency,
    netMinor: claim.amountMinor,
    taxMinor: 0,
    // Unpaid claims sit against what the business owes, not against a bank account it has not
    // yet paid out of. Once repaid, the money really does come from somewhere.
    paidFrom: claim.state === "paid" ? "1020" : undefined,
    reference: `Claim ${claim.id}`,
    version: 1
  } as Omit<Expense, "id" | "createdAt" | "updatedAt"> & { id?: string };
}

/** Whether a state change is one that makes sense, so a claim cannot go backwards. */
export function canMove(from: ClaimState, to: ClaimState): { allowed: boolean; why?: string } {
  const allowed: Record<ClaimState, ClaimState[]> = {
    submitted: ["approved", "rejected"],
    approved: ["paid", "rejected"],
    paid: [],
    rejected: ["submitted"]
  };

  if (allowed[from].includes(to)) return { allowed: true };
  if (from === "paid") return { allowed: false, why: "This has already been repaid. Record a correction rather than changing what happened." };
  if (from === to) return { allowed: false, why: "It is already in that state." };
  return { allowed: false, why: `A claim cannot go straight from ${from} to ${to}.` };
}

/** What to say about a claim, so nobody has to work out what happens next. */
export function nextStep(claim: Claim, today: string): string {
  switch (claim.state) {
    case "submitted":
      return `Waiting on a decision since ${claim.submittedOn}.`;
    case "approved": {
      const days = daysBetween(claim.spentOn, today);
      return days > 30
        ? `Approved and not yet repaid. ${claim.employeeName} has been out of pocket for ${days} days.`
        : "Approved and waiting to be repaid.";
    }
    case "paid":
      return `Repaid${claim.paidOn ? ` on ${claim.paidOn}` : ""}.`;
    default:
      return claim.reason ? `Turned down: ${claim.reason}` : "Turned down.";
  }
}
