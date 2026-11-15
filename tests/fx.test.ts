import { describe, expect, it } from "vitest";
import { booksView, convert, convertMinor, describeRate, knownRates, rateFor, unrated, usableRate } from "@/lib/fx";
import { balances } from "@/lib/ledger/journal";
import { ledgerFor, postInvoice, postPayment } from "@/lib/ledger/posting";
import { profitAndLoss } from "@/lib/ledger/statements";
import { aging } from "@/lib/analysis/receivables";
import { forecast } from "@/lib/analysis/cashflow";
import { gstr1, returnPeriod } from "@/lib/returns/gstr1";
import { checksFor } from "@/lib/returns/checks";
import type { DocumentData } from "@/lib/documents/types";
import type { Expense, Profile, SavedDocument } from "@/lib/store/types";

/* ------------------------------------------------------------- conversion */

describe("converting an amount", () => {
  it("multiplies by the rate", () => {
    // $1,000.00 at 83.20 is ₹83,200.00
    expect(convertMinor(100000, "USD", "INR", 83.2)).toBe(8320000);
  });

  it("leaves an amount in its own currency exactly alone", () => {
    expect(convertMinor(123456, "INR", "INR", 999)).toBe(123456);
    expect(convertMinor(123456, "inr", "INR", 999)).toBe(123456);
  });

  it("crosses currencies that do not share a number of decimals", () => {
    // ¥10,000 has no minor units at all; at 0.58 that is ₹5,800.00
    expect(convertMinor(10000, "JPY", "INR", 0.58)).toBe(580000);
    // ₹10,000.00 at 1.72 is ¥17,200, not ¥1,720,000
    expect(convertMinor(1000000, "INR", "JPY", 1.72)).toBe(17200);
  });

  it("keeps the currency it was converted into", () => {
    expect(convert({ minor: 100000, currency: "USD" }, "INR", 83.2)).toEqual({ minor: 8320000, currency: "INR" });
  });

  it("rounds to a whole minor unit rather than carrying a fraction", () => {
    expect(convertMinor(1, "USD", "INR", 83.2)).toBe(83);
    expect(Number.isInteger(convertMinor(999, "USD", "INR", 83.237))).toBe(true);
  });

  it("refuses a rate that cannot be one", () => {
    expect(usableRate(0)).toBe(false);
    expect(usableRate(-3)).toBe(false);
    expect(usableRate(Number.NaN)).toBe(false);
    expect(usableRate(Number.POSITIVE_INFINITY)).toBe(false);
    expect(usableRate(undefined)).toBe(false);
    expect(usableRate(83.2)).toBe(true);
  });
});

/* ---------------------------------------------------------------- fixtures */

const line = (rate: number) => ({ id: "l1", description: "Design work", quantity: 1, rate, taxRuleId: "none" });

const docData = (over: Partial<DocumentData> = {}): DocumentData => ({
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-10", number: "INV-001",
  seller: { name: "Brightline Studio", region: "KA", taxId: "29AAGCB7383J1Z4" },
  buyer: { name: "Globex", region: "KA" }, placeOfSupply: "KA",
  items: [line(100000)], taxInclusive: false, ...over
} as DocumentData);

const saved = (over: Partial<SavedDocument> & { doc?: DocumentData } = {}): SavedDocument => {
  const doc = over.doc ?? docData();
  return {
    id: over.id ?? Math.random().toString(36).slice(2), kind: doc.kind as SavedDocument["kind"],
    number: doc.number, clientName: doc.buyer.name, issueDate: doc.issueDate, dueDate: doc.issueDate,
    currency: doc.currency, totalMinor: 10000000, paidMinor: 0, status: "sent",
    doc, createdAt: "", updatedAt: "2026-09-10T00:00:00Z", ...over
  };
};

/** $1,000, billed from India, at 83.20 to the dollar. */
const dollarInvoice = (over: Partial<SavedDocument> = {}, docOver: Partial<DocumentData> = {}) =>
  saved({
    doc: docData({ number: "INV-USD", currency: "USD", items: [line(1000)], fxRate: 83.2, ...docOver }),
    currency: "USD", totalMinor: 100000, ...over
  });

