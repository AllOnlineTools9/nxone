import { describe, expect, it } from "vitest";
import { DEFAULT_RCM_RATE, RCM_CATEGORIES, liabilitiesFor, possiblyReverseCharge, rcmById, rcmSummary } from "@/lib/returns/rcm";
import { ledgerFor } from "@/lib/ledger/posting";
import { gstr1 } from "@/lib/returns/gstr1";
import { gstr3b } from "@/lib/returns/gstr3b";
import type { Expense } from "@/lib/store/types";

const bill = (over: Partial<Expense> = {}): Expense => ({
  id: "e1", date: "2026-09-10", supplier: "Speedy Logistics", category: "6050", currency: "INR",
  netMinor: 1_000_000, taxMinor: 0, paidFrom: "1020", rcmCategory: "gta",
  createdAt: "", updatedAt: "", version: 1, ...over
} as Expense);

const asInput = (e: Expense) => ({
  id: e.id, date: e.date, supplier: e.supplier, netMinor: e.netMinor,
  rcmCategory: e.rcmCategory, rcmRate: e.rcmRate
});

/* ---------------------------------------------------------------- the categories */

describe("which supplies attract it", () => {
  it("says where each came from and does not claim to be verified", () => {
    expect(RCM_CATEGORIES.every((c) => c.status === "unverified" && c.source.length > 20)).toBe(true);
  });

  it("knows which ones give the credit back and which really cost money", () => {
    expect(rcmById("gta")?.creditable).toBe(true);
    expect(rcmById("vehicle-hire")?.creditable).toBe(false);
  });

  it("covers the ones a small business actually meets", () => {
    const ids = RCM_CATEGORIES.map((c) => c.id);
    for (const id of ["gta", "advocate", "director", "import-services"]) expect(ids).toContain(id);
  });
});

/* ------------------------------------------------------------------ the money */

describe("what a reverse charge bill means", () => {
  it("owes the tax the supplier did not charge", () => {
    const [l] = liabilitiesFor([asInput(bill())], "2026-09-01", "2026-09-30");
    expect(l.owedMinor).toBe(180_000);
    expect(l.taxableMinor).toBe(1_000_000);
  });

  it("costs nothing in the end when the credit can be claimed", () => {
    const [l] = liabilitiesFor([asInput(bill())], "2026-09-01", "2026-09-30");
    expect(l.claimableMinor).toBe(180_000);
    expect(l.netCostMinor).toBe(0);
  });

  it("really costs money when the credit is blocked", () => {
    const [l] = liabilitiesFor([asInput(bill({ rcmCategory: "vehicle-hire" }))], "2026-09-01", "2026-09-30");
    expect(l.claimableMinor).toBe(0);
    expect(l.netCostMinor).toBe(180_000);
  });

  it("uses eighteen per cent unless told otherwise", () => {
    expect(DEFAULT_RCM_RATE).toBe(0.18);
    const [l] = liabilitiesFor([asInput(bill({ rcmRate: 0.05 }))], "2026-09-01", "2026-09-30");
    expect(l.owedMinor).toBe(50_000);
  });

  it("ignores bills outside the period and bills with no category", () => {
    const list = [asInput(bill()), asInput(bill({ id: "e2", date: "2026-10-05" })), asInput(bill({ id: "e3", rcmCategory: undefined }))];
    expect(liabilitiesFor(list, "2026-09-01", "2026-09-30")).toHaveLength(1);
  });

  it("says plainly that it has to be paid in cash", () => {
    const summary = rcmSummary([asInput(bill())], "2026-09-01", "2026-09-30");
    expect(summary.notes.join(" ")).toContain("cannot be settled against the credit");
  });

  it("warns when some of it is not coming back", () => {
    const summary = rcmSummary([asInput(bill({ rcmCategory: "vehicle-hire" }))], "2026-09-01", "2026-09-30");
    expect(summary.notes.join(" ")).toContain("not claimable back");
    expect(summary.netCostMinor).toBe(180_000);
  });
});

/* ------------------------------------------------------------------ the books */

