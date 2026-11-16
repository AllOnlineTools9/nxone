import { describe, expect, it } from "vitest";
import { committedMinor, matchOrders, ordersFor, possibleDuplicates } from "@/lib/purchasing/match";
import type { Expense, SavedDocument } from "@/lib/store/types";

const money = (m: number) => `₹${(m / 100).toFixed(2)}`;

const order = (over: Partial<SavedDocument> = {}): SavedDocument => ({
  id: "po1", kind: "purchase-order", number: "PO-0007", clientName: "Ravi Builders",
  issueDate: "2026-09-01", currency: "INR", totalMinor: 11_800_000, paidMinor: 0, status: "sent",
  createdAt: "", updatedAt: "", version: 1,
  doc: {
    kind: "purchase-order", country: "IN", currency: "INR", issueDate: "2026-09-01", number: "PO-0007",
    seller: { name: "Brightline", region: "KA" }, buyer: { name: "Ravi Builders", region: "KA" },
    placeOfSupply: "KA", taxInclusive: false,
    items: [{ id: "l", description: "Shop fit-out", quantity: 1, rate: 100000, taxRuleId: "in-gst-18" }]
  },
  ...over
} as SavedDocument);

const bill = (over: Partial<Expense> = {}): Expense => ({
  id: "e1", date: "2026-09-20", supplier: "Ravi Builders", category: "6080", currency: "INR",
  netMinor: 10_000_000, taxMinor: 1_800_000, reference: "RB-9001", orderId: "po1",
  createdAt: "", updatedAt: "", version: 1, ...over
} as Expense);

describe("what was ordered against what was billed", () => {
  it("agrees when the bill matches the order", () => {
    const [m] = matchOrders([order()], [bill()], money);
    expect(m.state).toBe("billed");
    expect(m.advice).toBeUndefined();
  });

  it("forgives a rupee between two systems", () => {
    const [m] = matchOrders([order()], [bill({ taxMinor: 1_800_090 })], money);
    expect(m.state).toBe("billed");
  });

  it("says how much of an order is still to come", () => {
    const [m] = matchOrders([order()], [bill({ netMinor: 4_000_000, taxMinor: 720_000 })], money);
    expect(m.state).toBe("part-billed");
    expect(m.outstandingMinor).toBe(7_080_000);
    expect(m.advice).toContain("committed to spend");
  });

  it("flags being billed more than was ordered, which is the one that costs money", () => {
    const [m] = matchOrders([order()], [bill({ netMinor: 13_000_000, taxMinor: 2_340_000 })], money);
    expect(m.state).toBe("over-billed");
    expect(m.advice).toContain("before paying it");
  });

  it("adds several bills against one order together", () => {
    const [m] = matchOrders([order()], [
      bill({ id: "a", netMinor: 5_000_000, taxMinor: 900_000 }),
      bill({ id: "b", netMinor: 5_000_000, taxMinor: 900_000 })
    ], money);
    expect(m.state).toBe("billed");
    expect(m.bills).toHaveLength(2);
  });

  it("says when nothing has been billed yet", () => {
    const [m] = matchOrders([order()], [], money);
    expect(m.state).toBe("not-billed");
    expect(m.billedMinor).toBe(0);
  });

  it("ignores a bill that was never linked to the order", () => {
    const [m] = matchOrders([order()], [bill({ orderId: undefined })], money);
    expect(m.billedMinor).toBe(0);
  });

  it("leaves out orders that were only drafts or were cancelled", () => {
    expect(matchOrders([order({ status: "draft" })], [], money)).toHaveLength(0);
    expect(matchOrders([order({ status: "cancelled" })], [], money)).toHaveLength(0);
  });

  it("totals what has been committed and not yet billed", () => {
    const matches = matchOrders(
      [order(), order({ id: "po2", number: "PO-0008", issueDate: "2026-09-15" })],
      [bill({ netMinor: 4_000_000, taxMinor: 720_000 })],
      money
    );
    expect(committedMinor(matches)).toBe(7_080_000 + 11_800_000);
  });

  it("does not count an overbilled order as money still committed", () => {
    const matches = matchOrders([order()], [bill({ netMinor: 20_000_000, taxMinor: 0 })], money);
    expect(committedMinor(matches)).toBe(0);
  });
});

describe("the same bill entered twice", () => {
  it("spots two bills with one number and says what it would cost", () => {
    const [found] = possibleDuplicates([bill(), bill({ id: "e2", date: "2026-10-04" })], money);
    expect(found.bills).toHaveLength(2);
    expect(found.says).toContain("about to be paid for nothing");
    expect(found.says).toContain("₹118000.00");
  });

  it("matches a number typed differently the second time", () => {
    expect(possibleDuplicates([bill(), bill({ id: "e2", reference: "rb 9001" })], money)).toHaveLength(1);
  });

  it("says something different when the amounts differ, because that is a revised bill", () => {
    const [found] = possibleDuplicates([bill(), bill({ id: "e2", netMinor: 12_000_000 })], money);
    expect(found.says).toContain("revised bill");
  });

  it("leaves alone two different bills for the same amount, which is ordinary", () => {
    expect(possibleDuplicates([bill(), bill({ id: "e2", reference: "RB-9002" })], money)).toHaveLength(0);
  });

  it("says nothing about bills with no number to compare", () => {
    expect(possibleDuplicates([bill({ reference: undefined }), bill({ id: "e2", reference: undefined })], money)).toHaveLength(0);
  });

  it("ignores one that has been deleted", () => {
    expect(possibleDuplicates([bill(), bill({ id: "e2", deletedAt: "2026-10-05" })], money)).toHaveLength(0);
  });
});

describe("offering the order a bill probably belongs to", () => {
  it("offers that supplier's open orders", () => {
    const found = ordersFor("Ravi Builders", [order()], []);
    expect(found).toHaveLength(1);
    expect(found[0].number).toBe("PO-0007");
  });

  it("does not offer one that is already fully billed", () => {
    expect(ordersFor("Ravi Builders", [order()], [bill()])).toHaveLength(0);
  });

  it("does not offer another supplier's orders", () => {
    expect(ordersFor("Cloud Hosting Co", [order()], [])).toHaveLength(0);
  });

  it("copes with a supplier typed with different capitals and spacing", () => {
    expect(ordersFor("  ravi builders ", [order()], [])).toHaveLength(1);
  });

  it("offers nothing when no supplier is named yet", () => {
    expect(ordersFor("", [order()], [])).toHaveLength(0);
  });
});
