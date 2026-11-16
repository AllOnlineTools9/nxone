import { describe, expect, it } from "vitest";
import { ASSET_CLASSES, classById } from "@/lib/assets/rates";
import { ledgerFor } from "@/lib/ledger/posting";
import { HALF_RATE_DAYS, blockSchedule, booksSchedule, carryingValue, depreciationEntries, disposalOf, registerAt, type AssetInput } from "@/lib/assets/depreciate";

const money = (m: number) => `₹${(m / 100).toFixed(2)}`;

const laptop = (over: Partial<AssetInput> = {}): AssetInput => ({
  id: "a1", name: "MacBook Pro", classId: "computers",
  purchasedOn: "2026-04-01", costMinor: 18_000_000, ...over
});

/* ------------------------------------------------------------------- the classes */

describe("the classes", () => {
  it("keeps a books life and a tax rate for each, because India wants both", () => {
    expect(ASSET_CLASSES.every((c) => c.usefulLifeYears > 0 && c.taxRate > 0)).toBe(true);
  });

  it("says where they came from and does not claim to be verified", () => {
    expect(ASSET_CLASSES.every((c) => c.status === "unverified" && c.source.length > 20)).toBe(true);
  });

  it("writes a computer off over three years in the books and at 40% for tax", () => {
    const computers = classById("computers")!;
    expect(computers.usefulLifeYears).toBe(3);
    expect(computers.taxRate).toBe(0.40);
  });
});

/* -------------------------------------------------------------------- the books */

describe("spreading a cost over the life of the thing", () => {
  it("takes a third of a laptop each year", () => {
    const years = booksSchedule(laptop(), "2029-04-30");
    expect(years.map((y) => y.depreciationMinor)).toEqual([6_000_000, 6_000_000, 6_000_000]);
    expect(years[2].closingMinor).toBe(0);
  });

  it("charges only part of a year when it was bought part way through one", () => {
    // Bought 1 January: three months of a twelve-month year.
    const years = booksSchedule(laptop({ purchasedOn: "2027-01-01" }), "2027-03-31");
    expect(years[0].partYear).toBe(true);
    expect(years[0].depreciationMinor).toBeGreaterThan(1_400_000);
    expect(years[0].depreciationMinor).toBeLessThan(1_550_000);
  });

  it("names the year the way an accountant writes it", () => {
    expect(booksSchedule(laptop(), "2027-01-01")[0].year).toBe("2026-27");
  });

  it("never writes a thing below what it will be worth at the end", () => {
    const van = laptop({ classId: "vehicles", costMinor: 80_000_000, salvageMinor: 8_000_000 });
    const years = booksSchedule(van, "2040-01-01");
    expect(years[years.length - 1].closingMinor).toBeGreaterThanOrEqual(8_000_000);
  });

  it("stops the year it is sold rather than carrying on without it", () => {
    const years = booksSchedule(laptop({ disposedOn: "2027-09-30" }), "2030-01-01");
    expect(years).toHaveLength(2);
    expect(years[1].partYear).toBe(true);
  });

  it("reports what it is worth on any given day", () => {
    expect(carryingValue(laptop(), "2027-03-31")).toBe(12_000_000);
    expect(carryingValue(laptop(), "2026-03-31")).toBe(18_000_000);
  });

  it("writes a vehicle down faster at the start, which is what written-down means", () => {
    const van = laptop({ classId: "vehicles", costMinor: 80_000_000 });
    const years = booksSchedule(van, "2032-01-01");
    expect(years[0].depreciationMinor).toBeGreaterThan(years[1].depreciationMinor);
    expect(years[1].depreciationMinor).toBeGreaterThan(years[2].depreciationMinor);
  });
});

/* --------------------------------------------------------- the tax computation */

