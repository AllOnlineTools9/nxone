import { describe, expect, it } from "vitest";
import { readyToClose, yearEnd, yearsWithActivity, yearStarting } from "@/lib/books/yearend";
import { balanceSheet } from "@/lib/ledger/statements";
import { ledgerFor } from "@/lib/ledger/posting";
import type { Expense, SavedDocument } from "@/lib/store/types";

const invoice = (over: Partial<SavedDocument> & { id: string; issueDate: string; totalMinor: number }): SavedDocument => ({
  kind: "invoice", number: `INV-${over.id}`, clientName: "Globex", currency: "INR",
  paidMinor: over.totalMinor, status: "paid", paidOn: over.issueDate,
  createdAt: "", updatedAt: "", version: 1,
  doc: {
    kind: "invoice", country: "IN", currency: "INR", issueDate: over.issueDate, number: `INV-${over.id}`,
    seller: { name: "Brightline", region: "KA" }, buyer: { name: "Globex", region: "KA" },
    placeOfSupply: "KA", taxInclusive: false,
    items: [{ id: "l", description: "Work", quantity: 1, rate: over.totalMinor / 100, taxRuleId: "none" }]
  },
  ...over
} as SavedDocument);

const bill = (id: string, date: string, netMinor: number, over: Partial<Expense> = {}): Expense => ({
  id, date, supplier: "Cloud Co", category: "6040", currency: "INR", netMinor, taxMinor: 0,
  paidFrom: "1020", createdAt: "", updatedAt: "", version: 1, ...over
} as Expense);

// Two years of trading: 2025-26 made ₹2,00,000; 2026-27 made ₹3,00,000.
const documents = [
  invoice({ id: "1", issueDate: "2025-06-10", totalMinor: 30_000_000 }),
  invoice({ id: "2", issueDate: "2026-06-10", totalMinor: 40_000_000 })
];
const expenses = [bill("e1", "2025-07-10", 10_000_000), bill("e2", "2026-07-10", 10_000_000)];
const entries = () => ledgerFor(documents, expenses, "INR");

/* ------------------------------------------------------------------ the figures */

describe("closing a year", () => {
  const closing = yearEnd(entries(), "INR", "2026-11-15");

  it("names the year the way an accountant writes it", () => {
    expect(closing.label).toBe("2026-27");
    expect(closing.from).toBe("2026-04-01");
    expect(closing.to).toBe("2027-03-31");
  });

  it("reports what this year made, on its own", () => {
    expect(closing.profit.minor).toBe(30_000_000);
  });

  it("keeps last year's profit separate from this year's", () => {
    expect(closing.broughtForward.minor).toBe(20_000_000);
    expect(closing.carriedForward.minor).toBe(50_000_000);
  });

  it("carries only the accounts that survive a year end", () => {
    const types = new Set(closing.opening.map((row) => row.type));
    expect(types.has("income")).toBe(false);
    expect(types.has("expense")).toBe(false);
    expect(types.has("asset")).toBe(true);
  });

  it("leaves out accounts that came to nothing", () => {
    expect(closing.opening.every((row) => row.minor !== 0)).toBe(true);
  });

  it("balances", () => {
    expect(closing.balanced).toBe(true);
  });
});

describe("the balance sheet, split by year", () => {
  it("shows profit from earlier years apart from this year's", () => {
    const sheet = balanceSheet(entries(), "INR", "2027-03-31", "2026-04-01");
    expect(sheet.retainedEarlier?.minor).toBe(20_000_000);
    expect(sheet.retainedThisYear?.minor).toBe(30_000_000);
    expect(sheet.retained.minor).toBe(50_000_000);
  });

  it("says nothing about the split when no year start is given, as before", () => {
    const sheet = balanceSheet(entries(), "INR", "2027-03-31");
    expect(sheet.retainedEarlier).toBeUndefined();
    expect(sheet.retained.minor).toBe(50_000_000);
  });

  it("adds the two halves back to the whole", () => {
    const sheet = balanceSheet(entries(), "INR", "2027-03-31", "2026-04-01");
    expect((sheet.retainedEarlier?.minor ?? 0) + (sheet.retainedThisYear?.minor ?? 0)).toBe(sheet.retained.minor);
  });
});

