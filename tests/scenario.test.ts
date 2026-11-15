import { beforeEach, describe, expect, it } from "vitest";
import { Store, type StorageLike } from "@/lib/store/db";
import { applyIncoming, pendingRecords, toWire } from "@/lib/sync/records";
import { affordableFixedCostMinor, describeChange, presetsFor, simulate, tidy, type Baseline } from "@/lib/analysis/scenario";
import { baselineFrom, enoughToSimulate, wholeMonthsBefore } from "@/lib/analysis/baseline";
import type { Expense, SavedDocument } from "@/lib/store/types";
import type { DocumentData } from "@/lib/documents/types";

/**
 * A shop turning over ₹4,00,000 a month, ₹2,40,000 of that going on stock
 * (60%), ₹1,00,000 of rent and salaries, ₹5,00,000 in the bank.
 * Profit: ₹60,000 a month. Margin: 15%.
 */
const shop: Baseline = {
  currency: "INR",
  monthlyIncomeMinor: 40000000,
  monthlyVariableCostMinor: 24000000,
  monthlyFixedCostMinor: 10000000,
  cashMinor: 50000000,
};

describe("the month as it stands", () => {
  it("reports profit and margin from the baseline", () => {
    const sim = simulate(shop, { name: "Nothing changes", changes: [] });
    expect(sim.before.monthlyProfitMinor).toBe(6000000);
    expect(sim.before.marginPercent).toBe(15);
    expect(sim.before.contributionPercent).toBe(40);
    expect(sim.after.monthlyProfitMinor).toBe(6000000);
    expect(sim.delta.monthlyProfitMinor).toBe(0);
    expect(sim.lines[0]).toBe("Your monthly profit would not move.");
  });

  it("works out break-even from the fixed costs and the contribution", () => {
    // ₹1,00,000 of fixed costs, 40 paise of every rupee left over → ₹2,50,000.
    const sim = simulate(shop, { name: "Nothing changes", changes: [] });
    expect(sim.before.breakEvenIncomeMinor).toBe(25000000);
  });

  it("has no runway while the month is profitable", () => {
    const sim = simulate(shop, { name: "Nothing changes", changes: [] });
    expect(sim.before.runwayMonths).toBeNull();
  });
});

describe("hiring someone", () => {
  it("takes the salary out of profit, not out of the cost of sales", () => {
    const sim = simulate(shop, {
      name: "Hire a second pair of hands",
      changes: [{ kind: "hire", label: "warehouse", monthlyCostMinor: 3000000 }],
    });
    expect(sim.after.monthlyFixedCostMinor).toBe(13000000);
    expect(sim.after.monthlyVariableCostMinor).toBe(24000000);
    expect(sim.after.monthlyProfitMinor).toBe(3000000);
    expect(sim.delta.monthlyProfitMinor).toBe(-3000000);
  });

  it("raises the sales needed to break even", () => {
    const sim = simulate(shop, {
      name: "Hire",
      changes: [{ kind: "hire", monthlyCostMinor: 3000000 }],
    });
    // ₹1,30,000 of fixed costs at a 40% contribution → ₹3,25,000.
    expect(sim.after.breakEvenIncomeMinor).toBe(32500000);
    expect(sim.delta.breakEvenIncomeMinor).toBe(7500000);
  });

  it("says plainly that it is affordable when it is", () => {
    const sim = simulate(shop, {
      name: "Hire",
      changes: [{ kind: "hire", monthlyCostMinor: 3000000 }],
    });
    expect(sim.safe).toBe(true);
    expect(sim.headline).toContain("You can afford this");
  });

  it("calls out the hire that tips the business into a loss", () => {
    const sim = simulate(shop, {
      name: "Hire two",
      changes: [{ kind: "hire", monthlyCostMinor: 8000000 }],
    });
    expect(sim.after.monthlyProfitMinor).toBe(-2000000);
    expect(sim.safe).toBe(false);
    expect(sim.headline).toContain("loss");
    // ₹5,00,000 in hand, losing ₹20,000 a month.
    expect(sim.after.runwayMonths).toBe(25);
  });

  it("only charges the salary from the month the person starts", () => {
    const sim = simulate(shop, {
      name: "Hire in three months",
      changes: [{ kind: "hire", monthlyCostMinor: 3000000, startsInMonths: 3 }],
      horizonMonths: 4,
    });
    expect(sim.after.cash[0].profitMinor).toBe(6000000); // month 1, nobody hired
    expect(sim.after.cash[1].profitMinor).toBe(6000000);
    expect(sim.after.cash[2].profitMinor).toBe(3000000); // month 3, on payroll
    expect(sim.after.cash[3].profitMinor).toBe(3000000);
  });
});

