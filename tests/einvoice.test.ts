import { describe, expect, it } from "vitest";
import { applicability, buildEInvoice, eligibility, thresholdOn } from "@/lib/einvoice/schema";
import { validateEInvoice, verdictOf } from "@/lib/einvoice/validate";
import type { DocumentData } from "@/lib/documents/types";
import type { Profile, SavedDocument } from "@/lib/store/types";

const SELLER_GSTIN = "29AAGCB7383J1Z4";
const BUYER_GSTIN = "27AAPFU0939F1ZV";

const profile: Profile = {
  name: "Brightline Studio", country: "IN", currency: "INR", region: "KA",
  taxId: SELLER_GSTIN, address: "4th Cross, Indiranagar\nBengaluru 560038", phone: "+91 98450 11111",
  email: "hello@brightline.example"
};

const docData = (over: Partial<DocumentData> = {}): DocumentData => ({
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-10", number: "INV-001",
  seller: { name: "Brightline Studio", region: "KA", taxId: SELLER_GSTIN, address: "4th Cross, Indiranagar\nBengaluru 560038" },
  buyer: { name: "Globex Private Limited", region: "MH", taxId: BUYER_GSTIN, address: "12 Nariman Point\nMumbai 400021" },
  placeOfSupply: "MH",
  items: [{ id: "l1", description: "Design work", quantity: 2, rate: 50000, code: "998311", taxRuleId: "in-igst-18" }],
  taxInclusive: false, ...over
} as DocumentData);

const saved = (over: Partial<SavedDocument> & { doc?: DocumentData } = {}): SavedDocument => {
  const doc = over.doc ?? docData();
  return {
    id: over.id ?? "d1", kind: doc.kind as SavedDocument["kind"], number: doc.number,
    clientName: doc.buyer.name, issueDate: doc.issueDate, dueDate: doc.issueDate,
    currency: doc.currency, totalMinor: 11800000, paidMinor: 0, status: "sent",
    doc, createdAt: "", updatedAt: "", ...over
  };
};

/* ------------------------------------------------------------ who must */

describe("who has to register invoices", () => {
  it("uses the threshold in force on the date", () => {
    // ₹100 crore in February 2021, ₹5 crore now, both in paise
    expect(thresholdOn("2021-02-01").turnoverMinor).toBe(100000000000);
    expect(thresholdOn("2026-09-01").turnoverMinor).toBe(5000000000);
  });

  it("says a business over the threshold must", () => {
    // ₹800 crore
    const verdict = applicability(800000000000, "2026-09-01");
    expect(verdict.required).toBe(true);
    expect(verdict.says).toContain("have to be registered");
  });

  it("says a smaller one need not, without telling it off", () => {
    const verdict = applicability(20000000, "2026-09-01");
    expect(verdict.required).toBe(false);
    expect(verdict.says).toContain("do not have to");
  });

  it("names the crore figure people actually talk in", () => {
    expect(applicability(0, "2026-09-01").says).toContain("₹5 crore");
  });
});

describe("which invoices go to the portal", () => {
  it("takes a sale to a registered customer", () => {
    expect(eligibility(saved())).toMatchObject({ eligible: true, supplyType: "B2B", docType: "INV" });
  });

  it("leaves out a counter sale, which is the first thing to get right", () => {
    const walkIn = saved({ doc: docData({ buyer: { name: "A customer", region: "KA" } }) });
    expect(eligibility(walkIn).eligible).toBe(false);
    expect(eligibility(walkIn).reason).toContain("B2C");
  });

  it("leaves out drafts and cancelled invoices", () => {
    expect(eligibility(saved({ status: "draft" })).eligible).toBe(false);
    expect(eligibility(saved({ status: "cancelled" })).eligible).toBe(false);
  });

  it("takes a credit note, which is registered like an invoice", () => {
    const note = saved({ kind: "credit-note", doc: docData({ kind: "credit-note", number: "CN-001" }) });
    expect(eligibility(note)).toMatchObject({ eligible: true, docType: "CRN" });
  });

  it("leaves out a quotation, which is not a supply", () => {
    expect(eligibility(saved({ kind: "quote", doc: docData({ kind: "quote" }) })).eligible).toBe(false);
  });

  it("marks an export by whether tax was paid on it", () => {
    const lut = saved({ doc: docData({ export: { enabled: true, kind: "services", taxMode: "lut", buyerCountry: "US" } } as Partial<DocumentData>) });
    expect(eligibility(lut).supplyType).toBe("EXPWOP");
    const paid = saved({ doc: docData({ export: { enabled: true, kind: "services", taxMode: "with-igst", buyerCountry: "US" } } as Partial<DocumentData>) });
    expect(eligibility(paid).supplyType).toBe("EXPWP");
  });

  it("leaves out an invoice from another country entirely", () => {
    expect(eligibility(saved({ doc: docData({ country: "GB" }) })).eligible).toBe(false);
  });
});

