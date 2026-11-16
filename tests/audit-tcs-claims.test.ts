import { beforeEach, describe, expect, it } from "vitest";
import { changesBetween, describe as describeEntry, fieldName, historyOf, materialChange, trim, KEEP_ENTRIES, type AuditEntry } from "@/lib/store/audit";
import { Store, type StorageLike } from "@/lib/store/db";
import { TCS_RULES, collectionsFor, reviewTcs, tcsRule } from "@/lib/tax/tcs";
import { asExpense, canMove, nextStep, summariseClaims, type Claim } from "@/lib/payroll/claims";

const memory = (): StorageLike => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
};

/* -------------------------------------------------------------- the audit trail */

describe("what changed", () => {
  it("ignores the fields that move on every save", () => {
    const out = changesBetween({ updatedAt: "a", version: 1, number: "INV-1" }, { updatedAt: "b", version: 2, number: "INV-1" });
    expect(out).toEqual([]);
  });

  it("reports a field that actually moved", () => {
    const out = changesBetween({ totalMinor: 100 }, { totalMinor: 200 });
    expect(out).toEqual([{ field: "totalMinor", from: "100", to: "200" }]);
  });

  it("does not report an object that was rebuilt with the same contents", () => {
    expect(changesBetween({ doc: { a: 1 } }, { doc: { a: 1 } })).toEqual([]);
    expect(changesBetween({ doc: { a: 1 } }, { doc: { a: 2 } })).toHaveLength(1);
  });

  it("puts the fields that change the books first", () => {
    const out = changesBetween({ notes: "x", totalMinor: 1 }, { notes: "y", totalMinor: 2 });
    expect(out[0].field).toBe("totalMinor");
  });

  it("knows which changes matter to the books", () => {
    expect(materialChange([{ field: "notes" }])).toBe(false);
    expect(materialChange([{ field: "notes" }, { field: "totalMinor" }])).toBe(true);
  });

  it("says what happened in words somebody can read", () => {
    const entry = (over: Partial<AuditEntry>): AuditEntry => ({
      id: "a", at: "2026-11-16T10:00:00Z", what: "documents", recordId: "d1", label: "INV-0012", action: "changed", ...over
    });
    expect(describeEntry(entry({ action: "created" }))).toBe("INV-0012 was created.");
    expect(describeEntry(entry({ changes: [{ field: "totalMinor", from: "100", to: "200" }] }))).toContain("total changed from 100 to 200");
    expect(describeEntry(entry({ action: "status", changes: [{ field: "status", from: "sent", to: "paid" }] }))).toBe("INV-0012 was marked paid.");
  });

  it("calls fields what people call them", () => {
    expect(fieldName("totalMinor")).toBe("total");
    expect(fieldName("clientName")).toBe("customer");
    expect(fieldName("somethingElse")).toBe("somethingElse");
  });

  it("keeps a bounded history rather than growing forever", () => {
    const many = Array.from({ length: KEEP_ENTRIES + 50 }, (_, i) => ({ id: String(i) } as AuditEntry));
    expect(trim(many)).toHaveLength(KEEP_ENTRIES);
    expect(trim(many)[0].id).toBe("50");
  });

  it("finds one record's history, newest first", () => {
    const entries = [
      { id: "1", at: "2026-01-01", recordId: "d1" }, { id: "2", at: "2026-02-01", recordId: "d1" },
      { id: "3", at: "2026-03-01", recordId: "d2" }
    ] as AuditEntry[];
    expect(historyOf(entries, "d1").map((e) => e.id)).toEqual(["2", "1"]);
  });
});