describe("losing a customer", () => {
  it("takes away the stock that customer's orders used", () => {
    const sim = simulate(shop, {
      name: "Lose the biggest account",
      changes: [{ kind: "lose-customer", label: "Mehta & Co", monthlyIncomeMinor: 12000000 }],
    });
    expect(sim.after.monthlyIncomeMinor).toBe(28000000);
    // 60% of the lost sales was stock.
    expect(sim.after.monthlyVariableCostMinor).toBe(16800000);
    expect(sim.after.monthlyProfitMinor).toBe(1200000);
    // Fixed costs do not shrink, so the margin falls further than the sales.
    expect(sim.after.marginPercent).toBe(4.3);
  });

  it("reports the loss when the customer was carrying the fixed costs", () => {
    const sim = simulate(shop, {
      name: "Lose half the book",
      changes: [{ kind: "lose-customer", monthlyIncomeMinor: 20000000 }],
    });
    expect(sim.after.monthlyProfitMinor).toBe(-2000000);
    expect(sim.safe).toBe(false);
    expect(sim.lines.join(" ")).toContain("short of covering your costs");
  });
});

describe("raising prices", () => {
  it("lifts the profit by the whole of the increase when nothing else moves", () => {
    const sim = simulate(shop, {
      name: "10% up",
      changes: [{ kind: "price-change", percent: 10 }],
    });
    expect(sim.after.monthlyIncomeMinor).toBe(44000000);
    expect(sim.after.monthlyVariableCostMinor).toBe(24000000);
    expect(sim.after.monthlyProfitMinor).toBe(10000000);
    expect(sim.delta.marginPoints).toBe(7.7);
  });

  it("accounts for the orders a price rise costs you", () => {
    const sim = simulate(shop, {
      name: "10% up, a tenth of orders gone",
      changes: [{ kind: "price-change", percent: 10, volumePercent: -10 }],
    });
    // 90% of the volume at 110% of the price.
    expect(sim.after.monthlyIncomeMinor).toBe(39600000);
    expect(sim.after.monthlyVariableCostMinor).toBe(21600000);
    expect(sim.after.monthlyProfitMinor).toBe(8000000);
    // Still ahead: fewer orders, but each one earns more.
    expect(sim.delta.monthlyProfitMinor).toBe(2000000);
  });

  it("shows when the lost orders outweigh the higher price", () => {
    const sim = simulate(shop, {
      name: "10% up, half the orders gone",
      changes: [{ kind: "price-change", percent: 10, volumePercent: -50 }],
    });
    expect(sim.after.monthlyProfitMinor).toBeLessThan(sim.before.monthlyProfitMinor);
  });
});

