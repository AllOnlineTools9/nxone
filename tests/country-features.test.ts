import { describe, expect, it } from "vitest";
import { FEATURES, blockedFor, countriesWith, countryLocked, featureForPath, hasFeature, type Feature } from "@/lib/countries/features";
import { PACKS } from "@/lib/countries/packs";

describe("country features", () => {
  it("gives India its GST, TDS and e-way bill screens", () => {
    for (const f of Object.keys(FEATURES) as Feature[]) expect(hasFeature("IN", f), f).toBe(true);
  });

  it("gives no other country India's screens", () => {
    for (const p of PACKS.filter((p) => p.code !== "IN")) {
      for (const f of Object.keys(FEATURES) as Feature[]) expect(hasFeature(p.code, f), `${p.code} ${f}`).toBe(false);
    }
  });

  it("hides nothing before a country is chosen", () => {
    expect(hasFeature(undefined, "gst-returns")).toBe(true);
    expect(blockedFor(undefined, "/gst-returns/")).toBeUndefined();
  });

  it("finds the feature behind a page, with or without the trailing slash", () => {
    expect(featureForPath("/gst-returns/")).toBe("gst-returns");
    expect(featureForPath("/e-way-bills")).toBe("e-way-bills");
    expect(featureForPath("/hsn-code-finder/")).toBe("hsn");
    expect(featureForPath("/invoice-generator/")).toBeUndefined();
    expect(featureForPath("/tdsx/")).toBeUndefined();
  });

  it("blocks India's pages for a US business and leaves shared pages alone", () => {
    expect(blockedFor("US", "/gst-returns/")).toBe("gst-returns");
    expect(blockedFor("US", "/payroll/")).toBe("payroll");
    expect(blockedFor("US", "/books/")).toBeUndefined();
    expect(blockedFor("IN", "/gst-returns/")).toBeUndefined();
  });

  it("names the countries a feature belongs to", () => {
    expect(countriesWith("e-way-bills")).toEqual(["India"]);
  });

  it("only routes to pages that exist", async () => {
    const { existsSync } = await import("node:fs");
    for (const def of Object.values(FEATURES)) {
      for (const r of def.routes) expect(existsSync(`app/(app)${r}/page.tsx`), r).toBe(true);
    }
  });
});

describe("fixing the country", () => {
  it("is free to change until the first document", () => {
    expect(countryLocked({ country: "IN" }, 0)).toBe(false);
    expect(countryLocked(undefined, 3)).toBe(false);
  });
  it("is fixed once there are documents", () => {
    expect(countryLocked({ country: "IN" }, 1)).toBe(true);
  });
});

describe("country names in sentences", () => {
  it("reads naturally", async () => {
    const { inSentence } = await import("@/lib/countries/features");
    expect(inSentence("United States")).toBe("the United States");
    expect(inSentence("India")).toBe("India");
    expect(inSentence("Other country")).toBe("another country");
  });
});
