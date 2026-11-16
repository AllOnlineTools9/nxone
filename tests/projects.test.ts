import { describe, expect, it } from "vitest";
import { likelyProjects, resultsFor, summarise, type Project } from "@/lib/analysis/projects";
import type { Expense, SavedDocument } from "@/lib/store/types";

const money = (m: number) => `₹${(m / 100).toFixed(2)}`;

const project = (over: Partial<Project> = {}): Project => ({
  id: "pj1", name: "Shop rebrand", client: "Globex", status: "open", ...over
});

const invoice = (over: Partial<SavedDocument> = {}): SavedDocument => ({
  id: "d1", kind: "invoice", number: "INV-1", clientName: "Globex", issueDate: "2026-09-01",
  currency: "INR", totalMinor: 11_800_000, paidMinor: 11_800_000, status: "paid", projectId: "pj1",
  createdAt: "", updatedAt: "", version: 1,
  doc: {
    kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-01", number: "INV-1",
    seller: { name: "Brightline", region: "KA" }, buyer: { name: "Globex", region: "KA" },
    placeOfSupply: "KA", taxInclusive: false,
    items: [{ id: "l", description: "Work", quantity: 1, rate: 100000, taxRuleId: "in-gst-18" }]
  },
  ...over
} as SavedDocument);

const bill = (over: Partial<Expense> = {}): Expense => ({
  id: "e1", date: "2026-09-10", supplier: "Printer", category: "6080", currency: "INR",
  netMinor: 4_000_000, taxMinor: 720_000, projectId: "pj1",
  createdAt: "", updatedAt: "", version: 1, ...over
} as Expense);

describe("what a job made", () => {
  it("counts what was invoiced without the tax, which was never yours", () => {
    const [r] = resultsFor([project()], [invoice()], [], money);
    expect(r.revenueMinor).toBe(10_000_000);
  });

  it("counts costs net of tax too, since that comes back", () => {
    const [r] = resultsFor([project()], [invoice()], [bill()], money);
    expect(r.costMinor).toBe(4_000_000);
    expect(r.profitMinor).toBe(6_000_000);
    expect(r.marginPercent).toBe(60);
  });

  it("keeps what was collected separate from what was earned", () => {
    const [r] = resultsFor([project()], [invoice({ paidMinor: 0, status: "sent" })], [], money);
    expect(r.revenueMinor).toBe(10_000_000);
    expect(r.collectedMinor).toBe(0);
  });

  it("takes a credit note off what the job earned", () => {
    const results = resultsFor([project()], [
      invoice(),
      invoice({ id: "d2", kind: "credit-note", number: "CN-1", totalMinor: 2_360_000, paidMinor: 0,
        doc: { ...invoice().doc, kind: "credit-note", items: [{ id: "l", description: "Adjustment", quantity: 1, rate: 20000, taxRuleId: "in-gst-18" }] } })
    ], [], money);
    expect(results[0].revenueMinor).toBe(8_000_000);
  });

  it("ignores quotations, drafts and cancellations", () => {
    const results = resultsFor([project()], [
      invoice(),
      invoice({ id: "d2", kind: "quote", totalMinor: 99_000_000 }),
      invoice({ id: "d3", status: "draft", totalMinor: 99_000_000 }),
      invoice({ id: "d4", status: "cancelled", totalMinor: 99_000_000 })
    ], [], money);
    expect(results[0].revenueMinor).toBe(10_000_000);
    expect(results[0].invoices).toBe(1);
  });

  it("says so plainly when a job lost money", () => {
    const [r] = resultsFor([project()], [invoice()], [bill({ netMinor: 15_000_000 })], money);
    expect(r.profitMinor).toBe(-5_000_000);
    expect(r.says).toContain("cost ₹50000.00 more than it earned");
  });

  it("warns about a job that barely covers itself", () => {
    const [r] = resultsFor([project()], [invoice()], [bill({ netMinor: 9_500_000 })], money);
    expect(r.says).toContain("pays for itself and nothing else");
  });

  it("notices when a quoted price has not been fully invoiced", () => {
    const [r] = resultsFor([project({ quotedMinor: 15_000_000 })], [invoice()], [], money);
    expect(r.overQuoteMinor).toBe(-5_000_000);
    expect(r.says).toContain("has not been invoiced yet");
  });

  it("puts the worst job first, because that is the one to look at", () => {
    const results = resultsFor(
      [project(), project({ id: "pj2", name: "Website" })],
      [invoice(), invoice({ id: "d2", projectId: "pj2" })],
      [bill(), bill({ id: "e2", projectId: "pj2", netMinor: 20_000_000 })],
      money
    );
    expect(results[0].project.name).toBe("Website");
  });

  it("reports nothing rather than infinity for a job with no revenue", () => {
    const [r] = resultsFor([project()], [], [bill()], money);
    expect(r.marginPercent).toBe(0);
    expect(r.profitMinor).toBe(-4_000_000);
  });
});

describe("across all the jobs", () => {
  it("shows what is tagged to no job at all", () => {
    const out = summarise([project()], [invoice(), invoice({ id: "d2", projectId: undefined })],
      [bill(), bill({ id: "e2", projectId: undefined, netMinor: 3_000_000 })], money);
    expect(out.untaggedRevenueMinor).toBe(10_000_000);
    expect(out.untaggedCostMinor).toBe(3_000_000);
  });

  it("gathers the jobs that lost money", () => {
    const out = summarise([project()], [invoice()], [bill({ netMinor: 15_000_000 })], money);
    expect(out.losing).toHaveLength(1);
    expect(out.profitMinor).toBe(-5_000_000);
  });

  it("totals revenue, cost and profit across the jobs", () => {
    const out = summarise([project()], [invoice()], [bill()], money);
    expect(out.revenueMinor).toBe(10_000_000);
    expect(out.costMinor).toBe(4_000_000);
    expect(out.profitMinor).toBe(6_000_000);
  });
});

describe("offering a job to tag something to", () => {
  const projects = [project(), project({ id: "pj2", name: "Website", client: "Initech" }), project({ id: "pj3", name: "Old", status: "done" })];

  it("leaves out jobs that are finished", () => {
    expect(likelyProjects(projects).map((p) => p.id)).toEqual(["pj1", "pj2"]);
  });

  it("puts that client's own jobs first, without hiding the others", () => {
    const found = likelyProjects(projects, "Initech");
    expect(found[0].id).toBe("pj2");
    expect(found).toHaveLength(2);
  });

  it("offers everything open when no client is known yet", () => {
    expect(likelyProjects(projects, "")).toHaveLength(2);
  });
});