/* ------------------------------------------------------------- which rate */

describe("choosing a rate", () => {
  const history = [dollarInvoice({ id: "old" }, { issueDate: "2026-07-01", fxRate: 80 })];

  it("uses the rate written on the document", () => {
    expect(rateFor("USD", "INR", history, 84.5)).toMatchObject({ rate: 84.5, source: "recorded" });
  });

  it("carries the last one forward when a document has none, and says that is what it did", () => {
    const carried = rateFor("USD", "INR", history);
    expect(carried).toMatchObject({ rate: 80, source: "carried", date: "2026-07-01" });
  });

  it("prefers the most recent of several", () => {
    const more = [...history, dollarInvoice({ id: "new" }, { issueDate: "2026-09-01", fxRate: 83.2 })];
    expect(rateFor("USD", "INR", more)?.rate).toBe(83.2);
  });

  it("needs no rate at all when the currencies match", () => {
    expect(rateFor("INR", "INR", [])).toEqual({ from: "INR", to: "INR", rate: 1, source: "same" });
  });

  it("offers nothing rather than guessing when there is nothing to go on", () => {
    expect(rateFor("EUR", "INR", history)).toBeUndefined();
  });

  it("ignores a rate on a deleted document", () => {
    const gone = [dollarInvoice({ id: "x", deletedAt: "2026-08-01T00:00:00Z" }, { fxRate: 99 })];
    expect(rateFor("USD", "INR", gone)).toBeUndefined();
  });

  it("collects the last rate for each currency", () => {
    const mixed = [
      dollarInvoice({ id: "a" }, { issueDate: "2026-06-01", fxRate: 80 }),
      dollarInvoice({ id: "b" }, { issueDate: "2026-08-01", fxRate: 83 }),
      saved({ id: "c", currency: "GBP", doc: docData({ number: "G1", currency: "GBP", issueDate: "2026-08-02", fxRate: 106 }) })
    ];
    const rates = knownRates(mixed, "INR");
    expect(rates.USD.rate).toBe(83);
    expect(rates.GBP.rate).toBe(106);
  });

  it("writes a rate the way somebody would check it against a bank statement", () => {
    expect(describeRate({ from: "USD", to: "INR", rate: 83.2, source: "recorded" })).toBe("1 USD = 83.20 INR");
    expect(describeRate({ from: "INR", to: "INR", rate: 1, source: "same" })).toBe("");
  });
});

/* -------------------------------------------------------------- the books */

describe("a foreign invoice in the accounts", () => {
  const doc = dollarInvoice();
  const posted = postInvoice(doc.doc, doc.id, { base: "INR", rate: 83.2 });

  it("is posted in the currency the books are kept in", () => {
    expect(posted.currency).toBe("INR");
    expect(posted.lines.find((l) => l.account === "1200")?.debit).toBe(8320000);
  });

  it("remembers what it was before, so the customer's own figure can still be shown", () => {
    expect(posted.original).toEqual({ currency: "USD", rate: 83.2, totalMinor: 100000 });
  });

  it("balances, which is the whole point of posting it rather than noting it", () => {
    const debits = posted.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
    const credits = posted.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
    expect(debits).toBe(credits);
  });

  it("still balances when the parts do not convert evenly", () => {
    const awkward = saved({
      doc: docData({ number: "INV-ODD", currency: "USD", items: [line(333.33)], taxRuleId: undefined } as Partial<DocumentData>),
      currency: "USD", totalMinor: 33333
    });
    const odd = postInvoice(awkward.doc, awkward.id, { base: "INR", rate: 83.237 });
    const debits = odd.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
    const credits = odd.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
    expect(debits).toBe(credits);
  });

  it("is left exactly as it was when the currencies match", () => {
    const home = saved();
    expect(postInvoice(home.doc, home.id, { base: "INR", rate: 1 }).original).toBeUndefined();
  });
});

