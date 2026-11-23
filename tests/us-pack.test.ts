import { describe, expect, it } from "vitest";
import { UNITED_STATES, packFor } from "@/lib/countries/packs";
import { ruleById, rulesOn } from "@/lib/countries/types";
import { taxYearOf, yearStartFor } from "@/lib/countries/year";
import { calendarFor } from "@/lib/compliance/calendar";
import { calculate, defaultTaxRuleId } from "@/lib/documents/totals";
import { hasRegionalRates, regionalRuleId, rulesToOffer, withRegionalRates } from "@/lib/documents/regional";
import type { DocumentData } from "@/lib/documents/types";
import { financialYear, quarterPeriod, reportFor } from "@/lib/store/reports";
import type { SavedDocument } from "@/lib/store/types";
import { registrationChoices } from "@/lib/setup/onboarding";

const usDoc = (over: Partial<DocumentData> = {}): DocumentData => ({
  kind: "invoice", country: "US", currency: "USD", issueDate: "2026-11-02", number: "INV-1",
  seller: { name: "Acme LLC", region: "TX" }, buyer: { name: "Globex" }, placeOfSupply: "",
  taxInclusive: false,
  items: [{ id: "a", description: "Widgets", quantity: 2, rate: 50, taxRuleId: "us-st-tx" }],
  ...over
} as DocumentData);

describe("the US pack", () => {
  it("is fully set up, with every state and DC", () => {
    expect(UNITED_STATES.support).toBe("supported");
    expect(UNITED_STATES.regions).toHaveLength(51);
    expect(new Set(UNITED_STATES.regions!.map((r) => r.code)).size).toBe(51);
  });

  it("has one state rate for every state on any date from 2025", () => {
    for (const date of ["2025-03-01", "2026-11-23", "2027-12-01"]) {
      const rules = rulesOn(UNITED_STATES, date);
      for (const st of UNITED_STATES.regions!) {
        const mine = rules.filter((r) => r.jurisdiction === `US-${st.code}`);
        expect(mine, `${st.code} on ${date}`).toHaveLength(1);
      }
    }
  });

  it("carries the 2026 state rates, with the statewide add-ons in California, Utah and Virginia", () => {
    const rate = (code: string) => ruleById(UNITED_STATES, `us-st-${code}`)!.rate;
    expect(rate("ca")).toBe(7.25);
    expect(rate("tx")).toBe(6.25);
    expect(rate("ny")).toBe(4);
    expect(rate("mn")).toBe(6.875);
    expect(rate("mo")).toBe(4.225);
    expect(rate("ut")).toBe(6.1);
    expect(rate("va")).toBe(5.3);
    for (const none of ["ak", "de", "mt", "nh", "or"]) expect(rate(none)).toBe(0);
  });

  it("moves DC from 6% to 7% on 1 October 2027", () => {
    const dc = (date: string) => rulesOn(UNITED_STATES, date).find((r) => r.jurisdiction === "US-DC")!.rate;
    expect(dc("2027-09-30")).toBe(6);
    expect(dc("2027-10-01")).toBe(7);
  });

  it("says where every rate came from", () => {
    expect(UNITED_STATES.taxRules.every((r) => r.source.length > 0)).toBe(true);
  });

  it("checks an EIN's shape", () => {
    const re = new RegExp(UNITED_STATES.taxIdPattern!);
    expect(re.test("12-3456789")).toBe(true);
    expect(re.test("123456789")).toBe(true);
    expect(re.test("12-345678")).toBe(false);
  });

  it("counts years from January", () => {
    expect(yearStartFor("US")).toBe(1);
    expect(yearStartFor("IN")).toBe(4);
  });
});

describe("tax that follows the customer's state", () => {
  it("starts a new line on the state's rate", () => {
    expect(defaultTaxRuleId("US", "2026-11-02", false, false, "CA")).toBe("us-st-ca");
    expect(defaultTaxRuleId("US", "2026-11-02")).toBe("us-custom");
    expect(defaultTaxRuleId("IN", "2026-11-02", false, false, "KA")).toBe(defaultTaxRuleId("IN", "2026-11-02"));
  });

  it("moves state-rate lines to the ship-to state and leaves deliberate choices alone", () => {
    const doc = usDoc({
      placeOfSupply: "NY",
      items: [
        { id: "a", description: "Widgets", quantity: 1, rate: 100, taxRuleId: "us-st-tx" },
        { id: "b", description: "Consulting", quantity: 1, rate: 100, taxRuleId: "us-none" },
        { id: "c", description: "Resale", quantity: 1, rate: 100, taxRuleId: "us-exempt" },
        { id: "d", description: "Local", quantity: 1, rate: 100, taxRuleId: "us-custom", taxRateOverride: 8.875 },
        { id: "e", description: "Blank", quantity: 1, rate: 100, taxRuleId: "us-custom" }
      ]
    });
    const moved = withRegionalRates(doc).items.map((i) => i.taxRuleId);
    expect(moved).toEqual(["us-st-ny", "us-none", "us-exempt", "us-custom", "us-st-ny"]);
  });

  it("uses the seller's state when no ship-to state is set", () => {
    expect(withRegionalRates(usDoc()).items[0].taxRuleId).toBe("us-st-tx");
  });

  it("charges the state rate, or the combined rate typed in", () => {
    expect(calculate(usDoc()).taxTotal.minor).toBe(625);
    const combined = usDoc({ items: [{ id: "a", description: "x", quantity: 1, rate: 100, taxRuleId: "us-custom", taxRateOverride: 8.25 }] });
    expect(calculate(combined).taxTotal.minor).toBe(825);
  });

  it("offers the country-wide choices and only the invoice state's rate", () => {
    const offered = rulesToOffer(UNITED_STATES, rulesOn(UNITED_STATES, "2026-11-02"), "WA").map((r) => r.id);
    expect(offered).toEqual(expect.arrayContaining(["us-custom", "us-none", "us-exempt", "us-st-wa"]));
    expect(offered).not.toContain("us-st-ca");
    expect(offered).toHaveLength(4);
  });

  it("leaves India's rules and Canada's provinces alone", () => {
    expect(hasRegionalRates(packFor("IN"))).toBe(false);
    expect(hasRegionalRates(packFor("CA"))).toBe(false);
    expect(regionalRuleId("IN", "2026-11-02", "in-gst-18", "KA")).toBe("in-gst-18");
  });
});

