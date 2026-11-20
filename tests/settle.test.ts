import { describe, expect, it } from "vitest";
import { allowDiscount, paymentBounced, writeOff } from "@/lib/documents/settle";
import { owedOn } from "@/lib/documents/owed";
import { ledgerFor } from "@/lib/ledger/posting";
import { balances } from "@/lib/ledger/journal";
import type { DocumentData } from "@/lib/documents/types";
import type { SavedDocument } from "@/lib/store/types";

const doc = {
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-10-01", number: "INV-1",
  seller: { name: "B", region: "KA", taxId: "29AAGCB7383J1Z4" }, buyer: { name: "Globex", region: "KA" }, placeOfSupply: "KA",
  items: [{ id: "l", description: "Work", quantity: 1, rate: 10000, taxRuleId: "in-gst-18" }], taxInclusive: false
} as DocumentData;
const inv = (over: Partial<SavedDocument> = {}): SavedDocument => ({
  id: "d1", kind: "invoice", number: "INV-1", clientName: "Globex", issueDate: "2026-10-01", currency: "INR",
  totalMinor: 11_800_00, paidMinor: 0, status: "sent", doc, createdAt: "", updatedAt: "2026-10-01T00:00:00Z", ...over
});
const bal = (d: SavedDocument, code: string) => balances(ledgerFor([d], [], "INR"), "INR").find((r) => r.code === code)?.balance.minor ?? 0;

describe("settling short", () => {
  it("closes the invoice with a discount allowed, and the books agree", () => {
    const paid = inv({ paidMinor: 11_600_00, paidOn: "2026-10-20", status: "partly-paid" });
    const r = allowDiscount(paid, 200_00, "2026-10-20");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.status).toBe("paid");
    expect(owedOn(r.doc)).toBe(0);
    expect(bal(r.doc, "1200")).toBe(0);
    expect(bal(r.doc, "4900")).toBe(-200_00);
  });

  it("refuses more than is owed", () => {
    expect(allowDiscount(inv({ paidMinor: 11_600_00 }), 500_00, "2026-10-20").ok).toBe(false);
  });
});

describe("writing off", () => {
  it("writes off what is left as a bad debt", () => {
    const r = writeOff(inv({ paidMinor: 5_000_00, status: "partly-paid", paidOn: "2026-10-05" }), "2027-03-31");
    if (!r.ok) throw new Error(r.says);
    expect(r.doc.settlement?.writtenOffMinor).toBe(6_800_00);
    expect(r.doc.status).toBe("paid");
    expect(bal(r.doc, "6120")).toBe(6_800_00);
    expect(bal(r.doc, "1200")).toBe(0);
  });
});

describe("a payment that bounced", () => {
  it("is owed again, and the bank shows it went in and came back out", () => {
    const paid = inv({ paidMinor: 11_800_00, paidOn: "2026-10-10", status: "paid" });
    const r = paymentBounced(paid, 11_800_00, "2026-10-14", 500_00);
    if (!r.ok) throw new Error(r.says);
    expect(r.doc.status).toBe("sent");
    expect(owedOn(r.doc)).toBe(11_800_00);
    expect(bal(r.doc, "1200")).toBe(11_800_00);
    expect(bal(r.doc, "1020")).toBe(-500_00);
    expect(bal(r.doc, "6090")).toBe(500_00);
    const posted = ledgerFor([r.doc], [], "INR").filter((e) => e.lines.some((l) => l.account === "1020"));
    expect(posted.map((e) => e.date)).toEqual(["2026-10-10", "2026-10-14", "2026-10-14"]);
  });

  it("cannot bounce more than was received, or before it arrived", () => {
    expect(paymentBounced(inv({ paidMinor: 100 }), 200, "2026-10-14").ok).toBe(false);
    expect(paymentBounced(inv({ paidMinor: 100, paidOn: "2026-10-10" }), 100, "2026-10-09").ok).toBe(false);
  });
});

describe("entries recorded directly", () => {
  it("are posted into the books", () => {
    const entries = ledgerFor([], [], "INR", undefined, undefined, undefined, [
      { id: "m1", date: "2026-04-01", narration: "Capital", voucher: "receipt", lines: [{ account: "1020", debit: 100_00 }, { account: "3000", credit: 100_00 }], createdAt: "", updatedAt: "" },
      { id: "m2", date: "2026-04-02", narration: "Gone", voucher: "receipt", lines: [{ account: "1020", debit: 5 }, { account: "3000", credit: 5 }], createdAt: "", updatedAt: "", deletedAt: "x" }
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toEqual({ kind: "manual", id: "m1" });
  });
});
