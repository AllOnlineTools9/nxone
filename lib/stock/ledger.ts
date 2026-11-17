import { calculate } from "../documents/totals";
import type { CatalogueItem, Expense, SavedDocument } from "../store/types";

/**
 * What is on the shelf, what it cost, and what went out of the door.
 *
 * A shop that buys to sell cannot read its profit from its bank account. Stock bought in March
 * and sold in May is not March's cost - it is an asset until it is sold, and the month it sells
 * is the month it becomes a cost. Without that, every monthly profit figure is wrong in both
 * directions and the error only cancels out over a long enough period to be useless.
 *
 * Cost is weighted average: every receipt re-averages what the shelf is worth, and every sale
 * leaves at that average. It is one of the two methods the accounting standards allow, and it is
 * the one a shopkeeper can check by hand, which matters more here than the marginal accuracy of
 * the other.
 */

/** Stock-keeping fields a catalogue item may carry. */
export interface Tracked {
  tracked?: boolean;
  /** How much was on the shelf when the books began, and what it had cost. */
  openingQty?: number;
  openingCostMinor?: number;
  /** Tell me when it falls to this. */
  reorderLevel?: number;
}

export type StockItem = CatalogueItem & Tracked;

export type MoveKind = "opening" | "received" | "sold" | "adjustment" | "written-off";

export interface StockMove {
  itemId: string;
  kind: MoveKind;
  date: string;
  /** Positive for anything arriving, negative for anything leaving. */
  quantity: number;
  /** What it cost, for things arriving. Things leaving are valued at the running average. */
  valueMinor?: number;
  reference?: string;
  note?: string;
}

export interface ItemLevel {
  itemId: string;
  description: string;
  unit?: string;
  quantity: number;
  valueMinor: number;
  /** What one of them is worth on the shelf right now. */
  averageCostMinor: number;
  soldQuantity: number;
  costOfSalesMinor: number;
  reorderLevel?: number;
  /** True when more has been sold than was ever received, which means a purchase is missing. */
  negative: boolean;
}

export interface StockPosition {
  levels: ItemLevel[];
  /** Everything on the shelf, at cost. This is an asset, not an expense. */
  closingValueMinor: number;
  /** What the things sold in the period had cost. This is the expense. */
  costOfSalesMinor: number;
  lowStock: ItemLevel[];
  /** Items sold without enough stock to sell: a purchase has not been recorded. */
  shortages: ItemLevel[];
}

const round = (n: number) => Math.round(n);

/**
 * Sales pulled out of the invoices themselves, rather than recorded twice.
 *
 * The invoices already say what was sold. Asking somebody to enter it again in a stock screen is
 * asking them to disagree with themselves, so the moves are derived - matched by code first,
 * because that is unambiguous, and by description only when there is no code.
 */
export function salesMoves(documents: SavedDocument[], items: StockItem[]): StockMove[] {
  const tracked = items.filter((i) => i.tracked && !i.deletedAt);
  if (!tracked.length) return [];

  const byCode = new Map(tracked.filter((i) => i.code).map((i) => [i.code!.toLowerCase(), i]));
  const byName = new Map(tracked.map((i) => [i.description.trim().toLowerCase(), i]));

  const moves: StockMove[] = [];
  for (const d of documents) {
    if (d.deletedAt || d.kind !== "invoice") continue;
    if (d.status === "draft" || d.status === "cancelled") continue;

    for (const line of d.doc.items) {
      const item = (line.code ? byCode.get(line.code.toLowerCase()) : undefined)
        ?? byName.get(line.description.trim().toLowerCase());
      if (!item || !line.quantity) continue;
      moves.push({ itemId: item.id, kind: "sold", date: d.issueDate, quantity: -Math.abs(line.quantity), reference: d.number });
    }
  }
  return moves;
}

/**
 * Stock bought, pulled out of the bills. A bill recorded against the stock account is a purchase
 * of stock rather than a cost of the month, which is the whole distinction this module exists to
 * make.
 */
export const STOCK_ACCOUNT = "1300";

export function purchaseMoves(expenses: Expense[], items: StockItem[]): StockMove[] {
  const tracked = items.filter((i) => i.tracked && !i.deletedAt);
  const byName = new Map(tracked.map((i) => [i.description.trim().toLowerCase(), i]));

  const moves: StockMove[] = [];
  for (const e of expenses) {
    if (e.deletedAt || e.category !== STOCK_ACCOUNT) continue;
    // The item is named in the description; anything unmatched is stock in general and is
    // counted in the value but not against one item.
    const item = byName.get((e.description ?? "").trim().toLowerCase());
    if (!item) continue;
    moves.push({
      itemId: item.id, kind: "received", date: e.date,
      quantity: e.stockQuantity ?? 0, valueMinor: e.netMinor, reference: e.reference
    });
  }
  return moves;
}