describe("costs moving", () => {
  it("puts a supplier increase onto the cost of sales only", () => {
    const sim = simulate(shop, {
      name: "Suppliers up 15%",
      changes: [{ kind: "cost-change", percent: 15 }],
    });
    expect(sim.after.monthlyVariableCostMinor).toBe(27600000);
    expect(sim.after.monthlyFixedCostMinor).toBe(10000000);
    expect(sim.after.monthlyProfitMinor).toBe(2400000);
  });

  it("refuses to invent a break-even when costs swallow the sale", () => {
    const sim = simulate(shop, {
      name: "Suppliers double",
      changes: [{ kind: "cost-change", percent: 80 }],
    });
    // Stock alone would be ₹4,32,000 on ₹4,00,000 of sales.
    expect(sim.after.breakEvenIncomeMinor).toBeNull();
    expect(sim.unanswered.join(" ")).toContain("Break-even cannot be worked out");
  });
});

describe("selling more", () => {
  it("scales the cost of sales with the sales", () => {
    const sim = simulate(shop, {
      name: "A quarter more",
      changes: [{ kind: "volume-change", percent: 25 }],
    });
    expect(sim.after.monthlyIncomeMinor).toBe(50000000);
    expect(sim.after.monthlyVariableCostMinor).toBe(30000000);
    expect(sim.after.monthlyProfitMinor).toBe(10000000);
    expect(sim.headline).toContain("better off");
  });
});

describe("cash", () => {
  it("projects month by month and reports the end of the horizon", () => {
    const sim = simulate(shop, { name: "Nothing changes", changes: [], horizonMonths: 6 });
    expect(sim.after.cash).toHaveLength(6);
    expect(sim.after.cash[0].cashMinor).toBe(56000000);
    expect(sim.after.cashAtHorizonMinor).toBe(50000000 + 6 * 6000000);
  });

  it("takes a one-off out of the month it falls in, not out of profit", () => {
    const sim = simulate(shop, {
      name: "Buy a van",
      changes: [{ kind: "one-off", label: "van", amountMinor: 80000000, inMonths: 2 }],
      horizonMonths: 4,
    });
    expect(sim.after.monthlyProfitMinor).toBe(6000000);
    expect(sim.after.cash[0].cashMinor).toBe(56000000);
    expect(sim.after.cash[1].cashMinor).toBe(62000000 - 80000000);
    expect(sim.after.cash[1].cashMinor).toBeLessThan(0);
    expect(sim.after.lowestCashMonth).toBe(2);
  });

  it("names the month cash falls below the owner's floor", () => {
    const sim = simulate(
      { ...shop, minimumCashMinor: 20000000 },
      {
        name: "Hire two and buy a van",
        changes: [
          { kind: "hire", monthlyCostMinor: 8000000 },
          { kind: "one-off", amountMinor: 35000000, inMonths: 1 },
        ],
        horizonMonths: 6,
      },
    );
    expect(sim.after.tightFromMonth).toBe(1);
    expect(sim.safe).toBe(false);
    expect(sim.lines.join(" ")).toContain("floor in month 1");
  });

  it("does not blame a scenario for a floor already breached", () => {
    const sim = simulate(
      { ...shop, cashMinor: 1000000, minimumCashMinor: 20000000 },
      { name: "Hire", changes: [{ kind: "hire", monthlyCostMinor: 1000000 }], horizonMonths: 3 },
    );
    expect(sim.before.tightFromMonth).toBe(0);
    expect(sim.after.tightFromMonth).toBe(0);
    expect(sim.headline).not.toContain("gets tight");
  });

  it("says outright that money already invoiced is not cash yet", () => {
    const sim = simulate(
      { ...shop, receivablesMinor: 15000000 },
      { name: "Hire", changes: [{ kind: "hire", monthlyCostMinor: 1000000 }] },
    );
    expect(sim.lines.join(" ")).toContain("is not counted as cash until it does");
  });
});

describe("runway", () => {
  it("counts whole months of losses the cash can absorb", () => {
    const sim = simulate(
      { ...shop, cashMinor: 10000000 },
      { name: "Lose half the book", changes: [{ kind: "lose-customer", monthlyIncomeMinor: 20000000 }] },
    );
    // Losing ₹20,000 a month against ₹1,00,000 in hand.
    expect(sim.after.runwayMonths).toBe(5);
  });

  it("reports nothing in reserve rather than a negative runway", () => {
    const sim = simulate(
      { ...shop, cashMinor: 0 },
      { name: "Lose half the book", changes: [{ kind: "lose-customer", monthlyIncomeMinor: 20000000 }] },
    );
    expect(sim.after.runwayMonths).toBe(0);
    expect(sim.lines.join(" ")).toContain("nothing in reserve");
  });
});