describe("being paid at a different rate", () => {
  const gain = postPayment({
    id: "p1", date: "2026-10-10", amountMinor: 100000, currency: "USD", account: "1020",
    documentNumber: "INV-USD", fx: { base: "INR", rate: 85, invoiceRate: 83.2 }
  });

  it("takes the debt off at the rate it went on at", () => {
    expect(gain.lines.find((l) => l.account === "1200")?.credit).toBe(8320000);
  });

  it("puts in the bank what actually arrived", () => {
    expect(gain.lines.find((l) => l.account === "1020")?.debit).toBe(8500000);
  });

  it("records the difference as a gain rather than losing it", () => {
    expect(gain.lines.find((l) => l.account === "4300")?.credit).toBe(180000);
  });

  it("records a loss when the rate moved the other way", () => {
    const loss = postPayment({
      id: "p2", date: "2026-10-10", amountMinor: 100000, currency: "USD", account: "1020",
      documentNumber: "INV-USD", fx: { base: "INR", rate: 81, invoiceRate: 83.2 }
    });
    expect(loss.lines.find((l) => l.account === "6950")?.debit).toBe(220000);
    expect(loss.lines.find((l) => l.account === "4300")).toBeUndefined();
  });

  it("records neither when the rate did not move", () => {
    const flat = postPayment({
      id: "p3", date: "2026-10-10", amountMinor: 100000, currency: "USD", account: "1020",
      fx: { base: "INR", rate: 83.2, invoiceRate: 83.2 }
    });
    expect(flat.lines.find((l) => l.account === "4300")).toBeUndefined();
    expect(flat.lines.find((l) => l.account === "6950")).toBeUndefined();
  });
});

describe("the ledger as a whole", () => {
  it("no longer drops a foreign invoice on the floor", () => {
    const entries = ledgerFor([saved(), dollarInvoice()], [], "INR");
    expect(entries).toHaveLength(2);
    const income = profitAndLoss(entries, "INR", "2026-01-01", "2026-12-31").totalIncome.minor;
    expect(income).toBe(10000000 + 8320000);
  });

  it("leaves out only what it has no rate for, and nothing else", () => {
    const noRate = dollarInvoice({ id: "norate" }, { number: "INV-NORATE", fxRate: undefined });
    const entries = ledgerFor([saved(), noRate], [], "INR");
    expect(entries).toHaveLength(1);
  });

  it("carries a rate forward from an earlier invoice rather than dropping the later one", () => {
    const earlier = dollarInvoice({ id: "a" }, { issueDate: "2026-07-01", fxRate: 80 });
    const later = dollarInvoice({ id: "b" }, { number: "INV-USD-2", issueDate: "2026-09-01", fxRate: undefined });
    const entries = ledgerFor([earlier, later], [], "INR");
    expect(entries).toHaveLength(2);
    expect(entries[1].original?.rate).toBe(80);
  });

  it("books the gain when a dollar invoice was paid at a better rate", () => {
    const paid = dollarInvoice({ id: "paid", paidMinor: 100000, status: "paid", paymentFxRate: 85, updatedAt: "2026-10-10T00:00:00Z" });
    const entries = ledgerFor([paid], [], "INR");
    const gain = balances(entries, "INR", "2026-01-01", "2026-12-31").find((r) => r.code === "4300");
    expect(gain?.balance.minor).toBe(180000);
  });

  it("converts a bill in another currency at its own rate", () => {
    const bill = { id: "e1", date: "2026-09-05", supplier: "A host abroad", category: "6040", currency: "USD", netMinor: 10000, taxMinor: 0, paidFrom: "1020", fxRate: 83.2 };
    const entries = ledgerFor([], [bill], "INR");
    expect(entries[0].lines.find((l) => l.account === "6040")?.debit).toBe(832000);
    expect(entries[0].currency).toBe("INR");
  });

  it("leaves out a bill with no rate rather than counting it as rupees", () => {
    const bill = { id: "e2", date: "2026-09-05", supplier: "A host abroad", category: "6040", currency: "USD", netMinor: 10000, taxMinor: 0, paidFrom: "1020" };
    expect(ledgerFor([], [bill], "INR")).toHaveLength(0);
  });
});

/* ------------------------------------------------------- the money screens */

