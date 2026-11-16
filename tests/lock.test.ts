import { beforeEach, describe, expect, it } from "vitest";
import { Store, type StorageLike } from "@/lib/store/db";
import { PeriodClosed, describeMove, endOfPreviousMonth, isLocked, refusal, suggestedLock, wouldClose } from "@/lib/books/lock";

const memory = (): StorageLike => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); }
  };
};

const invoice = (number: string, issueDate: string) => ({
  kind: "invoice" as const, number, clientName: "Globex", issueDate, currency: "INR",
  totalMinor: 5900000, paidMinor: 0, status: "sent" as const, version: 1,
  doc: {
    kind: "invoice" as const, country: "IN", currency: "INR", issueDate, number,
    seller: { name: "Brightline", region: "KA" }, buyer: { name: "Globex", region: "KA" },
    placeOfSupply: "KA", taxInclusive: false,
    items: [{ id: "l", description: "Work", quantity: 1, rate: 50000, taxRuleId: "in-gst-18" }]
  }
});

describe("what closed means", () => {
  it("closes the day itself, not just the days before it", () => {
    expect(isLocked("2026-09-30", "2026-09-30")).toBe(true);
    expect(isLocked("2026-10-01", "2026-09-30")).toBe(false);
  });

  it("closes nothing when no date is set", () => {
    expect(isLocked("2020-01-01", undefined)).toBe(false);
  });
});

describe("a closed period in the store", () => {
  let db: Store;

  beforeEach(() => {
    db = new Store(memory());
    db.saveProfile({ name: "Brightline", country: "IN", currency: "INR" });
    db.saveDocument(invoice("INV-0001", "2026-09-10"));
    db.saveProfile({ ...db.getProfile()!, lockedUpTo: "2026-09-30" });
  });

  it("refuses to change an invoice inside it", () => {
    const existing = db.documents()[0];
    expect(() => db.saveDocument({ ...invoice("INV-0001", "2026-09-10"), id: existing.id })).toThrow(PeriodClosed);
  });

  it("refuses to delete one inside it", () => {
    expect(() => db.deleteDocument(db.documents()[0].id)).toThrow(PeriodClosed);
  });

  it("refuses to create a new document dated inside it, which is the same hole from the other side", () => {
    expect(() => db.saveDocument(invoice("INV-0002", "2026-09-28"))).toThrow(PeriodClosed);
  });

  it("refuses to move an open document back into it", () => {
    db.saveProfile({ ...db.getProfile()!, lockedUpTo: undefined });
    const open = db.saveDocument(invoice("INV-0003", "2026-10-05"));
    db.saveProfile({ ...db.getProfile()!, lockedUpTo: "2026-09-30" });
    expect(() => db.saveDocument({ ...invoice("INV-0003", "2026-09-15"), id: open.id })).toThrow(PeriodClosed);
  });

  it("lets everything after it carry on as normal", () => {
    expect(() => db.saveDocument(invoice("INV-0004", "2026-10-02"))).not.toThrow();
    expect(db.documents()).toHaveLength(2);
  });

  it("refuses an expense inside it, and allows one after it", () => {
    const expense = (date: string) => ({
      date, supplier: "Cloud Co", category: "6040", currency: "INR",
      netMinor: 100000, taxMinor: 18000, version: 1
    });
    expect(() => db.saveExpense(expense("2026-09-20"))).toThrow(PeriodClosed);
    expect(() => db.saveExpense(expense("2026-10-20"))).not.toThrow();
  });

  it("refuses to record a payment into it, because that moves money in a closed month", () => {
    db.saveProfile({ ...db.getProfile()!, lockedUpTo: undefined });
    const open = db.saveDocument(invoice("INV-0005", "2026-10-01"));
    db.saveProfile({ ...db.getProfile()!, lockedUpTo: "2026-12-31" });
    expect(() => db.setStatus(open.id, "paid", 5900000, "2026-11-10")).toThrow(PeriodClosed);
  });

  it("says what to do instead of just saying no", () => {
    try {
      db.deleteDocument(db.documents()[0].id);
    } catch (e) {
      expect((e as Error).message).toContain("credit note");
      expect((e as Error).message).toContain("Settings");
    }
  });

  it("changes nothing when it refuses", () => {
    const before = JSON.stringify(db.documents());
    try { db.deleteDocument(db.documents()[0].id); } catch { /* expected */ }
    expect(JSON.stringify(db.documents())).toBe(before);
  });
});

describe("moving the lock", () => {
  it("treats moving it forward as routine", () => {
    expect(describeMove("2026-09-30", "2026-10-31").direction).toBe("forward");
    expect(describeMove("2026-09-30", "2026-10-31").warning).toBeUndefined();
  });

  it("warns, but does not refuse, when it moves back", () => {
    const back = describeMove("2026-09-30", "2026-08-31");
    expect(back.direction).toBe("back");
    expect(back.warning).toContain("reopens");
    expect(back.warning).toContain("already filed");
  });

  it("suggests the end of a filed period, and stops suggesting once it is covered", () => {
    expect(suggestedLock("2026-09-30", undefined)).toBe("2026-09-30");
    expect(suggestedLock("2026-09-30", "2026-08-31")).toBe("2026-09-30");
    expect(suggestedLock("2026-09-30", "2026-09-30")).toBeUndefined();
    expect(suggestedLock("2026-09-30", "2026-12-31")).toBeUndefined();
  });

  it("knows the end of last month, including over a year end", () => {
    expect(endOfPreviousMonth("2026-11-15")).toBe("2026-10-31");
    expect(endOfPreviousMonth("2027-01-04")).toBe("2026-12-31");
    expect(endOfPreviousMonth("2026-03-01")).toBe("2026-02-28");
  });

  it("counts what a lock would close, so the size of it is visible first", () => {
    const records = [{ issueDate: "2026-08-20" }, { issueDate: "2026-09-10" }, { issueDate: "2026-10-02" }];
    expect(wouldClose(records, "2026-09-30")).toBe(2);
    expect(wouldClose(records, "2026-09-30", "2026-08-31")).toBe(1);
  });

  it("writes a refusal naming the dates in the reader's own format", () => {
    const said = refusal("document", "2026-09-10", "2026-09-30", (iso) => iso.split("-").reverse().join("/"));
    expect(said).toContain("10/09/2026");
    expect(said).toContain("30/09/2026");
  });
});