describe("what you can afford", () => {
  it("is the whole monthly profit when cash is above the floor", () => {
    expect(affordableFixedCostMinor(shop)).toBe(6000000);
  });

  it("is nothing when the month already loses money", () => {
    expect(affordableFixedCostMinor({ ...shop, monthlyFixedCostMinor: 20000000 })).toBe(0);
  });

  it("is held back when cash sits below the floor", () => {
    const tight = { ...shop, cashMinor: 0, minimumCashMinor: 12000000 };
    // ₹60,000 profit less ₹1,20,000 to find over twelve months.
    expect(affordableFixedCostMinor(tight, 12)).toBe(5000000);
  });
});

describe("several changes at once", () => {
  it("applies them together", () => {
    const sim = simulate(shop, {
      name: "Hire, raise prices, lose one account",
      changes: [
        { kind: "hire", monthlyCostMinor: 3000000 },
        { kind: "price-change", percent: 8 },
        { kind: "lose-customer", monthlyIncomeMinor: 4000000 },
      ],
    });
    // Customer goes first (income 36,00,000, stock 21,60,000), then prices.
    expect(sim.after.monthlyIncomeMinor).toBe(38880000);
    expect(sim.after.monthlyVariableCostMinor).toBe(21600000);
    expect(sim.after.monthlyFixedCostMinor).toBe(13000000);
    expect(sim.after.monthlyProfitMinor).toBe(4280000);
  });

  it("gives the same answer whatever order they were entered in", () => {
    const changes = [
      { kind: "hire", monthlyCostMinor: 3000000 },
      { kind: "price-change", percent: 8 },
      { kind: "lose-customer", monthlyIncomeMinor: 4000000 },
    ] as const;
    const forwards = simulate(shop, { name: "a", changes: [...changes] });
    const backwards = simulate(shop, { name: "a", changes: [...changes].reverse() });
    expect(backwards.after.monthlyProfitMinor).toBe(forwards.after.monthlyProfitMinor);
    expect(backwards.after.monthlyIncomeMinor).toBe(forwards.after.monthlyIncomeMinor);
  });
});

