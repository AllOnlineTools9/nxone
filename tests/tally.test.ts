import { describe, expect, it } from "vitest";
import { tallyExport, tallyFiles, xml } from "@/lib/reports/tally";
import type { DocumentData } from "@/lib/documents/types";
import type { Expense, Profile, SavedDocument } from "@/lib/store/types";

const profile: Profile = {
  name: "Brightline Studio", country: "IN", currency: "INR", region: "KA",
  taxId: "29AAGCB7383J1Z4", address: "4th Cross, Indiranagar\nBengaluru 560038"
};
const period = { from: "2026-04-01", to: "2027-03-31", label: "FY 2026-27" };

const doc = (over: Partial<DocumentData> = {}): DocumentData => ({
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-10", number: "INV-001",
  seller: { name: "Brightline Studio", region: "KA", taxId: "29AAGCB7383J1Z4" },
  buyer: { name: "Globex Private Limited", region: "MH", taxId: "27AAPFU0939F1ZV", address: "12 Nariman Point\nMumbai 400021" },
  placeOfSupply: "MH",
  items: [{ id: "l1", description: "Design", quantity: 1, rate: 100000, code: "998311", taxRuleId: "in-igst-18" }],
  taxInclusive: false, ...over
} as DocumentData);

const saved = (d = doc(), over: Partial<SavedDocument> = {}): SavedDocument => ({
  id: over.id ?? "d1", kind: d.kind as SavedDocument["kind"], number: d.number, clientName: d.buyer.name,
  issueDate: d.issueDate, currency: d.currency, totalMinor: 0, paidMinor: 0, status: "sent",
  doc: d, createdAt: "", updatedAt: "2026-09-10T00:00:00Z", ...over
});

const bill = (over: Partial<Expense> = {}): Expense => ({
  id: "e1", date: "2026-09-12", supplier: "Acme Paper", category: "6100", currency: "INR",
  netMinor: 1_000_00, taxMinor: 180_00, supplierGstin: "29AAACA1234A1Z5", createdAt: "", updatedAt: "", ...over
} as Expense);

/** Pulls each voucher's entries back out of the XML, to check they balance as Tally will. */
const vouchersIn = (text: string) =>
  [...text.matchAll(/<VOUCHER [^>]*VCHTYPE="([^"]+)"[\s\S]*?<\/VOUCHER>/g)].map((m) => ({
    type: m[1],
    entries: [...m[0].matchAll(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<LEDGERNAME>([^<]+)<\/LEDGERNAME>[\s\S]*?<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)]
      .map((e) => ({ ledger: e[1], debit: e[2] === "Yes", amount: Number(e[3]) }))
  }));

describe("sales into Tally", () => {
  const out = tallyExport({ profile, period, documents: [saved()], expenses: [] });
  const [sale] = vouchersIn(out.vouchers);

  it("debits the customer and credits sales and IGST between states", () => {
    expect(sale.type).toBe("Sales");
    expect(sale.entries).toEqual([
      { ledger: "Globex Private Limited", debit: true, amount: -118000 },
      { ledger: "Sales", debit: false, amount: 100000 },
      { ledger: "Output IGST", debit: false, amount: 18000 }
    ]);
  });

  it("keeps the invoice bill-wise, so a receipt can be matched to it", () => {
    expect(out.vouchers).toContain("<BILLTYPE>New Ref</BILLTYPE>");
    expect(out.vouchers).toContain("<NAME>INV-001</NAME>");
  });

  it("creates the customer with GSTIN and state, and the tax ledgers with their duty head", () => {
    expect(out.masters).toContain('<LEDGER NAME="Globex Private Limited" ACTION="Create">');
    expect(out.masters).toContain("<PARENT>Sundry Debtors</PARENT>");
    expect(out.masters).toContain("<PARTYGSTIN>27AAPFU0939F1ZV</PARTYGSTIN>");
    expect(out.masters).toContain("<LEDSTATENAME>Maharashtra</LEDSTATENAME>");
    expect(out.masters).toContain("<PINCODE>400021</PINCODE>");
    expect(out.masters).toContain("<GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>");
  });

  it("splits CGST and SGST inside the state", () => {
    const local = tallyExport({ profile, period, expenses: [], documents: [saved(doc({
      buyer: { name: "Local Co", region: "KA" }, placeOfSupply: "KA",
      items: [{ id: "l1", description: "Design", quantity: 1, rate: 100000, code: "998311", taxRuleId: "in-gst-18" }]
    }))] });
    const [v] = vouchersIn(local.vouchers);
    expect(v.entries.map((e) => e.ledger)).toEqual(["Local Co", "Sales", "Output CGST", "Output SGST"]);
    expect(v.entries[2].amount + v.entries[3].amount).toBe(18000);
    expect(local.masters).toContain("<GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE>");
  });

  it("leaves out drafts, cancelled invoices, quotations and anything outside the period", () => {
    const none = tallyExport({ profile, period, expenses: [], documents: [
      saved(doc(), { id: "a", status: "draft" }),
      saved(doc({ number: "INV-002" }), { id: "b", status: "cancelled" }),
      saved(doc({ kind: "quote", number: "Q-1" }), { id: "c", kind: "quote" }),
      saved(doc({ number: "INV-003", issueDate: "2025-12-01" }), { id: "d", issueDate: "2025-12-01" })
    ] });
    expect(none.counts.sales).toBe(0);
  });
});

