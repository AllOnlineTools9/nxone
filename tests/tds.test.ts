import { describe, expect, it } from "vitest";
import { TDS_SECTIONS, depositBy, financialYearOf, quarterOf, sectionById } from "@/lib/tds/sections";
import { deductionsFor, form26q, form26qCsv, reviewYear, type PaymentInput } from "@/lib/tds/deduct";

const pay = (over: Partial<PaymentInput> & { id: string; date: string; netMinor: number }): PaymentInput => ({
  supplier: "Ravi Builders", supplierPan: "AAAPR1234C", supplierType: "other", tdsSection: "194C", ...over
});

/* ------------------------------------------------------------------- the rules */

describe("the rules themselves", () => {
  it("says where each came from and does not claim to be verified", () => {
    expect(TDS_SECTIONS.every((s) => s.source.length > 10)).toBe(true);
    expect(TDS_SECTIONS.every((s) => s.status === "unverified")).toBe(true);
  });

  it("charges a contractor less when they are an individual", () => {
    const c = sectionById("194C")!;
    expect(c.rate.individual).toBe(0.01);
    expect(c.rate.other).toBe(0.02);
  });

  it("holds back a fifth when there is no PAN, whatever the section", () => {
    expect(TDS_SECTIONS.filter((s) => s.id !== "194Q").every((s) => s.noPanRate === 0.20)).toBe(true);
  });
});

describe("the calendar", () => {
  it("runs the year April to March and names it the way people write it", () => {
    expect(financialYearOf("2026-11-15").label).toBe("2026-27");
    expect(financialYearOf("2026-03-31").label).toBe("2025-26");
    expect(financialYearOf("2026-04-01").from).toBe("2026-04-01");
  });

  it("wants the money by the seventh of the next month, and gives March longer", () => {
    expect(depositBy("2026-11-20")).toBe("2026-12-07");
    expect(depositBy("2026-12-31")).toBe("2027-01-07");
    expect(depositBy("2027-03-04")).toBe("2027-04-30");
  });

  it("puts a deduction in the right quarter, with the right filing date", () => {
    expect(quarterOf("2026-09-14").label).toBe("Q2 2026-27");
    expect(quarterOf("2026-09-14").dueOn).toBe("2026-10-31");
    expect(quarterOf("2027-02-02").label).toBe("Q4 2026-27");
    expect(quarterOf("2027-02-02").dueOn).toBe("2027-05-31");
    expect(quarterOf("2026-11-01").to).toBe("2026-12-31");
  });
});

/* -------------------------------------------------------------- the thresholds */

describe("a contractor and the yearly limit", () => {
  it("deducts nothing while the payments stay small", () => {
    const out = deductionsFor([pay({ id: "1", date: "2026-04-10", netMinor: 2_000_000 })], "194C");
    expect(out[0].shouldBeMinor).toBe(0);
  });

  it("deducts on a single payment over thirty thousand, however small the year's total", () => {
    const out = deductionsFor([pay({ id: "1", date: "2026-04-10", netMinor: 3_500_000 })], "194C");
    expect(out[0].shouldBeMinor).toBe(70_000);
    expect(out[0].becauseOfAggregate).toBe(false);
  });

  it("catches the earlier payments too once the year's total crosses the line", () => {
    // Four payments of ₹28,000: each is under the single limit, but the fourth takes the year
    // past ₹1,00,000, and tax is then due on all of them.
    const payments = [1, 2, 3, 4].map((n) => pay({ id: String(n), date: `2026-0${n + 3}-10`, netMinor: 2_800_000 }));
    const out = deductionsFor(payments, "194C");
    expect(out.every((d) => d.shouldBeMinor === 56_000)).toBe(true);
    expect(out.filter((d) => d.becauseOfAggregate)).toHaveLength(4);
  });

  it("leaves the year alone when it never crosses either line", () => {
    const payments = [1, 2, 3].map((n) => pay({ id: String(n), date: `2026-0${n + 3}-10`, netMinor: 2_800_000 }));
    expect(deductionsFor(payments, "194C").every((d) => d.shouldBeMinor === 0)).toBe(true);
  });

  it("does not depend on the order the payments were entered in", () => {
    const a = [pay({ id: "1", date: "2026-04-10", netMinor: 6_000_000 }), pay({ id: "2", date: "2026-05-10", netMinor: 5_000_000 })];
    const total = (list: PaymentInput[]) => deductionsFor(list, "194C").reduce((s, d) => s + d.shouldBeMinor, 0);
    expect(total(a)).toBe(total([...a].reverse()));
  });
});

describe("rent, which is measured by the month", () => {
  it("deducts when one month's rent goes over the limit", () => {
    const out = deductionsFor([pay({ id: "r", date: "2026-05-01", netMinor: 6_000_000, tdsSection: "194I-building" })], "194I-building");
    expect(out[0].shouldBeMinor).toBe(600_000);
  });

  it("leaves a smaller rent alone even when the year adds up to a lot", () => {
    const months = [4, 5, 6, 7, 8, 9].map((m) => pay({ id: `r${m}`, date: `2026-0${m}-01`, netMinor: 4_000_000, tdsSection: "194I-building" }));
    expect(deductionsFor(months, "194I-building").every((d) => d.shouldBeMinor === 0)).toBe(true);
  });

  it("adds up two payments inside the same month", () => {
    const out = deductionsFor([
      pay({ id: "a", date: "2026-05-01", netMinor: 3_000_000, tdsSection: "194I-building" }),
      pay({ id: "b", date: "2026-05-20", netMinor: 3_000_000, tdsSection: "194I-building" })
    ], "194I-building");
    expect(out.every((d) => d.shouldBeMinor > 0)).toBe(true);
  });
});