describe("edges", () => {
  it("survives a business with no sales yet", () => {
    const sim = simulate(
      {
        currency: "INR",
        monthlyIncomeMinor: 0,
        monthlyVariableCostMinor: 0,
        monthlyFixedCostMinor: 5000000,
        cashMinor: 20000000,
      },
      { name: "Hire", changes: [{ kind: "hire", monthlyCostMinor: 2000000 }] },
    );
    expect(sim.after.marginPercent).toBeNull();
    expect(sim.after.breakEvenIncomeMinor).toBeNull();
    expect(sim.after.runwayMonths).toBe(2);
    expect(sim.unanswered.length).toBeGreaterThan(0);
  });

  it("treats a horizon of zero as one month", () => {
    const sim = simulate(shop, { name: "Hire", changes: [], horizonMonths: 0 });
    expect(sim.horizonMonths).toBe(1);
    expect(sim.after.cash).toHaveLength(1);
  });

  it("ignores a change that starts beyond the horizon", () => {
    const sim = simulate(shop, {
      name: "Hire next year",
      changes: [{ kind: "hire", monthlyCostMinor: 3000000, startsInMonths: 24 }],
      horizonMonths: 6,
    });
    expect(sim.after.cash.every((p) => p.profitMinor === 6000000)).toBe(true);
  });

  it("puts a person leaving back onto the profit", () => {
    const sim = simulate(shop, {
      name: "One fewer",
      changes: [{ kind: "let-go", monthlyCostMinor: 2500000 }],
    });
    expect(sim.after.monthlyFixedCostMinor).toBe(7500000);
    expect(sim.after.monthlyProfitMinor).toBe(8500000);
  });

  it("describes every kind of change in words", () => {
    const words = [
      describeChange({ kind: "hire", monthlyCostMinor: 1, label: "driver" }),
      describeChange({ kind: "let-go", monthlyCostMinor: 1 }),
      describeChange({ kind: "lose-customer", monthlyIncomeMinor: 1 }),
      describeChange({ kind: "win-customer", monthlyIncomeMinor: 1 }),
      describeChange({ kind: "price-change", percent: -5 }),
      describeChange({ kind: "volume-change", percent: 5 }),
      describeChange({ kind: "cost-change", percent: 5 }),
      describeChange({ kind: "fixed-cost", monthlyCostMinor: 1 }),
      describeChange({ kind: "one-off", amountMinor: -1 }),
    ];
    expect(words).toEqual([
      "Hire someone (driver)",
      "One fewer person",
      "Lose a customer",
      "Win a customer",
      "Prices down 5%",
      "Sell more by 5%",
      "Costs up 5%",
      "New standing cost",
      "One-off receipt",
    ]);
  });

  it("offers presets that run against the owner's own figures", () => {
    const presets = presetsFor(shop);
    expect(presets.map((p) => p.name)).toContain("Lose your biggest customer");
    for (const preset of presets) {
      const sim = simulate(shop, preset);
      expect(Number.isFinite(sim.after.monthlyProfitMinor)).toBe(true);
      expect(sim.lines.length).toBeGreaterThan(0);
    }
  });

  it("formats money with whatever formatter the app passes in", () => {
    const sim = simulate(
      shop,
      { name: "Hire", changes: [{ kind: "hire", monthlyCostMinor: 3000000 }] },
      (minor) => `R${minor / 100}`,
    );
    expect(sim.headline).toContain("R30000");
  });
});

/* ------------------------------------------------- a typical month from the books */

const docData = {
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-07-05", number: "INV-1",
  seller: { name: "Acme", region: "MH" }, buyer: { name: "Globex" }, placeOfSupply: "MH",
  items: [{ id: "1", description: "Work", quantity: 1, rate: 100000, taxRuleId: "in-gst-18" }],
  taxInclusive: false
} as DocumentData;

const bill = (over: Partial<SavedDocument> & { issueDate: string }): SavedDocument => ({
  id: over.id ?? Math.random().toString(36).slice(2), kind: "invoice", number: "INV-1", clientName: "Globex",
  dueDate: over.issueDate, currency: "INR", totalMinor: 11800000, paidMinor: 0, status: "sent",
  doc: { ...docData, issueDate: over.issueDate }, createdAt: "", updatedAt: "", ...over
});

const spend = (over: Partial<Expense> & { date: string }): Expense => ({
  id: Math.random().toString(36).slice(2), supplier: "Supplier", category: "5000", currency: "INR",
  netMinor: 6000000, taxMinor: 0, paidFrom: "1020", createdAt: "", updatedAt: "", ...over
});

const TODAY = "2026-10-16";