/**
 * Where everything stands, having replayed every movement in date order.
 *
 * Replaying rather than storing a balance means a movement entered late, or corrected, is simply
 * right next time this runs - the same reason the ledger is derived from documents rather than
 * kept as a running total.
 */
export function stockPosition(opts: {
  items: StockItem[];
  moves: StockMove[];
  /** Costs are counted from here, for the period's cost of sales. */
  from?: string;
  to?: string;
}): StockPosition {
  const { items, moves } = opts;
  const to = opts.to ?? "9999-12-31";
  const from = opts.from ?? "0000-01-01";

  const tracked = items.filter((i) => i.tracked && !i.deletedAt);
  const levels: ItemLevel[] = [];

  for (const item of tracked) {
    let quantity = item.openingQty ?? 0;
    let valueMinor = item.openingCostMinor ?? 0;
    let soldQuantity = 0;
    let costOfSalesMinor = 0;
    let negative = false;

    const own = moves
      .filter((m) => m.itemId === item.id && m.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const move of own) {
      const average = quantity > 0 ? valueMinor / quantity : 0;

      if (move.quantity >= 0) {
        quantity += move.quantity;
        valueMinor += move.valueMinor ?? round(average * move.quantity);
        continue;
      }

      const leaving = Math.min(Math.abs(move.quantity), Math.max(0, quantity));
      const cost = round(average * leaving);
      if (Math.abs(move.quantity) > quantity) negative = true;

      quantity += move.quantity;
      valueMinor = Math.max(0, valueMinor - cost);

      if (move.kind === "sold" && move.date >= from) {
        soldQuantity += Math.abs(move.quantity);
        costOfSalesMinor += cost;
      }
    }

    levels.push({
      itemId: item.id,
      description: item.description,
      unit: item.unit,
      quantity: round(quantity * 1000) / 1000,
      valueMinor: round(valueMinor),
      averageCostMinor: quantity > 0 ? round(valueMinor / quantity) : 0,
      soldQuantity,
      costOfSalesMinor,
      reorderLevel: item.reorderLevel,
      negative
    });
  }

  levels.sort((a, b) => a.description.localeCompare(b.description));

  return {
    levels,
    closingValueMinor: levels.reduce((a, l) => a + Math.max(0, l.valueMinor), 0),
    costOfSalesMinor: levels.reduce((a, l) => a + l.costOfSalesMinor, 0),
    lowStock: levels.filter((l) => l.reorderLevel !== undefined && l.quantity <= l.reorderLevel),
    shortages: levels.filter((l) => l.negative || l.quantity < 0)
  };
}

/** The whole picture from what is already saved, with no separate stock-keeping to do. */
export function stockFrom(opts: {
  items: StockItem[];
  documents: SavedDocument[];
  expenses: Expense[];
  extraMoves?: StockMove[];
  from?: string;
  to?: string;
}): StockPosition {
  return stockPosition({
    items: opts.items,
    moves: [
      ...purchaseMoves(opts.expenses, opts.items),
      ...salesMoves(opts.documents, opts.items),
      ...(opts.extraMoves ?? [])
    ],
    from: opts.from,
    to: opts.to
  });
}

/**
 * What the sales in a period cost, as a figure the profit and loss can use. Kept separate from
 * the position so a caller can ask for the cost without caring about shelves.
 */
export function costOfSales(opts: Parameters<typeof stockFrom>[0]): number {
  return stockFrom(opts).costOfSalesMinor;
}

/** Whether any stock-keeping is switched on at all, so screens can stay out of the way. */
export const keepingStock = (items: StockItem[]) => items.some((i) => i.tracked && !i.deletedAt);

/** Avoid pricing below what it cost, which is the one thing a stock figure is most useful for. */
export function marginOn(item: ItemLevel, sellingPriceMinor: number): { marginMinor: number; marginPercent: number | null } {
  const marginMinor = sellingPriceMinor - item.averageCostMinor;
  return {
    marginMinor,
    marginPercent: sellingPriceMinor > 0 ? Math.round((marginMinor / sellingPriceMinor) * 1000) / 10 : null
  };
}
