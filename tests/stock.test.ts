import { describe, expect, it } from "vitest";
import { costOfSales, keepingStock, marginOn, purchaseMoves, salesMoves, stockFrom, stockPosition, type StockItem, type StockMove } from "@/lib/stock/ledger";
import { ledgerFor } from "@/lib/ledger/posting";
import { profitAndLoss } from "@/lib/ledger/statements";
import { balances } from "@/lib/ledger/journal";
import type { DocumentData } from "@/lib/documents/types";
import type { Expense, SavedDocument } from "@/lib/store/types";

const item = (over: Partial<StockItem> = {}): StockItem => ({
  id: over.id ?? "it1", description: over.description ?? "Blue widget", rate: 500,
  tracked: true, createdAt: "", updatedAt: "", ...over
});

const docData = (over: Partial<DocumentData> = {}): DocumentData => ({
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-10", number: "INV-001",
  seller: { name: "Shop", region: "KA" }, buyer: { name: "A customer", region: "KA" }, placeOfSupply: "KA",
  items: [{ id: "l1", description: "Blue widget", quantity: 2, rate: 500, taxRuleId: "none" }],
  taxInclusive: false, ...over
} as DocumentData);

const saved = (over: Partial<SavedDocument> & { doc?: DocumentData } = {}): SavedDocument => {
  const doc = over.doc ?? docData();
  return {
    id: over.id ?? Math.random().toString(36).slice(2), kind: doc.kind as SavedDocument["kind"],
    number: doc.number, clientName: doc.buyer.name, issueDate: doc.issueDate, dueDate: doc.issueDate,
    currency: "INR", totalMinor: 100000, paidMinor: 0, status: "sent", doc, createdAt: "", updatedAt: "", ...over
  };
};

const bill = (over: Partial<Expense> = {}): Expense => ({
  id: over.id ?? Math.random().toString(36).slice(2), date: "2026-09-01", supplier: "Wholesaler",
  description: "Blue widget", category: "1300", currency: "INR", netMinor: 300000, taxMinor: 0,
  stockQuantity: 10, paidFrom: "1020", createdAt: "", updatedAt: "", ...over
});

/* ------------------------------------------------------- reading the moves */