describe("blocks of assets, written down at a rate", () => {
  it("gives a full year's rate to something bought early in the year", () => {
    const rows = blockSchedule([laptop({ purchasedOn: "2026-04-01" })], ["2026-27"]);
    expect(rows[0].additionsFullRateMinor).toBe(18_000_000);
    expect(rows[0].depreciationMinor).toBe(7_200_000);
  });

  it("gives half the rate to something bought late in the year, which is the rule people miss", () => {
    // Bought in February: fewer than 180 days before the year ends.
    const rows = blockSchedule([laptop({ purchasedOn: "2027-02-01" })], ["2026-27"]);
    expect(rows[0].additionsHalfRateMinor).toBe(18_000_000);
    expect(rows[0].depreciationMinor).toBe(3_600_000);
  });

  it("puts the dividing line at 180 days", () => {
    expect(HALF_RATE_DAYS).toBe(180);
    const justOver = blockSchedule([laptop({ purchasedOn: "2026-10-03" })], ["2026-27"]);
    const justUnder = blockSchedule([laptop({ purchasedOn: "2026-10-04" })], ["2026-27"]);
    expect(justOver[0].additionsFullRateMinor).toBe(18_000_000);
    expect(justUnder[0].additionsHalfRateMinor).toBe(18_000_000);
  });

  it("carries the closing balance into the next year", () => {
    const rows = blockSchedule([laptop()], ["2026-27", "2027-28"]);
    expect(rows[1].openingMinor).toBe(rows[0].closingMinor);
    expect(rows[1].depreciationMinor).toBe(Math.round(rows[0].closingMinor * 0.4));
  });

  it("takes a sale off the block instead of working out a gain", () => {
    const rows = blockSchedule(
      [laptop({ purchasedOn: "2026-04-01", disposedOn: "2027-06-01", disposalMinor: 5_000_000 })],
      ["2026-27", "2027-28"]
    );
    expect(rows[1].disposalsMinor).toBe(5_000_000);
    expect(rows[1].closingMinor).toBe(rows[1].openingMinor - 5_000_000 - rows[1].depreciationMinor);
  });

  it("never drives a block below nothing, however large the sale", () => {
    const rows = blockSchedule(
      [laptop({ disposedOn: "2027-06-01", disposalMinor: 99_000_000 })],
      ["2026-27", "2027-28"]
    );
    expect(rows[1].closingMinor).toBe(0);
    expect(rows[1].depreciationMinor).toBe(0);
  });

  it("pools two assets of the same kind into one block", () => {
    const rows = blockSchedule(
      [laptop(), laptop({ id: "a2", name: "Dell", costMinor: 6_000_000 })],
      ["2026-27"]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].depreciationMinor).toBe(Math.round(24_000_000 * 0.4));
  });

  it("keeps different kinds in different blocks, at their own rates", () => {
    const rows = blockSchedule([laptop(), laptop({ id: "a2", classId: "furniture", costMinor: 10_000_000 })], ["2026-27"]);
    expect(rows.map((r) => r.rate).sort()).toEqual([0.10, 0.40]);
  });
});

/* ------------------------------------------------------------------- selling one */

describe("selling something", () => {
  it("calls the difference a gain, and says the tax answer is not the same", () => {
    const sold = disposalOf(laptop({ disposedOn: "2027-03-31", disposalMinor: 15_000_000 }), money)!;
    expect(sold.carryingMinor).toBe(12_000_000);
    expect(sold.resultMinor).toBe(3_000_000);
    expect(sold.describes).toContain("gain in your profit and loss");
    expect(sold.describes).toContain("comes off the block");
  });

  it("calls it a loss the other way round", () => {
    const sold = disposalOf(laptop({ disposedOn: "2027-03-31", disposalMinor: 5_000_000 }), money)!;
    expect(sold.resultMinor).toBe(-7_000_000);
    expect(sold.describes).toContain("loss in your profit and loss");
  });

  it("says nothing about something still owned", () => {
    expect(disposalOf(laptop(), money)).toBeUndefined();
  });

  it("treats scrapping as a sale for nothing", () => {
    const scrapped = disposalOf(laptop({ disposedOn: "2027-03-31", disposalMinor: 0 }), money)!;
    expect(scrapped.resultMinor).toBe(-12_000_000);
  });
});