describe("the store recording its own writes", () => {
  let db: Store;
  const invoice = (over = {}) => ({
    kind: "invoice" as const, number: "INV-0001", clientName: "Globex", issueDate: "2026-09-10",
    currency: "INR", totalMinor: 5900000, paidMinor: 0, status: "sent" as const, version: 1,
    doc: { kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-10", number: "INV-0001",
      seller: { name: "B", region: "KA" }, buyer: { name: "Globex", region: "KA" },
      placeOfSupply: "KA", taxInclusive: false, items: [] } as never,
    ...over
  });

  beforeEach(() => {
    db = new Store(memory());
    db.saveProfile({ name: "Brightline", country: "IN", currency: "INR" });
  });

  it("records a document being created", () => {
    db.saveDocument(invoice());
    const trail = db.auditTrail();
    expect(trail[0].action).toBe("created");
    expect(trail[0].label).toBe("INV-0001");
  });

  it("records what changed when one is edited", () => {
    const saved = db.saveDocument(invoice());
    db.saveDocument({ ...invoice(), id: saved.id, totalMinor: 7000000 });
    expect(db.auditTrail()[0].changes?.some((c) => c.field === "totalMinor")).toBe(true);
  });

  it("writes nothing for a save that changed nothing", () => {
    const saved = db.saveDocument(invoice());
    const before = db.auditTrail().length;
    db.saveDocument({ ...invoice(), id: saved.id });
    expect(db.auditTrail()).toHaveLength(before);
  });

  it("records a deletion", () => {
    const saved = db.saveDocument(invoice());
    db.deleteDocument(saved.id);
    expect(db.auditTrail()[0].action).toBe("deleted");
  });

  it("records being marked paid, which is the thing most often queried later", () => {
    const saved = db.saveDocument(invoice());
    db.setStatus(saved.id, "paid", 5900000, "2026-09-20");
    const entry = db.auditTrail().find((e) => e.action === "status");
    expect(entry?.changes).toEqual([{ field: "status", from: "sent", to: "paid" }]);
  });

  it("records bills and assets too, not only documents", () => {
    db.saveExpense({ date: "2026-09-10", supplier: "Cloud Co", category: "6040", currency: "INR", netMinor: 100000, taxMinor: 0, version: 1 } as never);
    db.saveAsset({ name: "Laptop", classId: "computers", purchasedOn: "2026-09-01", costMinor: 1800000, currency: "INR", version: 1 } as never);
    const kinds = db.auditTrail().map((e) => e.what);
    expect(kinds).toContain("expenses");
    expect(kinds).toContain("assets");
  });
});

/* ------------------------------------------------------------------------- TCS */

describe("tax collected from a customer", () => {
  const sale = (id: string, date: string, amountMinor: number, over = {}) =>
    ({ id, date, customer: "Globex", amountMinor, ruleId: "206C1H", buyerPan: "AAACG1234C", ...over });

  it("says where the rules came from and does not claim to be verified", () => {
    expect(TCS_RULES.every((r) => r.status === "unverified" && r.source.length > 20)).toBe(true);
  });

  it("collects nothing until the seller is large enough", () => {
    expect(collectionsFor([sale("1", "2026-05-01", 60_00_000_00)], "206C1H", 5_00_00_000_00)).toEqual([]);
  });

  it("charges only the part above the threshold, not the whole sale", () => {
    const out = collectionsFor([sale("1", "2026-05-01", 60_00_000_00)], "206C1H", 20_00_00_000_00);
    expect(out[0].chargeableMinor).toBe(10_00_000_00);
    // ₹10,00,000 above the threshold at 0.1% is ₹1,000.
    expect(out[0].collectMinor).toBe(1_000_00);
  });

  it("charges nothing while the year's sales stay under it", () => {
    const out = collectionsFor([sale("1", "2026-05-01", 20_00_000_00)], "206C1H", 20_00_00_000_00);
    expect(out[0].collectMinor).toBe(0);
  });

  it("starts charging on the sale that crosses the line, and every one after", () => {
    const out = collectionsFor([
      sale("1", "2026-05-01", 40_00_000_00),
      sale("2", "2026-06-01", 20_00_000_00),
      sale("3", "2026-07-01", 10_00_000_00)
    ], "206C1H", 20_00_00_000_00);
    expect(out[0].collectMinor).toBe(0);
    expect(out[1].crossedHere).toBe(true);
    expect(out[1].chargeableMinor).toBe(10_00_000_00);
    expect(out[2].chargeableMinor).toBe(10_00_000_00);
  });

  it("charges a higher rate when the buyer gave no PAN", () => {
    const out = collectionsFor([sale("1", "2026-05-01", 60_00_000_00, { buyerPan: undefined })], "206C1H", 20_00_00_000_00);
    expect(out[0].rate).toBe(0.01);
    expect(out[0].noPan).toBe(true);
  });

  it("charges scrap from the first rupee, with no threshold at all", () => {
    const out = collectionsFor([sale("1", "2026-05-01", 1_00_000_00, { ruleId: "scrap" })], "scrap");
    expect(out[0].collectMinor).toBe(100_000);
  });

  it("knows a rule by its section", () => {
    expect(tcsRule("206C1H")?.rate).toBe(0.001);
    expect(tcsRule("nonsense")).toBeUndefined();
  });

  it("keeps each customer's threshold separate", () => {
    const out = reviewTcs({
      sales: [
        sale("1", "2026-05-01", 40_00_000_00),
        sale("2", "2026-06-01", 40_00_000_00, { customer: "Initech" })
      ],
      sellerTurnoverMinor: 20_00_00_000_00
    });
    expect(out.totalMinor).toBe(0);
  });
});