/* ------------------------------------------------------------- before you close */

describe("what is usually wrong when somebody thinks a year is finished", () => {
  const check = (over: Partial<Parameters<typeof readyToClose>[0]> = {}) => readyToClose({
    documents, expenses, entries: entries(), currency: "INR", anyDateInYear: "2026-11-15", ...over
  });

  it("stops on an invoice still sitting in draft", () => {
    const withDraft = [...documents, invoice({ id: "3", issueDate: "2026-08-01", totalMinor: 5_000_000, status: "draft" })];
    const out = check({ documents: withDraft, entries: ledgerFor(withDraft, expenses, "INR") });
    const draft = out.checks.find((c) => c.id === "drafts")!;
    expect(draft.severity).toBe("stop");
    expect(out.clear).toBe(false);
    expect(draft.says).toContain("understated");
  });

  it("mentions unpaid invoices without blocking the close", () => {
    const owing = [...documents, invoice({ id: "4", issueDate: "2026-09-01", totalMinor: 5_000_000, paidMinor: 0, status: "sent" })];
    const out = check({ documents: owing, entries: ledgerFor(owing, expenses, "INR") });
    expect(out.checks.find((c) => c.id === "unpaid")?.severity).toBe("look");
    expect(out.clear).toBe(true);
  });

  it("notices bills nobody put an account against", () => {
    const vague = [...expenses, bill("e3", "2026-08-01", 500_000, { category: "6900" })];
    const out = check({ expenses: vague, entries: ledgerFor(documents, vague, "INR") });
    expect(out.checks.find((c) => c.id === "uncategorised")?.count).toBe(1);
  });

  it("notices a large bill when nothing is on the asset register", () => {
    const big = [...expenses, bill("e4", "2026-08-01", 18_000_000)];
    const out = check({ expenses: big, entries: ledgerFor(documents, big, "INR") });
    expect(out.checks.find((c) => c.id === "assets")?.says).toContain("two years");
  });

  it("says nothing about assets once something is on the register", () => {
    const big = [...expenses, bill("e4", "2026-08-01", 18_000_000)];
    const out = check({ expenses: big, entries: ledgerFor(documents, big, "INR"), assets: [{ purchasedOn: "2026-08-01" }] });
    expect(out.checks.find((c) => c.id === "assets")).toBeUndefined();
  });

  it("refuses to close a year whose books do not balance", () => {
    const broken = entries().slice(0, 1).map((e) => ({ ...e, lines: e.lines.slice(0, 1) }));
    const out = check({ entries: broken });
    expect(out.checks.find((c) => c.id === "balance")?.severity).toBe("stop");
    expect(out.clear).toBe(false);
  });

  it("says when the year is already closed", () => {
    expect(check({ lockedUpTo: "2027-03-31" }).checks.find((c) => c.id === "already-locked")).toBeDefined();
    expect(check({ lockedUpTo: "2026-09-30" }).checks.find((c) => c.id === "already-locked")).toBeUndefined();
  });

  it("is clear when a tidy year is put in front of it", () => {
    const out = check();
    expect(out.clear).toBe(true);
    expect(out.checks.filter((c) => c.severity === "stop")).toHaveLength(0);
  });

  it("points at the screen where each thing is fixed", () => {
    const withDraft = [...documents, invoice({ id: "3", issueDate: "2026-08-01", totalMinor: 5_000_000, status: "draft" })];
    expect(check({ documents: withDraft }).checks.find((c) => c.id === "drafts")?.fixAt).toBe("/documents");
  });
});

describe("which years there is anything to close", () => {
  it("lists them newest first", () => {
    expect(yearsWithActivity(documents, expenses)).toEqual(["2026-27", "2025-26"]);
  });

  it("works out the first day of one from its name", () => {
    expect(yearStarting("2026-27")).toBe("2026-04-01");
  });

  it("says nothing for a business that has not traded", () => {
    expect(yearsWithActivity([], [])).toEqual([]);
  });
});
