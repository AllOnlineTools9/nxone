import { calculate } from "../documents/totals";
import type { Expense, SavedDocument } from "../store/types";

/**
 * What you ordered against what you were billed.
 *
 * A purchase order is a promise to pay for a particular thing at a particular price. The bill
 * that turns up later is somebody else's account of the same transaction, and the two disagree
 * more often than anybody expects — a price that crept up, a quantity nobody queried, a bill
 * sent twice because the first one went to the wrong address.
 *
 * Nobody checks, because checking means finding the order, and finding the order means
 * remembering it exists. So this does the finding.
 */

export type BillState =
  | "not-billed"
  | "part-billed"
  | "billed"
  | "over-billed";

export interface OrderMatch {
  orderId: string;
  number: string;
  supplier: string;
  issuedOn: string;
  orderedMinor: number;
  billedMinor: number;
  /** Positive means still to come, negative means billed for more than was ordered. */
  outstandingMinor: number;
  state: BillState;
  bills: Array<{ id: string; date: string; reference?: string; amountMinor: number }>;
  /** What to do about it, when there is something to do. */
  advice?: string;
}

/** Bills within a rupee of the order are agreed; two systems round differently. */
const TOLERANCE_MINOR = 100;

const orderTotal = (document: SavedDocument): number => {
  try {
    return calculate(document.doc).total.minor;
  } catch {
    return document.totalMinor;
  }
};

export function matchOrders(
  documents: SavedDocument[],
  expenses: Expense[],
  money: (minor: number) => string
): OrderMatch[] {
  const orders = documents.filter((d) => d.kind === "purchase-order" && !d.deletedAt && d.status !== "draft" && d.status !== "cancelled");

  return orders.map((order) => {
    const against = expenses.filter((e) => !e.deletedAt && e.orderId === order.id);
    const orderedMinor = orderTotal(order);
    const billedMinor = against.reduce((sum, e) => sum + e.netMinor + e.taxMinor, 0);
    const outstanding = orderedMinor - billedMinor;

    const state: BillState =
      billedMinor === 0 ? "not-billed"
        : outstanding < -TOLERANCE_MINOR ? "over-billed"
          : outstanding > TOLERANCE_MINOR ? "part-billed"
            : "billed";

    const advice =
      state === "over-billed"
        ? `Billed ${money(-outstanding)} more than the order was for. Check the bill against the order before paying it — a price that moved after the order was placed is the usual reason, and it is usually not agreed.`
        : state === "part-billed"
          ? `${money(outstanding)} of this order has not been billed yet. That is money you have committed to spend but have not been asked for.`
          : state === "not-billed"
            ? `Nothing billed against this order yet — ${money(orderedMinor)} committed.`
            : undefined;

    return {
      orderId: order.id,
      number: order.number,
      supplier: order.clientName,
      issuedOn: order.issueDate,
      orderedMinor,
      billedMinor,
      outstandingMinor: outstanding,
      state,
      bills: against
        .map((e) => ({ id: e.id, date: e.date, reference: e.reference, amountMinor: e.netMinor + e.taxMinor }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      advice
    };
  }).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
}

/** What has been ordered and not yet billed: money committed, which a cash forecast should know. */
export function committedMinor(matches: OrderMatch[]): number {
  return matches
    .filter((m) => m.state === "not-billed" || m.state === "part-billed")
    .reduce((sum, m) => sum + Math.max(0, m.outstandingMinor), 0);
}

/* --------------------------------------------------------------- paying twice */

export interface PossibleDuplicate {
  supplier: string;
  reference: string;
  bills: Array<{ id: string; date: string; amountMinor: number }>;
  totalMinor: number;
  says: string;
}

/**
 * The same bill entered twice.
 *
 * A supplier sends a bill, it gets entered; a reminder arrives a fortnight later and gets
 * entered again. Both get paid. This is one of the few mistakes in a small business that costs
 * real money and leaves no trace in the books — everything balances, the supplier is simply
 * better off.
 *
 * Matched on the supplier and the bill number rather than on the amount, because two bills for
 * the same amount in a month is ordinary and the same number twice is not.
 */
export function possibleDuplicates(expenses: Expense[], money: (minor: number) => string): PossibleDuplicate[] {
  const key = (e: Expense) => `${e.supplier.trim().toLowerCase()}|${(e.reference ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  const groups = new Map<string, Expense[]>();

  for (const expense of expenses) {
    if (expense.deletedAt || !expense.reference?.trim()) continue;
    const k = key(expense);
    groups.set(k, [...(groups.get(k) ?? []), expense]);
  }

  const out: PossibleDuplicate[] = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const total = sorted.reduce((sum, e) => sum + e.netMinor + e.taxMinor, 0);
    const same = sorted.every((e) => e.netMinor + e.taxMinor === sorted[0].netMinor + sorted[0].taxMinor);

    out.push({
      supplier: sorted[0].supplier,
      reference: sorted[0].reference!,
      bills: sorted.map((e) => ({ id: e.id, date: e.date, amountMinor: e.netMinor + e.taxMinor })),
      totalMinor: total,
      says: same
        ? `Bill ${sorted[0].reference} from ${sorted[0].supplier} is recorded ${sorted.length} times for the same amount. If it was only sent once, ${money(total - (sorted[0].netMinor + sorted[0].taxMinor))} is about to be paid for nothing.`
        : `Bill ${sorted[0].reference} from ${sorted[0].supplier} is recorded ${sorted.length} times for different amounts. One of them is probably a revised bill that should have replaced the first rather than joined it.`
    });
  }

  return out.sort((a, b) => b.totalMinor - a.totalMinor);
}

/* ----------------------------------------------------------------- suggesting */

/**
 * Orders a bill might belong to, best first.
 *
 * Offered rather than applied: the point of checking an order against a bill is lost if the
 * software quietly decides they match.
 */
export function ordersFor(
  supplier: string,
  documents: SavedDocument[],
  expenses: Expense[]
): Array<{ id: string; number: string; issuedOn: string; orderedMinor: number; outstandingMinor: number }> {
  const name = supplier.trim().toLowerCase();
  if (!name) return [];

  return matchOrders(documents, expenses, () => "")
    .filter((m) => m.supplier.trim().toLowerCase() === name && m.state !== "billed" && m.state !== "over-billed")
    .map((m) => ({ id: m.orderId, number: m.number, issuedOn: m.issuedOn, orderedMinor: m.orderedMinor, outstandingMinor: m.outstandingMinor }));
}