/* ------------------------------------------------------------------- the claims */

describe("money an employee is owed", () => {
  const claim = (over: Partial<Claim> = {}): Claim => ({
    id: "c1", employeeId: "emp1", employeeName: "Anita", spentOn: "2026-09-10",
    description: "Train to Pune", category: "6030", amountMinor: 250000, currency: "INR",
    state: "submitted", submittedOn: "2026-09-12", ...over
  });

  it("separates what is waiting on a decision from what is owed", () => {
    const out = summariseClaims([claim(), claim({ id: "c2", state: "approved" })], "2026-11-16");
    expect(out.waiting).toHaveLength(1);
    expect(out.owedMinor).toBe(250000);
  });

  it("leaves rejected claims out of everything", () => {
    const out = summariseClaims([claim({ state: "rejected" })], "2026-11-16");
    expect(out.waiting).toHaveLength(0);
    expect(out.owedMinor).toBe(0);
  });

  it("says how long somebody has been out of pocket, oldest first", () => {
    const out = summariseClaims([
      claim({ id: "c1", state: "approved", spentOn: "2026-11-01" }),
      claim({ id: "c2", employeeId: "emp2", employeeName: "Ravi", state: "approved", spentOn: "2026-08-01" })
    ], "2026-11-16");
    expect(out.owedBy[0].employeeName).toBe("Ravi");
    expect(out.owedBy[0].oldestDays).toBe(107);
  });

  it("dates the cost when the money was spent, not when it was approved", () => {
    expect(asExpense(claim({ state: "approved" })).date).toBe("2026-09-10");
  });

  it("owes it rather than paying it, until it is actually repaid", () => {
    expect(asExpense(claim({ state: "approved" })).paidFrom).toBeUndefined();
    expect(asExpense(claim({ state: "paid" })).paidFrom).toBe("1020");
  });

  it("will not let a claim go backwards", () => {
    expect(canMove("submitted", "approved").allowed).toBe(true);
    expect(canMove("approved", "paid").allowed).toBe(true);
    expect(canMove("paid", "approved").allowed).toBe(false);
    expect(canMove("paid", "approved").why).toContain("already been repaid");
    expect(canMove("submitted", "paid").allowed).toBe(false);
  });

  it("says what happens next, and nags when somebody has waited too long", () => {
    expect(nextStep(claim(), "2026-11-16")).toContain("Waiting on a decision");
    expect(nextStep(claim({ state: "approved" }), "2026-11-16")).toContain("out of pocket for 67 days");
    expect(nextStep(claim({ state: "rejected", reason: "No receipt" }), "2026-11-16")).toContain("No receipt");
  });
});