describe("the window the average is taken over", () => {
  it("is the whole months behind us, never the one in progress", () => {
    expect(wholeMonthsBefore(TODAY, 3)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("crosses the turn of the year without losing a month", () => {
    expect(wholeMonthsBefore("2026-02-10", 3)).toEqual({ from: "2025-11-01", to: "2026-01-31" });
  });

  it("ends on the last day of a short month", () => {
    expect(wholeMonthsBefore("2026-04-02", 1)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });
});

describe("a typical month worked out from the books", () => {
  const documents = [
    bill({ id: "a", issueDate: "2026-07-05" }),
    bill({ id: "b", issueDate: "2026-08-05" }),
    bill({ id: "c", issueDate: "2026-09-05" })
  ];
  const expenses = [
    spend({ date: "2026-07-10" }), spend({ date: "2026-08-10" }), spend({ date: "2026-09-10" }),
    spend({ date: "2026-07-01", category: "6010", netMinor: 2000000 }),
    spend({ date: "2026-08-01", category: "6010", netMinor: 2000000 }),
    spend({ date: "2026-09-01", category: "6010", netMinor: 2000000 })
  ];
  const profile = { name: "Acme", country: "IN", currency: "INR", openingCashMinor: 50000000, openingCashDate: "2026-06-01" };
  const derived = baselineFrom({ documents, expenses, profile, today: TODAY, currency: "INR", months: 3 });

  it("averages sales over the whole months, excluding tax", () => {
    expect(derived.baseline.monthlyIncomeMinor).toBe(10000000);
  });

  it("separates the costs that move with sales from the ones that do not", () => {
    expect(derived.baseline.monthlyVariableCostMinor).toBe(6000000);
    expect(derived.baseline.monthlyFixedCostMinor).toBe(2000000);
    expect(derived.variable.map((r) => r.code)).toEqual(["5000"]);
    expect(derived.fixed.map((r) => r.code)).toEqual(["6010"]);
  });

  it("takes cash from the ledger as it stands, including the opening balance", () => {
    // ₹5,00,000 to begin with, ₹2,40,000 of bills paid, nothing collected yet.
    expect(derived.baseline.cashMinor).toBe(50000000 - 24000000);
  });

  it("reports what is invoiced and unpaid without counting it as cash", () => {
    expect(derived.baseline.receivablesMinor).toBe(3 * 11800000);
  });

  it("counts bills recorded but not yet paid as payables", () => {
    const withOwing = baselineFrom({
      documents,
      expenses: [...expenses, spend({ date: "2026-09-20", category: "6070", netMinor: 1500000, paidFrom: undefined })],
      profile, today: TODAY, currency: "INR", months: 3
    });
    expect(withOwing.baseline.payablesMinor).toBe(1500000);
  });

  it("says in words which months it looked at", () => {
    expect(derived.basis.label).toBe("July 2026 to September 2026");
    expect(derived.basis.months).toBe(3);
    expect(derived.basis.thin).toBe(false);
  });

  it("feeds straight into a scenario", () => {
    const sim = simulate(derived.baseline, { name: "Hire", changes: [{ kind: "hire", monthlyCostMinor: 1500000 }] });
    expect(sim.before.monthlyProfitMinor).toBe(2000000);
    expect(sim.after.monthlyProfitMinor).toBe(500000);
    expect(sim.safe).toBe(true);
  });
});

describe("a business with nothing behind it", () => {
  const documents = [bill({ id: "a", issueDate: "2026-10-04" })];
  const expenses = [spend({ date: "2026-10-05" })];
  const derived = baselineFrom({ documents, expenses, today: TODAY, currency: "INR", months: 3 });

  it("falls back to the month in progress rather than reporting nothing", () => {
    expect(derived.baseline.monthlyIncomeMinor).toBe(10000000);
    expect(derived.basis.usedCurrentMonth).toBe(true);
    expect(derived.basis.label).toBe("October 2026 so far");
  });

  it("marks the figures as thin, so the screen can say to check them", () => {
    expect(derived.basis.thin).toBe(true);
  });
});

describe("a business with nothing recorded at all", () => {
  const derived = baselineFrom({ documents: [], expenses: [], today: TODAY, currency: "INR" });

  it("reports zeroes rather than throwing", () => {
    expect(derived.baseline.monthlyIncomeMinor).toBe(0);
    expect(derived.baseline.monthlyFixedCostMinor).toBe(0);
    expect(derived.baseline.cashMinor).toBe(0);
  });

  it("knows there is not enough to simulate", () => {
    expect(enoughToSimulate(derived)).toBe(false);
  });

  it("is enough once a single bill exists", () => {
    const one = baselineFrom({ documents: [], expenses: [spend({ date: "2026-08-01" })], today: TODAY, currency: "INR" });
    expect(enoughToSimulate(one)).toBe(true);
  });
});

describe("deleted and foreign rows", () => {
  it("leaves out tombstoned expenses and other currencies", () => {
    const derived = baselineFrom({
      documents: [bill({ id: "a", issueDate: "2026-08-05" })],
      expenses: [
        spend({ date: "2026-08-10" }),
        spend({ date: "2026-08-11", netMinor: 9900000, deletedAt: "2026-08-12T00:00:00Z" }),
        spend({ date: "2026-08-12", netMinor: 7700000, currency: "USD" })
      ],
      today: TODAY, currency: "INR", months: 3
    });
    expect(derived.baseline.monthlyVariableCostMinor).toBe(2000000);
  });
});

/* ------------------------------------------------------ keeping a question */

describe("saving a scenario", () => {
  const memory = (): StorageLike => {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  };
  let store: Store;
  beforeEach(() => { store = new Store(memory()); });

  it("keeps the changes rather than the answer, so it reruns against today's books", () => {
    const saved = store.saveScenario({ name: "Hire a driver", changes: [{ kind: "hire", monthlyCostMinor: 2500000 }] });
    expect(store.scenarios()).toHaveLength(1);
    expect(store.scenarios()[0].changes[0]).toEqual({ kind: "hire", monthlyCostMinor: 2500000 });
    expect(saved.version).toBe(1);
  });

  it("replaces the one with the same name instead of making a twin", () => {
    store.saveScenario({ name: "Hire a driver", changes: [{ kind: "hire", monthlyCostMinor: 2500000 }] });
    const again = store.saveScenario({ name: "hire a driver", changes: [{ kind: "hire", monthlyCostMinor: 3000000 }] });
    expect(store.scenarios()).toHaveLength(1);
    expect(again.version).toBe(2);
    expect((store.scenarios()[0].changes[0] as { monthlyCostMinor: number }).monthlyCostMinor).toBe(3000000);
  });

  it("holds the corrected figures when the owner overrode what the books suggested", () => {
    store.saveScenario({ name: "Hire", changes: [], baseline: shop });
    expect(store.scenarios()[0].baseline?.monthlyIncomeMinor).toBe(40000000);
  });

  it("deletes as a tombstone, so the deletion reaches the other devices", () => {
    const saved = store.saveScenario({ name: "Hire", changes: [] });
    store.apply({ scenarios: store.raw().scenarios.map((s) => ({ ...s, syncedAt: "2026-10-16T00:00:00Z" })) });
    store.deleteScenario(saved.id);
    expect(store.scenarios()).toHaveLength(0);
    expect(store.raw().scenarios[0].deletedAt).toBeTruthy();
  });

  it("travels to the server as its own kind of record", () => {
    store.saveScenario({ name: "Hire", changes: [{ kind: "hire", monthlyCostMinor: 2500000 }] });
    const wire = toWire(store.raw()).filter((r) => r.kind === "scenario");
    expect(wire).toHaveLength(1);
    expect(pendingRecords(store.raw()).some((r) => r.kind === "scenario")).toBe(true);
  });

  it("accepts one that came down from another device", () => {
    const next = applyIncoming(store.raw(), [{
      kind: "scenario", localId: "sc_1", version: 3, updatedAt: Date.parse("2026-10-16T00:00:00Z"),
      body: { id: "sc_1", name: "From the laptop", changes: [], createdAt: "", updatedAt: "2026-10-16T00:00:00Z" }
    }]);
    store.apply(next);
    expect(store.scenarios()[0].name).toBe("From the laptop");
  });

  it("is included in a backup and comes back from one", () => {
    store.saveScenario({ name: "Hire", changes: [{ kind: "hire", monthlyCostMinor: 2500000 }] });
    const backup = store.export();
    const fresh = new Store(memory());
    fresh.import(backup);
    expect(fresh.scenarios()[0].name).toBe("Hire");
  });
});

/* ------------------------------------------------- the ready-made questions */

describe("suggestions sized from the books", () => {
  it("rounds to a figure a person would say out loud", () => {
    expect(tidy(2978667)).toBe(3000000);
    expect(tidy(37500)).toBe(38000);
    expect(tidy(0)).toBe(0);
    expect(tidy(7)).toBe(7);
  });

  it("names the customer the books say is the biggest", () => {
    const presets = presetsFor(shop, { name: "Mehta & Co", monthlyMinor: 12000000, sharePercent: 30 });
    const losing = presets.find((p) => p.name === "Lose Mehta & Co");
    expect(losing).toBeTruthy();
    expect(losing!.changes[0]).toEqual({ kind: "lose-customer", monthlyIncomeMinor: 12000000, label: "30% of your sales" });
  });

  it("falls back to a share of sales when there is no customer to name", () => {
    expect(presetsFor(shop)[1].name).toBe("Lose your biggest customer");
  });

  it("suggests a salary the business could be weighing", () => {
    // 40% of ₹1,00,000 of standing costs, against 15% of ₹4,00,000 of sales: the larger wins.
    expect((presetsFor(shop)[0].changes[0] as { monthlyCostMinor: number }).monthlyCostMinor).toBe(6000000);
  });

  it("works out the biggest customer from the books", () => {
    const derived = baselineFrom({
      documents: [
        bill({ id: "a", issueDate: "2026-08-05", clientName: "Globex" }),
        bill({ id: "b", issueDate: "2026-09-05", clientName: "Globex" }),
        bill({ id: "c", issueDate: "2026-09-06", clientName: "Initech" })
      ],
      expenses: [], today: TODAY, currency: "INR", months: 3
    });
    expect(derived.biggestCustomer).toEqual({ name: "Globex", monthlyMinor: Math.round(20000000 / 3), sharePercent: 67 });
  });

  it("leaves the biggest customer out when there are no sales to rank", () => {
    expect(baselineFrom({ documents: [], expenses: [], today: TODAY, currency: "INR" }).biggestCustomer).toBeUndefined();
  });
});

describe("changes that cannot bite", () => {
  const services: Baseline = { currency: "INR", monthlyIncomeMinor: 12500000, monthlyVariableCostMinor: 0, monthlyFixedCostMinor: 7446667, cashMinor: 44258800 };

  it("says why a supplier increase changed nothing, rather than reporting no change", () => {
    const sim = simulate(services, { name: "Suppliers up", changes: [{ kind: "cost-change", percent: 120 }] });
    expect(sim.delta.monthlyProfitMinor).toBe(0);
    expect(sim.unanswered.join(" ")).toContain("none of your costs are recorded as moving with sales");
  });

  it("says why a price rise changed nothing when no sales are recorded", () => {
    const sim = simulate({ ...services, monthlyIncomeMinor: 0 }, { name: "Up 10", changes: [{ kind: "price-change", percent: 10 }] });
    expect(sim.unanswered.join(" ")).toContain("no sales in the figures above");
  });

  it("does not offer a supplier question to a business with no such costs", () => {
    expect(presetsFor(services).map((p) => p.name)).not.toContain("Suppliers raise prices 15%");
    expect(presetsFor(shop).map((p) => p.name)).toContain("Suppliers raise prices 15%");
  });

  it("offers only the hiring question to a business with nothing recorded", () => {
    const empty: Baseline = { currency: "INR", monthlyIncomeMinor: 0, monthlyVariableCostMinor: 0, monthlyFixedCostMinor: 0, cashMinor: 0 };
    expect(presetsFor(empty).map((p) => p.name)).toEqual(["Hire someone"]);
  });
});
