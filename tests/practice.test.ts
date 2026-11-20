import { describe, expect, it } from "vitest";
import { booksFrom, summarise } from "@/lib/practice/summary";

const doc = (over: Record<string, unknown>) => ({
  id: "d", kind: "invoice", number: "INV-1", clientName: "Globex", issueDate: "2026-11-02", currency: "INR",
  totalMinor: 100_000_00, paidMinor: 0, status: "sent", doc: {}, createdAt: "", updatedAt: "", ...over
});

describe("a client's books in the practice list", () => {
  const books = booksFrom([
    { kind: "profile", body: { name: "Brightline", country: "IN", currency: "INR", registrations: ["gst"], lockedUpTo: "2026-09-30" } },
    { kind: "document", body: doc({ id: "a", dueDate: "2026-11-10" }) },
    { kind: "document", body: doc({ id: "b", number: "INV-2", issueDate: "2026-10-05", totalMinor: 50_000_00, paidMinor: 50_000_00, status: "paid" }) },
    { kind: "document", body: doc({ id: "c", number: "INV-3", currency: "USD", totalMinor: 1_000_00 }) },
    { kind: "document", body: doc({ id: "d", number: "Q-1", kind: "quote" }) },
    { kind: "document", body: doc({ id: "e", number: "INV-4", status: "draft" }) },
    { kind: "client", body: { id: "x" } }
  ]);
  const s = summarise(books, "2026-11-19");

  it("counts what is owed in the books' currency, and overdue invoices", () => {
    expect(s.receivableMinor).toBe(100_000_00);
    expect(s.overdueInvoices).toBe(1);
    expect(s.foreignInvoices).toBe(1);
  });

  it("counts this month's sales, leaving out drafts and quotations", () => {
    expect(s.invoicesThisMonth).toBe(2);
    expect(s.salesThisMonthMinor).toBe(100_000_00);
    expect(s.lastInvoiceDate).toBe("2026-11-02");
  });

  it("marks returns done once the books are closed past their period", () => {
    const sept = s.deadlines.filter((d) => d.periodEnd <= "2026-09-30");
    const oct = s.deadlines.filter((d) => d.periodEnd === "2026-10-31");
    expect(sept.length).toBeGreaterThan(0);
    expect(sept.every((d) => d.done)).toBe(true);
    expect(oct.length).toBeGreaterThan(0);
    expect(oct.every((d) => !d.done)).toBe(true);
    expect(s.next && !s.next.done).toBe(true);
  });

  it("shows nothing due for a business with no registrations", () => {
    const none = summarise(booksFrom([{ kind: "profile", body: { country: "IN" } }]), "2026-11-19");
    expect(none.deadlines).toEqual([]);
    expect(none.next).toBeUndefined();
  });
});