describe("US reports and years", () => {
  const saved = (doc: DocumentData): SavedDocument => {
    const t = calculate(doc);
    return { id: doc.number, kind: "invoice", number: doc.number, clientName: "Globex", issueDate: doc.issueDate, currency: "USD", totalMinor: t.total.minor, paidMinor: 0, status: "sent", doc, createdAt: "", updatedAt: "" } as SavedDocument;
  };

  it("adds up sales and tax by state", () => {
    const docs = [
      saved(usDoc({ number: "1", placeOfSupply: "NY", items: [{ id: "a", description: "x", quantity: 1, rate: 100, taxRuleId: "us-st-ny" }] })),
      saved(usDoc({ number: "2", placeOfSupply: "NY", items: [{ id: "a", description: "x", quantity: 1, rate: 200, taxRuleId: "us-st-ny" }] })),
      saved(usDoc({ number: "3", items: [{ id: "a", description: "x", quantity: 1, rate: 100, taxRuleId: "us-st-tx" }] }))
    ];
    const r = reportFor(docs, financialYear("2026-11-02", 1), "USD");
    expect(r.byRegion.map((x) => [x.region, x.count, x.sales.minor, x.tax.minor])).toEqual([
      ["NY", 2, 30000, 1200],
      ["TX", 1, 10000, 625]
    ]);
  });

  it("uses the calendar year and calendar quarters", () => {
    expect(financialYear("2026-11-02", 1)).toEqual({ from: "2026-01-01", to: "2026-12-31", label: "2026" });
    expect(financialYear("2026-11-02")).toMatchObject({ from: "2026-04-01", to: "2027-03-31" });
    expect(quarterPeriod("2026-11-02", 1)).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(taxYearOf("2026-02-10", 1)).toEqual({ from: "2026-01-01", to: "2026-12-31", label: "2026" });
    expect(taxYearOf("2026-02-10")).toEqual({ from: "2025-04-01", to: "2026-03-31", label: "2025-26" });
  });
});

describe("the US filing calendar", () => {
  const due = (registrations: Parameters<typeof calendarFor>[0]["registrations"], today: string) =>
    calendarFor({ country: "US", registrations, today, backDays: 0, aheadDays: 400 });

  it("asks about US obligations, not GST or TDS", () => {
    expect(registrationChoices("US").map((c) => c.value)).toEqual(["sales-tax", "income-tax", "contractors", "payroll"]);
  });

  it("puts estimated tax on its four uneven dates, moved off weekends", () => {
    const dates = due(["income-tax"], "2026-11-23").filter((d) => d.rule.id === "us-estimated-tax").map((d) => [d.dueDate, d.period]);
    expect(dates.slice(0, 4)).toEqual([
      ["2027-01-15", "September to December 2026"],
      ["2027-04-15", "January to March 2027"],
      ["2027-06-15", "April and May 2027"],
      ["2027-09-15", "June to August 2027"]
    ]);
    // 15 January 2028 is a Saturday, so it moves to Monday the 17th.
    const all = calendarFor({ country: "US", registrations: ["income-tax"], today: "2027-12-01", backDays: 0, aheadDays: 60 });
    expect(all.find((d) => d.rule.id === "us-estimated-tax")?.dueDate).toBe("2028-01-17");
  });

  it("files 1099-NECs by 31 January for the year before", () => {
    const d = due(["contractors"], "2026-11-23").find((x) => x.rule.id === "us-1099-nec")!;
    expect(d.dueDate).toBe("2027-02-01"); // 31 January 2027 is a Sunday
    expect(d.period).toBe("Payments in 2026");
  });

  it("files Form 941 a month after each calendar quarter", () => {
    const dates = due(["payroll"], "2026-11-23").filter((d) => d.rule.id === "us-941").map((d) => d.dueDate);
    expect(dates.slice(0, 2)).toEqual(["2027-02-01", "2027-04-30"]);
  });

  it("shows nothing a business has not said applies to it", () => {
    expect(due([], "2026-11-23")).toHaveLength(0);
  });
});
