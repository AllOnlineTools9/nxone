import { describe, expect, it } from "vitest";
import {
  COMPOSITION_DECLARATION, COMPOSITION_EXCLUSIONS, COMPOSITION_RATES, LIMITS,
  cmp08, compositionQuarter, compositionRate, documentTitleFor, outgrown
} from "@/lib/returns/composition";

const sale = (issueDate: string, totalMinor: number, over = {}) =>
  ({ issueDate, totalMinor, status: "sent", kind: "invoice", ...over });

describe("the scheme's rates", () => {
  it("says where they came from and does not claim to be verified", () => {
    expect(COMPOSITION_RATES.every((r) => r.status === "unverified" && r.source.length > 20)).toBe(true);
  });

  it("charges a trader one per cent and a restaurant five", () => {
    expect(compositionRate("trader").rate).toBe(0.01);
    expect(compositionRate("restaurant").rate).toBe(0.05);
    expect(compositionRate("services").rate).toBe(0.06);
  });

  it("splits every rate evenly between centre and state", () => {
    for (const r of COMPOSITION_RATES) expect(r.split.cgst + r.split.sgst).toBeCloseTo(r.rate, 10);
  });

  it("falls back to the trader rate rather than to nothing", () => {
    expect(compositionRate(undefined).id).toBe("trader");
    expect(compositionRate("nonsense").id).toBe("trader");
  });
});

describe("what a composition dealer issues", () => {
  it("is a bill of supply, not a tax invoice", () => {
    expect(documentTitleFor("composition", "Tax Invoice")).toBe("Bill of Supply");
    expect(documentTitleFor("regular", "Tax Invoice")).toBe("Tax Invoice");
  });

  it("carries the declaration the law requires", () => {
    expect(COMPOSITION_DECLARATION).toContain("not eligible to collect tax");
  });
});

describe("the quarterly return", () => {
  const base = { from: "2026-07-01", to: "2026-09-30", quarter: "Q2 2026-27" };

  it("taxes turnover rather than each sale", () => {
    const out = cmp08({ ...base, documents: [sale("2026-08-01", 50_000_000), sale("2026-09-01", 50_000_000)] });
    expect(out.turnoverMinor).toBe(100_000_000);
    expect(out.cgstMinor).toBe(500_000);
    expect(out.sgstMinor).toBe(500_000);
    expect(out.totalMinor).toBe(1_000_000);
  });

  it("charges a restaurant its own rate", () => {
    const out = cmp08({ ...base, rateId: "restaurant", documents: [sale("2026-08-01", 100_000_000)] });
    expect(out.totalMinor).toBe(5_000_000);
  });

  it("leaves out drafts, cancellations and anything outside the quarter", () => {
    const out = cmp08({ ...base, documents: [
      sale("2026-08-01", 50_000_000),
      sale("2026-08-02", 90_000_000, { status: "draft" }),
      sale("2026-08-03", 90_000_000, { status: "cancelled" }),
      sale("2026-10-02", 90_000_000),
      sale("2026-08-04", 90_000_000, { deletedAt: "2026-08-05" })
    ] });
    expect(out.turnoverMinor).toBe(50_000_000);
  });

  it("adds reverse charge on top, because the scheme does not exempt you from it", () => {
    const out = cmp08({ ...base, documents: [sale("2026-08-01", 100_000_000)], reverseChargeMinor: 180_000 });
    expect(out.totalMinor).toBe(1_000_000 + 180_000);
    expect(out.notes.join(" ")).toContain("does not exempt you");
  });

  it("says plainly that nothing is claimed against it", () => {
    const out = cmp08({ ...base, documents: [] });
    expect(out.notes.join(" ")).toContain("No credit is claimed");
  });
});

describe("the quarters", () => {
  it("runs July to September as Q2, due on the 18th of October", () => {
    const q = compositionQuarter("2026-08-15");
    expect(q.label).toBe("Q2 2026-27");
    expect(q.from).toBe("2026-07-01");
    expect(q.to).toBe("2026-09-30");
    expect(q.dueOn).toBe("2026-10-18");
  });

  it("puts January to March in the year that started the previous April", () => {
    const q = compositionQuarter("2027-02-10");
    expect(q.label).toBe("Q4 2026-27");
    expect(q.to).toBe("2027-03-31");
    expect(q.dueOn).toBe("2027-04-18");
  });
});

describe("outgrowing the scheme", () => {
  it("knows the limit for goods and for services", () => {
    expect(outgrown(0, "goods").limitMinor).toBe(LIMITS.goods);
    expect(outgrown(0, "services").limitMinor).toBe(LIMITS.services);
    expect(outgrown(0, "goods", true).limitMinor).toBe(LIMITS.goodsSpecialStates);
  });

  it("says nothing while there is plenty of room", () => {
    expect(outgrown(10_000_000_0, "goods").says).toBeUndefined();
  });

  it("gives warning before the limit, not after", () => {
    expect(outgrown(145_000_000_0, "goods").says).toContain("close to the limit");
    expect(outgrown(145_000_000_0, "goods").over).toBe(false);
  });

  it("is plain about what happens once it is passed", () => {
    const out = outgrown(160_000_000_0, "goods");
    expect(out.over).toBe(true);
    expect(out.says).toContain("regular registration");
  });
});

describe("what does not apply on this scheme", () => {
  it("names each thing and why, rather than leaving it to be discovered", () => {
    expect(COMPOSITION_EXCLUSIONS.length).toBeGreaterThanOrEqual(5);
    expect(COMPOSITION_EXCLUSIONS.every((e) => e.why.length > 20)).toBe(true);
    expect(COMPOSITION_EXCLUSIONS.map((e) => e.what).join(" ")).toContain("Input credit");
  });
});
