import { describe, expect, it } from "vitest";
import { INSTALMENTS, NOT_REQUIRED_BELOW_MINOR, RATES, advanceTaxYear, elapsedOf, nextDue, rateFor, taxOnProfit } from "@/lib/tax/advance";

/* -------------------------------------------------------------------- the rates */

describe("the rates", () => {
  it("says where they came from and does not claim to be verified", () => {
    expect(RATES.every((r) => r.status === "unverified" && r.source.length > 20)).toBe(true);
  });

  it("taxes a firm at a flat thirty and a company less", () => {
    expect(rateFor("firm").flatRate).toBe(0.30);
    expect(rateFor("company").flatRate).toBe(0.25);
    expect(rateFor("company-concessional").flatRate).toBe(0.22);
  });

  it("taxes a person on slabs, starting at nothing", () => {
    expect(rateFor("individual").slabs?.[0].rate).toBe(0);
  });
});

describe("tax on a year's profit", () => {
  it("charges a firm thirty per cent plus cess", () => {
    const out = taxOnProfit(100_000_000, "firm");
    expect(out.taxMinor).toBe(30_000_000);
    expect(out.cessMinor).toBe(1_200_000);
    expect(out.totalMinor).toBe(31_200_000);
  });

  it("charges a person nothing on a profit inside the first slab", () => {
    expect(taxOnProfit(35_000_000, "individual").totalMinor).toBe(0);
  });

  it("works a person's tax up through the slabs rather than at one rate", () => {
    // ₹10,00,000: nothing on the first 4, 5% on the next 4, 10% on the last 2.
    const out = taxOnProfit(100_000_000, "individual");
    expect(out.taxMinor).toBe(4_000_000);
    expect(out.totalMinor).toBe(4_160_000);
  });

  it("adds surcharge only once the profit is large", () => {
    expect(taxOnProfit(200_000_000, "individual").surchargeMinor).toBe(0);
    expect(taxOnProfit(6_000_000_00, "individual").surchargeMinor).toBeGreaterThan(0);
  });

  it("charges nothing on a loss", () => {
    expect(taxOnProfit(-50_000_000, "firm").totalMinor).toBe(0);
  });

  it("reports the rate actually paid, which is not the headline one", () => {
    const out = taxOnProfit(100_000_000, "individual");
    expect(out.effectiveRate).toBeLessThan(0.10);
  });
});

/* ------------------------------------------------------------- the instalments */

describe("the four dates", () => {
  it("asks for 15, 45, 75 and all of it", () => {
    expect(INSTALMENTS.map((i) => i.cumulative)).toEqual([0.15, 0.45, 0.75, 1.00]);
  });

  it("falls due in June, September, December and March", () => {
    const year = advanceTaxYear({ profitSoFarMinor: 100_000_000, statedProfitMinor: 100_000_000, kind: "firm", today: "2026-11-16" });
    expect(year.instalments.map((i) => i.dueOn)).toEqual(["2026-06-15", "2026-09-15", "2026-12-15", "2027-03-15"]);
  });

  it("spreads the tax across them cumulatively", () => {
    const year = advanceTaxYear({ profitSoFarMinor: 0, statedProfitMinor: 100_000_000, kind: "firm", today: "2026-11-16" });
    expect(year.payableMinor).toBe(31_200_000);
    expect(year.instalments[0].shouldHavePaidMinor).toBe(4_680_000);
    expect(year.instalments[3].shouldHavePaidMinor).toBe(31_200_000);
  });

  it("says what each instalment alone asks for, not just the running total", () => {
    const year = advanceTaxYear({ profitSoFarMinor: 0, statedProfitMinor: 100_000_000, kind: "firm", today: "2026-11-16" });
    expect(year.instalments[1].thisInstalmentMinor).toBe(9_360_000);
  });
});