/* -------------------------------------------------------- the payload */

describe("building the payload", () => {
  const payload = buildEInvoice(saved(), profile)!;

  it("says which schema and what kind of supply", () => {
    expect(payload.Version).toBe("1.1");
    expect(payload.TranDtls).toMatchObject({ TaxSch: "GST", SupTyp: "B2B" });
    expect(payload.DocDtls).toMatchObject({ Typ: "INV", No: "INV-001", Dt: "10/09/2026" });
  });

  it("writes the date the way the portal wants it, not the way a computer does", () => {
    expect(payload.DocDtls.Dt).toBe("10/09/2026");
  });

  it("pulls the PIN code out of the address", () => {
    expect(payload.SellerDtls.Pin).toBe(560038);
    expect(payload.BuyerDtls.Pin).toBe(400021);
  });

  it("carries the state codes the portal checks against the GSTINs", () => {
    expect(payload.SellerDtls.Stcd).toBe("29");
    expect(payload.BuyerDtls.Stcd).toBe("27");
    expect(payload.BuyerDtls.Pos).toBe("27");
  });

  it("writes money in rupees, not paise", () => {
    expect(payload.ValDtls.AssVal).toBe(100000);
    expect(payload.ValDtls.IgstVal).toBe(18000);
    expect(payload.ValDtls.TotInvVal).toBe(118000);
  });

  it("puts the tax under one head, since the supply crosses a state line", () => {
    expect(payload.ValDtls.CgstVal).toBe(0);
    expect(payload.ItemList[0].IgstAmt).toBe(18000);
    expect(payload.ItemList[0].CgstAmt).toBe(0);
  });

  it("splits it in two when the supply stays in one state", () => {
    const home = buildEInvoice(saved({
      doc: docData({
        placeOfSupply: "KA",
        buyer: { name: "Local Ltd", region: "KA", taxId: SELLER_GSTIN, address: "MG Road\nBengaluru 560001" },
        items: [{ id: "l1", description: "Design work", quantity: 2, rate: 50000, code: "998311", taxRuleId: "in-gst-18" }]
      })
    }), profile)!;
    expect(home.ValDtls.IgstVal).toBe(0);
    expect(home.ValDtls.CgstVal).toBe(9000);
    expect(home.ValDtls.SgstVal).toBe(9000);
  });

  it("marks a service as a service, by its code", () => {
    expect(payload.ItemList[0].IsServc).toBe("Y");
    const goods = buildEInvoice(saved({ doc: docData({ items: [{ id: "l", description: "A widget", quantity: 1, rate: 100, code: "8471", taxRuleId: "in-igst-18" }] }) }), profile)!;
    expect(goods.ItemList[0].IsServc).toBe("N");
  });

  it("converts an invoice billed in another currency into rupees", () => {
    const dollars = saved({
      currency: "USD",
      doc: docData({ currency: "USD", fxRate: 83.2, items: [{ id: "l1", description: "Design work", quantity: 1, rate: 1000, code: "998311", taxRuleId: "in-igst-18" }] })
    });
    const built = buildEInvoice(dollars, profile)!;
    expect(built.ValDtls.AssVal).toBe(83200);
  });

  it("declines to build one with no exchange rate rather than sending dollars as rupees", () => {
    const dollars = saved({ currency: "USD", doc: docData({ currency: "USD", items: [{ id: "l1", description: "Work", quantity: 1, rate: 1000, code: "998311", taxRuleId: "in-igst-18" }] }) });
    expect(buildEInvoice(dollars, profile)).toBeUndefined();
  });

  it("carries the shipping details on an export", () => {
    const exported = saved({
      doc: docData({
        export: { enabled: true, kind: "goods", taxMode: "lut", buyerCountry: "US", shippingBillNumber: "7788", shippingBillDate: "2026-09-12", portCode: "INMAA1" }
      } as Partial<DocumentData>)
    });
    const built = buildEInvoice(exported, profile)!;
    expect(built.ExpDtls).toMatchObject({ ShipBNo: "7788", ShipBDt: "12/09/2026", Port: "INMAA1", CntCode: "US" });
  });

  it("builds nothing for an invoice that does not belong on the portal", () => {
    expect(buildEInvoice(saved({ status: "draft" }), profile)).toBeUndefined();
  });
});

/* -------------------------------------------------------- the checking */