/* ---------------------------------------------------------------- into the books */

describe("what reaches the ledger", () => {
  it("books depreciation on the last day of each finished year", () => {
    const entries = depreciationEntries([laptop()], "2028-06-01");
    expect(entries.map((e) => e.date)).toEqual(["2027-03-31", "2028-03-31"]);
    expect(entries[0].amountMinor).toBe(6_000_000);
  });

  it("does not depreciate a year that has not finished", () => {
    expect(depreciationEntries([laptop()], "2027-01-15")).toHaveLength(0);
  });

  it("gives each entry a name somebody can recognise in a journal", () => {
    expect(depreciationEntries([laptop()], "2028-01-01")[0].narration).toBe("Depreciation on MacBook Pro for 2026-27");
  });

  it("lists what is owned, what it cost and what it is down to", () => {
    const register = registerAt([laptop(), laptop({ id: "a2", disposedOn: "2026-12-01" })], "2027-03-31");
    expect(register[0].costMinor).toBe(18_000_000);
    expect(register[0].carryingMinor).toBe(12_000_000);
    expect(register[0].depreciatedMinor).toBe(6_000_000);
    expect(register[1].gone).toBe(true);
  });
});

/* ------------------------------------------------------------ in the real ledger */

describe("what the books do with an asset", () => {
  const asset = { ...laptop(), paidFrom: "1020", currency: "INR" };
  const entries = (over = {}) => ledgerFor([], [], "INR", undefined, undefined, { list: [{ ...asset, ...over }], today: "2030-01-01" });

  it("puts the purchase on the balance sheet rather than through the profit and loss", () => {
    const bought = entries().find((e) => e.source.kind === "asset")!;
    expect(bought.lines.find((l) => l.account === "1700")?.debit).toBe(18_000_000);
    expect(bought.lines.find((l) => l.account === "1020")?.credit).toBe(18_000_000);
  });

  it("does not post the purchase twice when it came in as a bill", () => {
    expect(entries({ expenseId: "e1" }).some((e) => e.source.kind === "asset")).toBe(false);
  });

  it("charges the wear to the profit and loss, year by year", () => {
    const wear = entries().filter((e) => e.source.kind === "depreciation");
    expect(wear).toHaveLength(3);
    expect(wear[0].lines.find((l) => l.account === "6500")?.debit).toBe(6_000_000);
    expect(wear[0].lines.find((l) => l.account === "1790")?.credit).toBe(6_000_000);
  });

  it("clears both the cost and the wear when it is sold, and books the difference", () => {
    const sold = entries({ disposedOn: "2027-03-31", disposalMinor: 15_000_000 })
      .find((e) => e.source.kind === "disposal")!;
    expect(sold.lines.find((l) => l.account === "1700")?.credit).toBe(18_000_000);
    expect(sold.lines.find((l) => l.account === "1790")?.debit).toBe(6_000_000);
    expect(sold.lines.find((l) => l.account === "1020")?.debit).toBe(15_000_000);
    expect(sold.lines.find((l) => l.account === "4800")?.credit).toBe(3_000_000);
  });

  it("books a loss when it went for less than it was worth", () => {
    const sold = entries({ disposedOn: "2027-03-31", disposalMinor: 5_000_000 })
      .find((e) => e.source.kind === "disposal")!;
    expect(sold.lines.find((l) => l.account === "6510")?.debit).toBe(7_000_000);
  });

  it("keeps every entry balanced, which is the only thing that must never fail", () => {
    for (const e of entries({ disposedOn: "2027-03-31", disposalMinor: 15_000_000 })) {
      const debits = e.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      const credits = e.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
      expect(debits).toBe(credits);
    }
  });

  it("changes nothing at all for a business that owns none", () => {
    expect(ledgerFor([], [], "INR")).toEqual(ledgerFor([], [], "INR", undefined, undefined, { list: [] }));
  });
});