describe("the screens that add money up", () => {
  const docs = [saved(), dollarInvoice()];

  it("counts a foreign invoice among what you are owed", () => {
    const owed = aging(docs, "2026-09-20", "INR");
    expect(owed.total.minor).toBe(10000000 + 8320000);
  });

  it("counts it in the cash forecast too", () => {
    const f = forecast(docs, [], "2026-09-20", "INR", 90);
    expect(f.atRisk.minor + f.points[f.points.length - 1].balance.minor).toBeGreaterThan(10000000);
  });

  it("converts the figures without touching the document itself", () => {
    const view = booksView(docs, [], "INR");
    const converted = view.documents.find((d) => d.id === docs[1].id)!;
    expect(converted.totalMinor).toBe(8320000);
    expect(converted.currency).toBe("INR");
    expect(converted.convertedFrom).toEqual({ currency: "USD", rate: 83.2 });
    // the invoice still says what it said to the customer
    expect(converted.doc.currency).toBe("USD");
    expect(docs[1].totalMinor).toBe(100000);
  });

  it("uses the rate the money arrived at for what has been paid", () => {
    const paid = dollarInvoice({ id: "p", paidMinor: 50000, paymentFxRate: 85 });
    const converted = booksView([paid], [], "INR").documents[0];
    expect(converted.paidMinor).toBe(4250000);
    expect(converted.totalMinor).toBe(8320000);
  });
});

describe("what is missing", () => {
  const noRate = dollarInvoice({ id: "norate" }, { number: "INV-NORATE", fxRate: undefined });

  it("names the documents the books cannot take in, instead of silently leaving them out", () => {
    const missing = unrated([noRate], [], "INR");
    expect(missing.totalDocuments).toBe(1);
    expect(missing.currencies).toEqual(["USD"]);
    expect(missing.documents[0].number).toBe("INV-NORATE");
  });

  it("says nothing is missing once a rate exists anywhere in that currency", () => {
    const withHistory = [dollarInvoice({ id: "ok" }, { issueDate: "2026-01-01", fxRate: 80 }), noRate];
    expect(unrated(withHistory, [], "INR").totalDocuments).toBe(0);
  });

  it("counts bills as well as invoices", () => {
    const bill: Expense = { id: "e", date: "2026-09-01", supplier: "Abroad", category: "6040", currency: "EUR", netMinor: 5000, taxMinor: 0, createdAt: "", updatedAt: "" };
    expect(unrated([], [bill], "INR").currencies).toEqual(["EUR"]);
  });

  it("ignores drafts, which are not in the books anyway", () => {
    const draft = dollarInvoice({ id: "d", status: "draft" }, { fxRate: undefined });
    expect(unrated([draft], [], "INR").totalDocuments).toBe(0);
  });
});

/* -------------------------------------------------------------- the return */

describe("a foreign invoice on a GST return", () => {
  const profile: Profile = { name: "Brightline Studio", country: "IN", currency: "INR", region: "KA", taxId: "29AAGCB7383J1Z4" };
  const period = returnPeriod("2026-09-15");
  const exported = dollarInvoice({ id: "exp" }, {
    number: "EXP-001",
    export: { enabled: true, kind: "services", taxMode: "lut", buyerCountry: "US", lutNumber: "LUT/2026/11" }
  } as Partial<DocumentData>);

  it("is written in rupees, because a return is", () => {
    const r = gstr1([exported], profile, period);
    expect(r.exp).toHaveLength(1);
    expect(r.exp[0].valueMinor).toBe(8320000);
    expect(r.totals.taxableMinor).toBe(8320000);
  });

  it("is kept off the return when there is no rate, and said so rather than dropped", () => {
    const noRate = dollarInvoice({ id: "norate" }, {
      number: "EXP-002", fxRate: undefined,
      export: { enabled: true, kind: "services", taxMode: "lut", buyerCountry: "US" }
    } as Partial<DocumentData>);
    const r = gstr1([noRate], profile, period);
    expect(r.exp).toHaveLength(0);

    const findings = checksFor({ documents: [noRate], expenses: [], profile, period, return: r });
    const finding = findings.find((f) => f.id === "no-fx-rate");
    expect(finding?.severity).toBe("stop");
    expect(finding?.detail).toContain("USD");
  });
});
