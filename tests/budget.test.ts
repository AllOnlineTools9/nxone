import { describe, expect, it } from "vitest";
import { budgetForMonth, fromLastYear, monthsOfYear, reviewBudget, type BudgetLine } from "@/lib/analysis/budget";
import { ledgerFor } from "@/lib/ledger/posting";
import type { Expense } from "@/lib/store/types";

const bill = (id: string, date: string, netMinor: number, category = "6040"): Expense => ({
  id, date, supplier: "Cloud Co", category, currency: "INR", netMinor, taxMinor: 0,
  paidFrom: "1020", createdAt: "", updatedAt: "", version: 1
} as Expense);

const review = (budgets: BudgetLine[], expenses: Expense[], today: string) =>
  reviewBudget({ budgets, entries: ledgerFor([], expenses, "INR"), currency: "INR", today });

describe("a year's months", () => {
  it("runs April to March", () => {
    const months = monthsOfYear("2026-04-01");
    expect(months[0]).toBe("2026-04");
    expect(months[11]).toBe("2027-03");
    expect(months).toHaveLength(12);
  });
});

describe("a month's share of a budget", () => {
  it("spreads a yearly figure evenly", () => {
    expect(budgetForMonth({ code: "6040", yearMinor: 12_000_000 }, "2026-05")).toBe(1_000_000);
  });

  it("uses a month's own figure when one is set", () => {
    const line = { code: "6010", yearMinor: 12_000_000, monthly: { "2026-10": 2_000_000 } };
    expect(budgetForMonth(line, "2026-10")).toBe(2_000_000);
  });

  it("spreads what is left across the months that have no figure of their own", () => {
    const line = { code: "6010", yearMinor: 12_000_000, monthly: { "2026-10": 2_000_000 } };
    expect(budgetForMonth(line, "2026-05")).toBe(Math.round(10_000_000 / 11));
  });
});

describe("against what was actually spent", () => {
  const budgets = [{ code: "6040", yearMinor: 12_000_000 }];

  it("compares only the part of the year that has gone", () => {
    // Three months in (April, May, June), ₹30,000 budgeted, ₹20,000 spent.
    const out = review(budgets, [bill("e1", "2026-05-10", 2_000_000)], "2026-06-20");
    expect(out.lines[0].expectedToDateMinor).toBe(3_000_000);
    expect(out.lines[0].actualToDateMinor).toBe(2_000_000);
    expect(out.lines[0].varianceMinor).toBe(1_000_000);
  });

  it("projects the year at the rate so far, which is the figure that matters", () => {
    // Roughly a quarter of the year gone, ₹60,000 spent: the year is heading for about
    // ₹2,40,000. Measured in days, so it is near a quarter rather than exactly one.
    const out = review(budgets, [bill("e1", "2026-05-10", 6_000_000)], "2026-06-30");
    expect(out.lines[0].projectedMinor).toBeGreaterThan(23_000_000);
    expect(out.lines[0].projectedMinor).toBeLessThan(25_000_000);
    expect(out.lines[0].outlook).toBe("well-over");
    expect(out.lines[0].says).toMatch(/comes to 2\d\d% of what was set aside/);
  });

  it("calls it on track when it is", () => {
    const out = review(budgets, [bill("e1", "2026-05-10", 3_000_000)], "2026-06-30");
    expect(out.lines[0].outlook).toBe("on-track");
    expect(out.lines[0].says).toBeUndefined();
  });

  it("notices running under, and does not assume that is good news", () => {
    const out = review(budgets, [bill("e1", "2026-05-10", 1_000_000)], "2026-06-30");
    expect(out.lines[0].outlook).toBe("under");
    expect(out.lines[0].says).toContain("not been billed yet");
  });

  it("does not extrapolate wildly from the first week of the year", () => {
    const out = review(budgets, [bill("e1", "2026-04-02", 5_000_000)], "2026-04-05");
    expect(out.lines[0].projectedMinor).toBe(12_000_000);
  });

  it("puts the worst overspend first, by money rather than by percentage", () => {
    const out = review(
      [{ code: "6040", yearMinor: 1_000_000 }, { code: "6010", yearMinor: 100_000_000 }],
      [bill("e1", "2026-05-10", 500_000, "6040"), bill("e2", "2026-05-10", 40_000_000, "6010")],
      "2026-06-30"
    );
    expect(out.attention[0].code).toBe("6010");
  });

  it("names the account rather than showing a code", () => {
    expect(review(budgets, [], "2026-06-30").lines[0].name).not.toBe("6040");
  });

  it("totals the year's budget, what has gone and where it is heading", () => {
    const out = review(budgets, [bill("e1", "2026-05-10", 6_000_000)], "2026-06-30");
    expect(out.totalBudgetMinor).toBe(12_000_000);
    expect(out.totalActualMinor).toBe(6_000_000);
    expect(out.totalProjectedMinor).toBeGreaterThan(23_000_000);
    expect(out.totalProjectedMinor).toBeLessThan(25_000_000);
  });
});

describe("a first draft from last year", () => {
  it("offers what was actually spent, biggest first", () => {
    const expenses = [
      bill("e1", "2025-06-10", 5_000_000, "6040"),
      bill("e2", "2025-08-10", 20_000_000, "6010"),
      bill("e3", "2026-06-10", 99_000_000, "6050")
    ];
    const draft = fromLastYear(ledgerFor([], expenses, "INR"), "INR", "2026-11-16");
    expect(draft.map((d) => d.code)).toEqual(["6010", "6040"]);
    expect(draft[0].yearMinor).toBe(20_000_000);
  });

  it("offers nothing for a business with no history", () => {
    expect(fromLastYear([], "INR", "2026-11-16")).toEqual([]);
  });
});