describe("working out what moved", () => {
  it("takes sales from the invoices rather than asking for them twice", () => {
    const moves = salesMoves([saved()], [item()]);
    expect(moves).toEqual([{ itemId: "it1", kind: "sold", date: "2026-09-10", quantity: -2, reference: "INV-001" }]);
  });

  it("matches on the code when there is one, because a description can be anything", () => {
    const widget = item({ id: "it1", description: "Widget", code: "8471" });
    const doc = saved({ doc: docData({ items: [{ id: "l", description: "Typed differently", quantity: 3, rate: 500, code: "8471", taxRuleId: "none" }] }) });
    expect(salesMoves([doc], [widget])[0]).toMatchObject({ itemId: "it1", quantity: -3 });
  });

  it("ignores drafts and cancelled invoices, which sold nothing", () => {
    expect(salesMoves([saved({ status: "draft" })], [item()])).toHaveLength(0);
    expect(salesMoves([saved({ status: "cancelled" })], [item()])).toHaveLength(0);
  });

  it("ignores an item nobody is tracking", () => {
    expect(salesMoves([saved()], [item({ tracked: false })])).toHaveLength(0);
  });

  it("takes purchases from bills charged to the stock account", () => {
    expect(purchaseMoves([bill()], [item()])[0]).toMatchObject({ itemId: "it1", kind: "received", quantity: 10, valueMinor: 300000 });
  });

  it("leaves an ordinary expense alone", () => {
    expect(purchaseMoves([bill({ category: "6010" })], [item()])).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- the shelf */

describe("what is on the shelf", () => {
  it("averages the cost over everything received", () => {
    // 10 at ₹300 each, then 10 at ₹400 each, is 20 at ₹350
    const moves: StockMove[] = [
      { itemId: "it1", kind: "received", date: "2026-09-01", quantity: 10, valueMinor: 300000 },
      { itemId: "it1", kind: "received", date: "2026-09-15", quantity: 10, valueMinor: 400000 }
    ];
    const level = stockPosition({ items: [item()], moves }).levels[0];
    expect(level.quantity).toBe(20);
    expect(level.valueMinor).toBe(700000);
    expect(level.averageCostMinor).toBe(35000);
  });

  it("lets stock leave at the average, not at what the last lot cost", () => {
    const moves: StockMove[] = [
      { itemId: "it1", kind: "received", date: "2026-09-01", quantity: 10, valueMinor: 300000 },
      { itemId: "it1", kind: "received", date: "2026-09-15", quantity: 10, valueMinor: 400000 },
      { itemId: "it1", kind: "sold", date: "2026-09-20", quantity: -4 }
    ];
    const level = stockPosition({ items: [item()], moves }).levels[0];
    expect(level.costOfSalesMinor).toBe(140000);
    expect(level.quantity).toBe(16);
    expect(level.valueMinor).toBe(560000);
    expect(level.averageCostMinor).toBe(35000);
  });

  it("replays in date order however the moves arrive", () => {
    const inOrder: StockMove[] = [
      { itemId: "it1", kind: "received", date: "2026-09-01", quantity: 10, valueMinor: 300000 },
      { itemId: "it1", kind: "sold", date: "2026-09-20", quantity: -4 }
    ];
    const jumbled = [inOrder[1], inOrder[0]];
    expect(stockPosition({ items: [item()], moves: jumbled }).levels[0])
      .toEqual(stockPosition({ items: [item()], moves: inOrder }).levels[0]);
  });

  it("starts from what was on the shelf when the books began", () => {
    const opening = item({ openingQty: 5, openingCostMinor: 150000 });
    const level = stockPosition({ items: [opening], moves: [] }).levels[0];
    expect(level.quantity).toBe(5);
    expect(level.averageCostMinor).toBe(30000);
  });

  it("stops at the date asked for", () => {
    const moves: StockMove[] = [
      { itemId: "it1", kind: "received", date: "2026-09-01", quantity: 10, valueMinor: 300000 },
      { itemId: "it1", kind: "received", date: "2026-11-01", quantity: 10, valueMinor: 400000 }
    ];
    expect(stockPosition({ items: [item()], moves, to: "2026-09-30" }).levels[0].quantity).toBe(10);
  });

  it("counts only the period asked for as the period's cost", () => {
    const moves: StockMove[] = [
      { itemId: "it1", kind: "received", date: "2026-09-01", quantity: 10, valueMinor: 300000 },
      { itemId: "it1", kind: "sold", date: "2026-09-10", quantity: -2 },
      { itemId: "it1", kind: "sold", date: "2026-10-10", quantity: -3 }
    ];
    const october = stockPosition({ items: [item()], moves, from: "2026-10-01", to: "2026-10-31" });
    expect(october.costOfSalesMinor).toBe(90000);
    expect(october.levels[0].quantity).toBe(5);
  });
});

describe("when the numbers say something is wrong", () => {
  it("flags selling more than was ever bought, because a purchase is missing", () => {
    const moves: StockMove[] = [
      { itemId: "it1", kind: "received", date: "2026-09-01", quantity: 2, valueMinor: 60000 },
      { itemId: "it1", kind: "sold", date: "2026-09-10", quantity: -5 }
    ];
    const position = stockPosition({ items: [item()], moves });
    expect(position.shortages).toHaveLength(1);
    expect(position.levels[0].negative).toBe(true);
  });

  it("never values a negative shelf as negative money", () => {
    const moves: StockMove[] = [{ itemId: "it1", kind: "sold", date: "2026-09-10", quantity: -5 }];
    expect(stockPosition({ items: [item()], moves }).closingValueMinor).toBe(0);
  });

  it("says what has fallen to its reorder level", () => {
    const moves: StockMove[] = [
      { itemId: "it1", kind: "received", date: "2026-09-01", quantity: 10, valueMinor: 300000 },
      { itemId: "it1", kind: "sold", date: "2026-09-10", quantity: -8 }
    ];
    const position = stockPosition({ items: [item({ reorderLevel: 3 })], moves });
    expect(position.lowStock.map((l) => l.itemId)).toEqual(["it1"]);
  });

  it("leaves something well stocked out of the warning", () => {
    const moves: StockMove[] = [{ itemId: "it1", kind: "received", date: "2026-09-01", quantity: 10, valueMinor: 300000 }];
    expect(stockPosition({ items: [item({ reorderLevel: 3 })], moves }).lowStock).toHaveLength(0);
  });

  it("writes stock off at what it was worth", () => {
    const moves: StockMove[] = [
      { itemId: "it1", kind: "received", date: "2026-09-01", quantity: 10, valueMinor: 300000 },
      { itemId: "it1", kind: "written-off", date: "2026-09-20", quantity: -2, note: "Damaged" }
    ];
    const level = stockPosition({ items: [item()], moves }).levels[0];
    expect(level.quantity).toBe(8);
    expect(level.valueMinor).toBe(240000);
    // written off is not sold, so it is not the cost of a sale
    expect(level.costOfSalesMinor).toBe(0);
  });
});

/* ---------------------------------------------------------- the accounts */

describe("stock in the accounts", () => {
  const items = [item()];
  const documents = [saved()];
  const expenses = [bill()];

  it("works the whole thing out from what is already saved", () => {
    const position = stockFrom({ items, documents, expenses });
    expect(position.levels[0].quantity).toBe(8);
    expect(position.costOfSalesMinor).toBe(60000);
    expect(position.closingValueMinor).toBe(240000);
  });

  it("moves the cost of what sold off the shelf and into cost of sales", () => {
    const entries = ledgerFor(documents, expenses, "INR", undefined, { items });
    const cogs = entries.find((e) => e.source.kind === "stock");
    expect(cogs).toBeTruthy();
    expect(cogs?.lines.find((l) => l.account === "5000")?.debit).toBe(60000);
    expect(cogs?.lines.find((l) => l.account === "1300")?.credit).toBe(60000);
  });

  it("dates that entry to the end of the month it sold in", () => {
    expect(ledgerFor(documents, expenses, "INR", undefined, { items }).find((e) => e.source.kind === "stock")?.date).toBe("2026-09-30");
  });

  it("leaves what is unsold on the shelf as an asset, not a cost", () => {
    const entries = ledgerFor(documents, expenses, "INR", undefined, { items });
    const stock = balances(entries, "INR", "2026-01-01", "2026-12-31").find((r) => r.code === "1300");
    // ₹3,000 bought, ₹600 sold, ₹2,400 still on the shelf
    expect(stock?.balance.minor).toBe(240000);
  });

  it("charges only what sold to the profit and loss", () => {
    const pl = profitAndLoss(ledgerFor(documents, expenses, "INR", undefined, { items }), "INR", "2026-01-01", "2026-12-31");
    expect(pl.expenses.find((r) => r.code === "5000")?.balance.minor).toBe(60000);
    // the ₹3,000 purchase is not an expense of the year
    expect(pl.totalExpenses.minor).toBe(60000);
  });

  it("behaves exactly as it always did when nobody is keeping stock", () => {
    const untracked = [item({ tracked: false })];
    const withStock = ledgerFor(documents, expenses, "INR", undefined, { items: untracked });
    const without = ledgerFor(documents, expenses, "INR");
    expect(withStock).toHaveLength(without.length);
    expect(withStock.some((e) => e.source.kind === "stock")).toBe(false);
  });

  it("makes one entry a month rather than one per sale", () => {
    const many = [
      saved({ id: "a", doc: docData({ number: "INV-1", issueDate: "2026-09-05" }) }),
      saved({ id: "b", doc: docData({ number: "INV-2", issueDate: "2026-09-20" }) }),
      saved({ id: "c", doc: docData({ number: "INV-3", issueDate: "2026-10-05" }) })
    ];
    const entries = ledgerFor(many, [bill({ stockQuantity: 50, netMinor: 1500000 })], "INR", undefined, { items });
    const stockEntries = entries.filter((e) => e.source.kind === "stock");
    expect(stockEntries).toHaveLength(2);
    expect(stockEntries.map((e) => e.date)).toEqual(["2026-09-30", "2026-10-31"]);
  });

  it("balances every entry it makes", () => {
    for (const e of ledgerFor(documents, expenses, "INR", undefined, { items })) {
      const debits = e.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
      const credits = e.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
      expect(debits).toBe(credits);
    }
  });
});

describe("the odds and ends", () => {
  it("knows whether anybody is keeping stock at all", () => {
    expect(keepingStock([item()])).toBe(true);
    expect(keepingStock([item({ tracked: false })])).toBe(false);
    expect(keepingStock([])).toBe(false);
  });

  it("works out the margin on what is on the shelf", () => {
    const level = stockFrom({ items: [item()], documents: [], expenses: [bill()] }).levels[0];
    expect(level.averageCostMinor).toBe(30000);
    expect(marginOn(level, 50000)).toEqual({ marginMinor: 20000, marginPercent: 40 });
  });

  it("gives a period's cost of sales on its own", () => {
    expect(costOfSales({ items: [item()], documents: [saved()], expenses: [bill()] })).toBe(60000);
  });
});
