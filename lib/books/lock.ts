/**
 * Closing the books on a period.
 *
 * The day a return is filed, that period stops being a draft. If an invoice inside it can still
 * be edited, the books and the return drift apart silently, and the first anyone hears of it is
 * a notice asking why the figures do not agree. Every accounting package has a lock date for
 * this reason; this is ours.
 *
 * One date, not a list of periods: everything on or before it is closed. That is how an
 * accountant thinks about it ("books are closed to 30 September") and it cannot get into the
 * tangled state a list of locked ranges can.
 */

export interface Locked {
  /** Everything dated on or before this is closed. Absent means nothing is. */
  lockedUpTo?: string;
}

export const isLocked = (date: string, lockedUpTo?: string): boolean =>
  Boolean(lockedUpTo && date <= lockedUpTo);

/** Thrown by the store when a write would change a closed period. */
export class PeriodClosed extends Error {
  constructor(public readonly date: string, public readonly lockedUpTo: string, message: string) {
    super(message);
    this.name = "PeriodClosed";
  }
}

/**
 * Why this change is refused, in words that say what to do instead. A refusal that only says
 * "locked" leaves somebody stuck; the way out of a closed period is a document in an open one,
 * which is also the correct accounting answer.
 */
export function refusal(what: "document" | "expense", date: string, lockedUpTo: string, formatted?: (iso: string) => string): string {
  const show = formatted ?? ((iso: string) => iso);
  const thing = what === "document" ? "This document" : "This expense";
  const fix = what === "document"
    ? "To correct it, raise a credit note dated today and a fresh invoice."
    : "To correct it, record the adjustment with today's date instead.";
  return `${thing} is dated ${show(date)}, and the books are closed to ${show(lockedUpTo)}. ${fix} If you really must change it, move the lock date back in Settings first — but anything already filed will then no longer match your books.`;
}

/**
 * Whether moving the lock to this date is safe, and what it would close.
 *
 * Moving it forward is routine. Moving it back is how a filed period gets edited by accident,
 * so it is allowed but never silently: the caller is told what it is reopening.
 */
export function describeMove(from: string | undefined, to: string, formatted?: (iso: string) => string): {
  direction: "forward" | "back" | "same";
  warning?: string;
} {
  const show = formatted ?? ((iso: string) => iso);
  if (!from) return { direction: "forward" };
  if (to === from) return { direction: "same" };
  if (to > from) return { direction: "forward" };
  return {
    direction: "back",
    warning: `This reopens everything between ${show(to)} and ${show(from)}. Anything you have already filed for those dates will no longer have to match your books. Only do this if you know a return has to be revised.`
  };
}

/**
 * The lock date a filed return suggests: the end of the period it covered. Offered rather than
 * applied, because only the person filing knows whether it went through.
 */
export function suggestedLock(periodTo: string, current?: string): string | undefined {
  if (current && current >= periodTo) return undefined;
  return periodTo;
}

/** The last day of the month before the one holding this date: the usual thing to close. */
export function endOfPreviousMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, 0));
  return end.toISOString().slice(0, 10);
}

/** What a lock would close, so the person sees the size of it before agreeing. */
export function wouldClose<T extends { date?: string; issueDate?: string }>(
  records: T[],
  to: string,
  from?: string
): number {
  return records.filter((r) => {
    const date = r.issueDate ?? r.date ?? "";
    return date !== "" && date <= to && (!from || date > from);
  }).length;
}