describe("professional fees", () => {
  it("waits for the year to pass fifty thousand", () => {
    const under = deductionsFor([pay({ id: "1", date: "2026-06-01", netMinor: 4_000_000, tdsSection: "194J-professional" })], "194J-professional");
    expect(under[0].shouldBeMinor).toBe(0);

    const over = deductionsFor([
      pay({ id: "1", date: "2026-06-01", netMinor: 4_000_000, tdsSection: "194J-professional" }),
      pay({ id: "2", date: "2026-07-01", netMinor: 2_000_000, tdsSection: "194J-professional" })
    ], "194J-professional");
    expect(over.reduce((s, d) => s + d.shouldBeMinor, 0)).toBe(600_000);
  });
});

describe("a supplier with no PAN", () => {
  it("is deducted at a fifth instead of the usual rate", () => {
    const out = deductionsFor([pay({ id: "1", date: "2026-04-10", netMinor: 5_000_000, supplierPan: undefined })], "194C");
    expect(out[0].rate).toBe(0.20);
    expect(out[0].shouldBeMinor).toBe(1_000_000);
    expect(out[0].noPan).toBe(true);
  });

  it("is not penalised when nothing was due in the first place", () => {
    const out = deductionsFor([pay({ id: "1", date: "2026-04-10", netMinor: 1_000_000, supplierPan: undefined })], "194C");
    expect(out[0].shouldBeMinor).toBe(0);
    expect(out[0].noPan).toBe(false);
  });
});

/* ------------------------------------------------------------------ the review */

describe("the year in review", () => {
  const payments: PaymentInput[] = [
    pay({ id: "1", date: "2026-05-10", netMinor: 6_000_000, tdsMinor: 120_000 }),
    pay({ id: "2", date: "2026-06-10", netMinor: 5_000_000 }),
    pay({ id: "3", date: "2026-07-10", netMinor: 4_000_000, supplier: "Mehta & Co", tdsSection: "194J-professional", tdsMinor: 0 }),
    pay({ id: "4", date: "2025-05-10", netMinor: 9_000_000, tdsMinor: 0 })
  ];
  const review = reviewYear(payments, "2026-11-15");

  it("looks only at the year the date falls in", () => {
    expect(review.deductions.some((d) => d.paymentId === "4")).toBe(false);
  });

  it("names the payments where tax was due and not held back", () => {
    expect(review.missed.map((d) => d.paymentId)).toEqual(["2"]);
    expect(review.shortfallMinor).toBe(100_000);
  });

  it("totals what was due against what was taken", () => {
    expect(review.totalDueMinor).toBe(220_000);
    expect(review.totalDeductedMinor).toBe(120_000);
  });

  it("groups what is held by the day it has to reach the government, and flags the late ones", () => {
    expect(review.owed[0]).toEqual({ depositBy: "2026-06-07", minor: 120_000, late: true });
  });

  it("warns about a supplier who is close to a threshold, before the next bill", () => {
    const close = reviewYear([pay({ id: "x", date: "2026-05-10", netMinor: 9_000_000, tdsMinor: 0 })], "2026-11-15");
    expect(close.approaching[0]).toEqual({
      supplier: "Ravi Builders", sectionId: "194C",
      spentMinor: 9_000_000, thresholdMinor: 10_000_000, leftMinor: 1_000_000
    });
  });

  it("says nothing about a supplier nowhere near one", () => {
    expect(reviewYear([pay({ id: "x", date: "2026-05-10", netMinor: 1_000_000 })], "2026-11-15").approaching).toHaveLength(0);
  });

  it("ignores a payment with no section against it, rather than guessing", () => {
    expect(reviewYear([pay({ id: "x", date: "2026-05-10", netMinor: 9_000_000, tdsSection: undefined })], "2026-11-15").deductions).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------- the return */

describe("the quarterly return", () => {
  const payments = [
    pay({ id: "1", date: "2026-07-10", netMinor: 20_000_000, tdsMinor: 400_000 }),
    pay({ id: "2", date: "2026-08-10", netMinor: 10_000_000, tdsMinor: 200_000 }),
    pay({ id: "3", date: "2026-11-10", netMinor: 10_000_000, tdsMinor: 200_000 })
  ];
  const review = reviewYear(payments, "2026-11-15");
  const rows = form26q(review.deductions, "Q2 2026-27", new Map([["Ravi Builders", "AAAPR1234C"]]));

  it("covers one quarter at a time, as the return does", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0].deductedMinor).toBe(600_000);
  });

  it("gathers a supplier's payments into one row, which is what the return wants", () => {
    expect(rows[0].paidMinor).toBe(30_000_000);
    expect(rows[0].dates).toEqual(["2026-07-10", "2026-08-10"]);
  });

  it("carries the new payment code alongside the section everybody still says", () => {
    expect(rows[0].sectionId).toBe("194C");
    expect(rows[0].newCode).toBe("1023 / 1024");
  });

  it("says loudly when a PAN is missing rather than leaving the cell empty", () => {
    const noPan = form26q(review.deductions, "Q2 2026-27", new Map());
    expect(form26qCsv(noPan, "Q2 2026-27")).toContain("NOT PROVIDED");
  });

  it("exports with a total that adds up", () => {
    const csv = form26qCsv(rows, "Q2 2026-27").trim().split("\n");
    expect(csv[csv.length - 1]).toContain("6000.00");
  });
});