describe("catching what the portal would refuse", () => {
  const clean = buildEInvoice(saved(), profile)!;

  it("passes an invoice with nothing wrong with it", () => {
    const problems = validateEInvoice(clean);
    expect(problems.filter((p) => p.severity === "stop")).toHaveLength(0);
    expect(verdictOf(problems).ready).toBe(true);
  });

  it("catches a document number the portal cannot take", () => {
    const problems = validateEInvoice({ ...clean, DocDtls: { ...clean.DocDtls, No: "INV#001/2026/SPECIAL" } });
    expect(problems.find((p) => p.field === "DocDtls.No")?.severity).toBe("stop");
  });

  it("catches a number that starts with a dash", () => {
    const problems = validateEInvoice({ ...clean, DocDtls: { ...clean.DocDtls, No: "-001" } });
    expect(problems.some((p) => p.field === "DocDtls.No")).toBe(true);
  });

  it("catches a missing address, which the portal insists on", () => {
    const problems = validateEInvoice({ ...clean, BuyerDtls: { ...clean.BuyerDtls, Addr1: "" } });
    expect(problems.find((p) => p.field === "BuyerDtls.Addr1")?.severity).toBe("stop");
  });

  it("catches a PIN code that is not six digits", () => {
    const problems = validateEInvoice({ ...clean, SellerDtls: { ...clean.SellerDtls, Pin: 56003 } });
    expect(problems.find((p) => p.field === "SellerDtls.Pin")?.severity).toBe("stop");
  });

  it("catches a state that disagrees with the GSTIN", () => {
    const problems = validateEInvoice({ ...clean, BuyerDtls: { ...clean.BuyerDtls, Stcd: "29" } });
    expect(problems.find((p) => p.field === "BuyerDtls.Stcd")?.says).toContain("does not match");
  });

  it("catches a line with no HSN code", () => {
    const problems = validateEInvoice({ ...clean, ItemList: [{ ...clean.ItemList[0], HsnCd: "" }] });
    expect(problems.find((p) => p.field.endsWith("HsnCd"))?.severity).toBe("stop");
  });

  it("catches a line that does not add up, within the rupee the portal allows", () => {
    const problems = validateEInvoice({ ...clean, ItemList: [{ ...clean.ItemList[0], AssAmt: 99000 }] });
    expect(problems.find((p) => p.field.endsWith("AssAmt"))?.severity).toBe("stop");
  });

  it("allows a rupee of rounding, because the portal does", () => {
    const problems = validateEInvoice({
      ...clean,
      ItemList: [{ ...clean.ItemList[0], AssAmt: clean.ItemList[0].AssAmt + 1, TotItemVal: clean.ItemList[0].TotItemVal + 1 }],
      ValDtls: { ...clean.ValDtls, AssVal: clean.ValDtls.AssVal + 1, TotInvVal: clean.ValDtls.TotInvVal + 1 }
    });
    expect(problems.filter((p) => p.severity === "stop")).toHaveLength(0);
  });

  it("catches a total that does not match its parts", () => {
    const problems = validateEInvoice({ ...clean, ValDtls: { ...clean.ValDtls, TotInvVal: 999999 } });
    expect(problems.find((p) => p.field === "ValDtls.TotInvVal")?.severity).toBe("stop");
  });

  it("catches both kinds of tax on one line", () => {
    const problems = validateEInvoice({ ...clean, ItemList: [{ ...clean.ItemList[0], CgstAmt: 100 }] });
    expect(problems.some((p) => p.says.includes("one or the other"))).toBe(true);
  });

  it("warns about a rate the portal does not list, without calling it an error", () => {
    const problems = validateEInvoice({ ...clean, ItemList: [{ ...clean.ItemList[0], GstRt: 17 }] });
    expect(problems.find((p) => p.field.endsWith("GstRt"))?.severity).toBe("check");
  });

  it("accepts the rates brought in by the 2025 change", () => {
    const problems = validateEInvoice({ ...clean, ItemList: [{ ...clean.ItemList[0], GstRt: 40 }] });
    expect(problems.some((p) => p.field.endsWith("GstRt"))).toBe(false);
  });

  it("catches tax on an export that was supposed to carry none", () => {
    const problems = validateEInvoice({ ...clean, TranDtls: { ...clean.TranDtls, SupTyp: "EXPWOP" } });
    expect(problems.find((p) => p.field === "ValDtls.IgstVal")?.severity).toBe("stop");
  });

  it("says in one line whether it would go through", () => {
    expect(verdictOf([]).says).toContain("Nothing here");
    expect(verdictOf([{ field: "x", severity: "stop", says: "" }]).says).toContain("1 thing the portal would refuse");
    expect(verdictOf([{ field: "x", severity: "check", says: "" }]).ready).toBe(true);
  });
});
