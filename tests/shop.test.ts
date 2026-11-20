import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/documents/totals";
import type { DocumentData } from "@/lib/documents/types";
import {
  DEFAULT_SETTINGS, addToCart, changeFor, daySummary, findByCode, quickCash, saleDocument, searchItems
} from "@/lib/shop/sale";
import type { CatalogueItem, Profile } from "@/lib/store/types";

const item = (over: Partial<CatalogueItem>): CatalogueItem => ({ id: "i1", description: "Parle-G 250g", rate: 25, createdAt: "", updatedAt: "", ...over } as CatalogueItem);
const items = [
  item({ id: "a", description: "Parle-G 250g", barcode: "8901719104046", taxRuleId: "in-gst-5" }),
  item({ id: "b", description: "Amul Butter 100g", rate: 62, barcode: "8901262010016", taxRuleId: "in-gst-5" }),
  item({ id: "c", description: "Notebook", rate: 40 })
];

const profile: Profile = { name: "Sharma Stores", country: "IN", currency: "INR", region: "KA", taxId: "29AAGCB7383J1Z4" };
const base = {
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-11-19", number: "INV-0042",
  seller: { name: "Sharma Stores", region: "KA", taxId: "29AAGCB7383J1Z4" }, buyer: { name: "" },
  items: [{ id: "x", description: "", quantity: 1, rate: 0, taxRuleId: "in-gst-18" }], taxInclusive: false, roundOff: true
} as DocumentData;

describe("finding things at the counter", () => {
  it("finds a scanned barcode exactly, ignoring stray spaces", () => {
    expect(findByCode(items, " 8901262010016 ")?.id).toBe("b");
    expect(findByCode(items, "89012620")).toBeUndefined();
  });

  it("puts name matches first when searching", () => {
    expect(searchItems(items, "amul").map((i) => i.id)).toEqual(["b"]);
    expect(searchItems(items, "note")[0].id).toBe("c");
    expect(searchItems(items, "8901719")[0].id).toBe("a");
    expect(searchItems(items, "")).toEqual([]);
  });

  it("adds one more of an item already in the bill rather than a second line", () => {
    const once = addToCart([], items[0]);
    const twice = addToCart(once, items[0], 2);
    expect(twice).toHaveLength(1);
    expect(twice[0].quantity).toBe(3);
  });
});

describe("the sale as an invoice", () => {
  const cart = addToCart(addToCart([], items[0], 2), items[1]);
  const doc = saleDocument(base, profile, cart, { settings: DEFAULT_SETTINGS, mode: "upi" });
  const t = calculate(doc);

  it("is to a walk-in customer in the shop's own state, paid in full", () => {
    expect(doc.buyer.name).toBe("Walk-in customer");
    expect(doc.placeOfSupply).toBe("KA");
    expect(Math.round((doc.amountPaid ?? 0) * 100)).toBe(t.total.minor);
    expect(doc.notes).toBe("Paid by UPI.");
  });

  it("takes shelf prices as including GST, so the total is what the customer saw", () => {
    expect(t.total.minor).toBe(11_200);
    expect(t.taxTotal.minor).toBeGreaterThan(0);
    expect(t.supply.interRegion).toBe(false);
  });

  it("adds tax on top when the shop prices without it", () => {
    const ex = calculate(saleDocument(base, profile, cart, { settings: { ...DEFAULT_SETTINGS, pricesIncludeTax: false }, mode: "cash" }));
    expect(ex.total.minor).toBeGreaterThan(11_200);
  });
});

describe("the money", () => {
  it("works out change, or what is short", () => {
    expect(changeFor(11_200, 20_000)).toEqual({ changeMinor: 8_800, shortMinor: 0 });
    expect(changeFor(11_200, 10_000)).toEqual({ changeMinor: 0, shortMinor: 1_200 });
  });

  it("offers the notes a customer is likely to hand over", () => {
    expect(quickCash(11_200)).toEqual([11_200, 12_000, 15_000, 20_000]);
  });

  it("adds up the day by how it was paid, leaving out other invoices", () => {
    const day = daySummary([
      { issueDate: "2026-11-19", status: "paid", totalMinor: 100_00, sale: { mode: "cash" } },
      { issueDate: "2026-11-19", status: "paid", totalMinor: 50_00, sale: { mode: "upi" } },
      { issueDate: "2026-11-19", status: "cancelled", totalMinor: 70_00, sale: { mode: "cash" } },
      { issueDate: "2026-11-18", status: "paid", totalMinor: 900_00, sale: { mode: "cash" } },
      { issueDate: "2026-11-19", status: "sent", totalMinor: 999_00 }
    ], "2026-11-19");
    expect(day).toEqual({ count: 2, totalMinor: 150_00, byMode: { cash: 100_00, upi: 50_00, card: 0 } });
  });
});