describe("what the books do with it", () => {
  const entries = (e: Expense) => ledgerFor([], [e], "INR");

  it("owes the government and claims the same back, both", () => {
    const [entry] = entries(bill());
    expect(entry.lines.find((l) => l.account === "2400")?.credit).toBe(180_000);
    expect(entry.lines.find((l) => l.account === "1400")?.debit).toBe(180_000);
  });

  it("charges it to the cost when the credit is blocked, rather than claiming it", () => {
    const [entry] = entries(bill({ rcmCategory: "vehicle-hire" }));
    expect(entry.lines.find((l) => l.account === "1400")).toBeUndefined();
    expect(entry.lines.filter((l) => l.account === "6050").reduce((s, l) => s + (l.debit ?? 0), 0)).toBe(1_180_000);
  });

  it("still balances", () => {
    for (const e of [bill(), bill({ rcmCategory: "vehicle-hire" })]) {
      for (const entry of entries(e)) {
        const debits = entry.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
        const credits = entry.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
        expect(debits).toBe(credits);
      }
    }
  });

  it("pays the supplier only what they billed, which had no tax on it", () => {
    const [entry] = entries(bill());
    expect(entry.lines.find((l) => l.account === "1020")?.credit).toBe(1_000_000);
  });

  it("leaves an ordinary bill exactly as it was", () => {
    const ordinary = bill({ rcmCategory: undefined, taxMinor: 180_000 });
    const [entry] = entries(ordinary);
    expect(entry.lines.find((l) => l.account === "2400")).toBeUndefined();
    expect(entry.lines.find((l) => l.account === "1020")?.credit).toBe(1_180_000);
  });
});

/* ------------------------------------------------------------------ the return */

describe("the 3B", () => {
  const sales = gstr1([], { name: "Brightline", country: "IN", currency: "INR", region: "KA", taxId: "29AAGCB7383J1Z4" } as never,
  { from: "2026-09-01", to: "2026-09-30", label: "September 2026" } as never);
  const summary = gstr3b(sales, [bill()], { from: "2026-09-01", to: "2026-09-30" });

  it("fills the box for supplies you owe the tax on", () => {
    expect(summary.inwardReverseCharge.taxableMinor).toBe(1_000_000);
    expect(summary.inwardReverseCharge.taxMinor).toBe(180_000);
    expect(summary.inwardReverseCharge.bills).toBe(1);
  });

  it("fills the matching credit box, because one without the other gets queried", () => {
    expect(summary.reverseChargeCredit.minor).toBe(180_000);
  });

  it("claims no credit for the kind that does not give it back", () => {
    const blocked = gstr3b(sales, [bill({ rcmCategory: "vehicle-hire" })], { from: "2026-09-01", to: "2026-09-30" });
    expect(blocked.inwardReverseCharge.taxMinor).toBe(180_000);
    expect(blocked.reverseChargeCredit.minor).toBe(0);
  });

  it("tells the filer it must be paid in cash", () => {
    expect(summary.notes.join(" ")).toContain("cash");
  });

  it("leaves both boxes empty for a business with none", () => {
    const none = gstr3b(sales, [bill({ rcmCategory: undefined })], { from: "2026-09-01", to: "2026-09-30" });
    expect(none.inwardReverseCharge.taxMinor).toBe(0);
    expect(none.reverseChargeCredit.minor).toBe(0);
  });
});

/* ------------------------------------------------------------- catching the missed */

describe("bills that look like they were missed", () => {
  const suspect = (over: Partial<Expense> = {}) => possiblyReverseCharge([
    { ...asInput(bill({ rcmCategory: undefined, ...over })), taxMinor: (over.taxMinor as number) ?? 0, description: over.description }
  ]);

  it("spots a transporter's bill with no GST on it", () => {
    const [found] = suspect();
    expect(found.suggests).toBe("gta");
    expect(found.says).toContain("you owe the tax yourself");
  });

  it("spots an advocate and a security agency too", () => {
    expect(suspect({ supplier: "Sharma & Associates, Advocates" })[0].suggests).toBe("advocate");
    expect(suspect({ supplier: "Sentinel Security Services" })[0].suggests).toBe("security");
  });

  it("says nothing when the supplier already charged GST", () => {
    expect(suspect({ taxMinor: 180_000 })).toHaveLength(0);
  });

  it("says nothing about a bill already marked", () => {
    expect(possiblyReverseCharge([{ ...asInput(bill()), taxMinor: 0 }])).toHaveLength(0);
  });

  it("does not guess at an ordinary supplier", () => {
    expect(suspect({ supplier: "Cloud Hosting Co" })).toHaveLength(0);
  });

  it("puts the costliest first, because that is the one to look at", () => {
    const found = possiblyReverseCharge([
      { ...asInput(bill({ rcmCategory: undefined, netMinor: 500_000 })), taxMinor: 0 },
      { ...asInput(bill({ id: "e2", rcmCategory: undefined, netMinor: 9_000_000 })), taxMinor: 0 }
    ]);
    expect(found[0].netMinor).toBe(9_000_000);
  });
});
