import type { ManualEntry } from "../entries/types";
import { owedOn } from "../documents/owed";
import { calendarFor, type Deadline } from "../compliance/calendar";
import type { Registration } from "../compliance/rules";
import type { Expense, Profile, SavedDocument } from "../store/types";

/**
 * One client's books, as an accountant's list needs them: what they are owed, what is due to
 * be filed, and whether anything has happened lately.
 *
 * A return counts as done once the business has closed its books past the end of that period,
 * which NXOne asks for when a return is filed. A business that files and does not close the
 * period shows the return as still due, which is the safer mistake.
 */

export interface ClientBooks {
  profile?: Profile;
  documents: SavedDocument[];
  expenses: Expense[];
  entries: ManualEntry[];
}

export interface ClientSummary {
  currency: string;
  receivableMinor: number;
  overdueInvoices: number;
  /** Invoices in another currency, not in the total above. */
  foreignInvoices: number;
  salesThisMonthMinor: number;
  invoicesThisMonth: number;
  lastInvoiceDate?: string;
  deadlines: Array<Deadline & { done: boolean }>;
  /** The first return not yet done, overdue or not. */
  next?: Deadline & { done: boolean };
  overdueReturns: number;
}

/** Sorts a client's records, as the server sends them, into books. */
export function booksFrom(records: Array<{ kind: string; body: unknown }>): ClientBooks {
  const books: ClientBooks = { documents: [], expenses: [], entries: [] };
  for (const r of records) {
    if (r.kind === "profile") books.profile = r.body as Profile;
    else if (r.kind === "document") books.documents.push(r.body as SavedDocument);
    else if (r.kind === "expense") books.expenses.push(r.body as Expense);
    else if (r.kind === "entry") books.entries.push(r.body as ManualEntry);
  }
  books.documents = books.documents.filter((d) => !d.deletedAt);
  books.expenses = books.expenses.filter((e) => !e.deletedAt);
  books.entries = books.entries.filter((e) => !e.deletedAt);
  return books;
}

export function summarise(books: ClientBooks, today: string): ClientSummary {
  const profile = books.profile;
  const currency = (profile?.currency ?? "INR").toUpperCase();
  const month = today.slice(0, 7);

  let receivableMinor = 0, overdueInvoices = 0, foreignInvoices = 0, salesThisMonthMinor = 0, invoicesThisMonth = 0;
  let lastInvoiceDate: string | undefined;
  for (const d of books.documents) {
    if (d.kind !== "invoice" || d.status === "draft" || d.status === "cancelled") continue;
    if (!lastInvoiceDate || d.issueDate > lastInvoiceDate) lastInvoiceDate = d.issueDate;
    const same = d.currency.toUpperCase() === currency;
    if (d.issueDate.startsWith(month)) {
      invoicesThisMonth++;
      if (same) salesThisMonthMinor += d.totalMinor;
    }
    const owed = owedOn(d);
    if (owed <= 0 || d.status === "paid") continue;
    if (!same) { foreignInvoices++; continue; }
    receivableMinor += owed;
    const due = d.dueDate ?? d.issueDate;
    if (due < today) overdueInvoices++;
  }

  const registrations = (profile?.registrations ?? []) as Registration[];
  const locked = profile?.lockedUpTo ?? "";
  const deadlines = calendarFor({
    country: profile?.country ?? "IN", registrations, today, quarterlyGst: profile?.quarterlyGst, backDays: 90, aheadDays: 45
  }).map((d) => ({ ...d, done: Boolean(locked) && locked >= d.periodEnd }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const open = deadlines.filter((d) => !d.done);
  return {
    currency, receivableMinor, overdueInvoices, foreignInvoices, salesThisMonthMinor, invoicesThisMonth, lastInvoiceDate,
    deadlines, next: open[0], overdueReturns: open.filter((d) => d.daysAway < 0).length
  };
}