describe("what has been paid against it", () => {
  const year = (payments: Array<{ date: string; amountMinor: number }>) => advanceTaxYear({
    profitSoFarMinor: 0, statedProfitMinor: 100_000_000, kind: "firm", today: "2026-11-16", payments
  });

  it("counts a payment towards every instalment after it", () => {
    const out = year([{ date: "2026-06-10", amountMinor: 4_680_000 }]);
    expect(out.instalments[0].state).toBe("paid");
    expect(out.instalments[1].paidByMinor).toBe(4_680_000);
  });

  it("calls a missed date short, and charges interest on it", () => {
    const out = year([]);
    expect(out.instalments[0].state).toBe("short");
    expect(out.instalments[0].interestMinor).toBe(Math.round(4_680_000 * 0.03));
  });

  it("charges no interest on a date that has not arrived", () => {
    const out = year([]);
    expect(out.instalments[3].past).toBe(false);
    expect(out.instalments[3].interestMinor).toBe(0);
  });

  it("notices somebody who is ahead", () => {
    expect(year([{ date: "2026-05-01", amountMinor: 31_200_000 }]).instalments[0].state).toBe("ahead");
    expect(year([{ date: "2026-05-01", amountMinor: 31_200_000 }]).interestMinor).toBe(0);
  });

  it("points at the next one that still needs paying", () => {
    const out = year([{ date: "2026-06-10", amountMinor: 4_680_000 }]);
    expect(nextDue(out, "2026-11-16")?.dueOn).toBe("2026-12-15");
  });
});

/* ------------------------------------------------------------- the projection */

describe("estimating the year from a part of it", () => {
  it("projects the rest of the year at the rate so far", () => {
    // Half the year gone, ₹5,00,000 made: the year looks like ₹10,00,000.
    const out = advanceTaxYear({ profitSoFarMinor: 50_000_000, yearElapsed: 0.5, kind: "firm", today: "2026-09-30" });
    expect(out.estimatedProfitMinor).toBe(100_000_000);
  });

  it("says plainly that it is a projection and what it assumes", () => {
    const out = advanceTaxYear({ profitSoFarMinor: 50_000_000, yearElapsed: 0.5, kind: "firm", today: "2026-09-30" });
    expect(out.basis).toContain("projects the rest");
    expect(out.notes.join(" ")).toContain("fourth instalment is the one to get right");
  });

  it("prefers what the person says over what it worked out", () => {
    const out = advanceTaxYear({ profitSoFarMinor: 50_000_000, yearElapsed: 0.5, statedProfitMinor: 80_000_000, kind: "firm", today: "2026-09-30" });
    expect(out.estimatedProfitMinor).toBe(80_000_000);
    expect(out.basis).toContain("Your own estimate");
  });

  it("does not project wildly from a few days of data", () => {
    const out = advanceTaxYear({ profitSoFarMinor: 1_000_000, yearElapsed: 0.01, kind: "firm", today: "2026-04-05" });
    expect(out.estimatedProfitMinor).toBe(1_000_000);
    expect(out.basis).toContain("Too little of the year");
  });

  it("knows how much of the year has gone", () => {
    expect(elapsedOf("2026-04-01")).toBeCloseTo(0, 2);
    expect(elapsedOf("2026-09-30")).toBeCloseTo(0.5, 1);
    expect(elapsedOf("2027-03-31")).toBeCloseTo(1, 2);
  });
});

describe("when it does not apply", () => {
  it("says so below ten thousand of tax, rather than demanding instalments", () => {
    const out = advanceTaxYear({ profitSoFarMinor: 0, statedProfitMinor: 2_000_000, kind: "firm", today: "2026-11-16" });
    expect(out.payableMinor).toBeLessThan(NOT_REQUIRED_BELOW_MINOR);
    expect(out.required).toBe(false);
    expect(out.interestMinor).toBe(0);
    expect(out.notes.join(" ")).toContain("not required at all");
  });

  it("takes tax already deducted off what has to be paid in instalments", () => {
    const out = advanceTaxYear({
      profitSoFarMinor: 0, statedProfitMinor: 100_000_000, kind: "firm",
      today: "2026-11-16", tdsCreditMinor: 20_000_000
    });
    expect(out.payableMinor).toBe(11_200_000);
    expect(out.notes.join(" ")).toContain("counts towards the year");
  });

  it("never asks for a negative amount when the deductions exceed the tax", () => {
    const out = advanceTaxYear({
      profitSoFarMinor: 0, statedProfitMinor: 100_000_000, kind: "firm",
      today: "2026-11-16", tdsCreditMinor: 99_000_000
    });
    expect(out.payableMinor).toBe(0);
  });
});