describe("money received", () => {
  it("is a receipt into the bank, against the invoice, on the day it arrived", () => {
    const out = tallyExport({ profile, period, expenses: [], documents: [saved(doc(), { status: "paid", paidMinor: 118000_00, paidOn: "2026-10-01" })] });
    const receipt = vouchersIn(out.vouchers).find((v) => v.type === "Receipt")!;
    expect(receipt.entries).toEqual([
      { ledger: "Bank", debit: true, amount: -118000 },
      { ledger: "Globex Private Limited", debit: false, amount: 118000 }
    ]);
    expect(out.vouchers).toContain("<DATE>20261001</DATE>");
    expect(out.vouchers).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
  });

  it("says so when the day the money arrived was not recorded", () => {
    const out = tallyExport({ profile, period, expenses: [], documents: [saved(doc(), { status: "paid", paidMinor: 118000_00 })] });
    expect(out.notes.join(" ")).toContain("was not recorded");
  });
});

describe("bills and payments", () => {
  it("records a bill from a supplier in the same state with CGST and SGST input", () => {
    const out = tallyExport({ profile, period, documents: [], expenses: [bill()] });
    const [purchase] = vouchersIn(out.vouchers);
    expect(purchase.type).toBe("Purchase");
    expect(purchase.entries).toEqual([
      { ledger: "Acme Paper", debit: false, amount: 1180 },
      { ledger: "Office supplies", debit: true, amount: -1000 },
      { ledger: "Input CGST", debit: true, amount: -90 },
      { ledger: "Input SGST", debit: true, amount: -90 }
    ]);
    expect(out.masters).toContain("<PARENT>Sundry Creditors</PARENT>");
    expect(out.masters).toContain("<PARENT>Indirect Expenses</PARENT>");
  });

  it("pays a paid bill from where it was paid, holding back TDS", () => {
    const out = tallyExport({ profile, period, documents: [], expenses: [bill({ paidFrom: "1010", tdsMinor: 20_00 })] });
    const payment = vouchersIn(out.vouchers).find((v) => v.type === "Payment")!;
    expect(payment.entries).toEqual([
      { ledger: "Acme Paper", debit: true, amount: -1180 },
      { ledger: "Cash", debit: false, amount: 1160 },
      { ledger: "TDS Payable", debit: false, amount: 20 }
    ]);
  });

  it("puts GST it cannot place in one ledger to split, and says so", () => {
    const out = tallyExport({ profile, period, documents: [], expenses: [bill({ supplierGstin: undefined })] });
    expect(out.vouchers).toContain("Input GST (to split)");
    expect(out.notes.join(" ")).toContain("no supplier GSTIN");
  });

  it("keeps a supplier apart from a customer of the same name", () => {
    const out = tallyExport({ profile, period, documents: [saved()], expenses: [bill({ supplier: "Globex Private Limited" })] });
    expect(out.masters).toContain('NAME="Globex Private Limited (supplier)"');
  });
});

describe("every voucher balances", () => {
  it("across a mixed period", () => {
    const out = tallyExport({
      profile, period,
      documents: [
        saved(),
        saved(doc({ number: "INV-002", items: [{ id: "l", description: "Odd", quantity: 3, rate: 333.33, code: "998311", taxRuleId: "in-igst-18" }] }), { id: "d2", status: "paid", paidMinor: 1_18000, paidOn: "2026-09-20" }),
        saved(doc({ kind: "credit-note", number: "CN-1" }), { id: "d3", kind: "credit-note" })
      ],
      expenses: [bill(), bill({ id: "e2", paidFrom: "1020", supplierGstin: "27AAACA1234A1Z5" })]
    });
    const all = vouchersIn(out.vouchers);
    expect(all.length).toBe(out.counts.sales + out.counts.creditNotes + out.counts.receipts + out.counts.purchases + out.counts.payments);
    for (const v of all) {
      expect(Math.round(v.entries.reduce((s, e) => s + e.amount, 0) * 100)).toBe(0);
    }
    expect(out.counts.creditNotes).toBe(1);
  });
});

describe("the folder", () => {
  it("escapes names Tally would choke on", () => {
    expect(xml(`Smith & Sons <"Ltd">`)).toBe("Smith &amp; Sons &lt;&quot;Ltd&quot;&gt;");
  });

  it("holds ledgers, vouchers and how to import them, in order", () => {
    const input = { profile, period, documents: [saved()], expenses: [] };
    const files = tallyFiles(tallyExport(input), input);
    expect(files.map((f) => f.name.split("/")[1])).toEqual(["1-ledgers.xml", "2-vouchers.xml", "read-me.txt"]);
    expect(files[2].text).toContain("Import > Masters");
    expect(files[0].text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
});
