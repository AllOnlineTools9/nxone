import { describe, expect, it } from "vitest";
import { checkGstin, gstinCheckDigit, placeOfSupply, stateByCode, stateByRegion } from "@/lib/returns/states";
import { b2clThresholdOn, gstr1, missingInSeries, returnPeriod, uqcFor } from "@/lib/returns/gstr1";
import { gstr3b } from "@/lib/returns/gstr3b";
import { checksFor, verdictOf } from "@/lib/returns/checks";
import { gstr1Csvs, gstr1Json, gstr3bCsv } from "@/lib/returns/export";
import type { DocumentData } from "@/lib/documents/types";
import type { Expense, Profile, SavedDocument } from "@/lib/store/types";

/* ------------------------------------------------------------- the numbers */

describe("state codes", () => {
  it("knows the code a return writes for a state", () => {
    expect(placeOfSupply("MH")).toBe("27-Maharashtra");
    expect(placeOfSupply("KA")).toBe("29-Karnataka");
    expect(placeOfSupply("DL")).toBe("07-Delhi");
  });

  it("reads a code back", () => {
    expect(stateByCode("27")?.name).toBe("Maharashtra");
    expect(stateByCode("7")?.name).toBe("Delhi");
  });

  it("keeps codes that were retired, because old invoices still carry them", () => {
    expect(stateByCode("28")?.retired).toBe(true);
    expect(stateByRegion("DD")).toBeUndefined();
  });

  it("says nothing rather than guessing for a place it does not know", () => {
    expect(placeOfSupply("ZZ")).toBe("");
    expect(placeOfSupply(undefined)).toBe("");
  });
});

describe("a GSTIN", () => {
  it("works out the check digit the way the registration rules do", () => {
    // Two numbers published as examples, which the algorithm has to agree with.
    expect(gstinCheckDigit("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckDigit("24AAACC1206D1Z")).toBe("M");
  });

  it("accepts a real one", () => {
    const verdict = checkGstin("27AAPFU0939F1ZV");
    expect(verdict.valid).toBe(true);
    expect(verdict.state?.name).toBe("Maharashtra");
  });

  it("catches a mistyped character through the check digit", () => {
    const verdict = checkGstin("27AAPFU0939F1ZX");
    expect(verdict.valid).toBe(false);
    expect(verdict.problem).toBe("checksum");
  });

  it("catches the wrong length and the wrong shape", () => {
    expect(checkGstin("27AAPFU0939F1Z").problem).toBe("length");
    expect(checkGstin("2AAPFU0939F1ZVX").problem).toBe("shape");
  });

  it("catches a state code that does not exist", () => {
    expect(checkGstin("99AAPFU0939F1ZV").problem).toBe("state");
  });

  it("notices when the number is registered somewhere other than the customer's state", () => {
    const verdict = checkGstin("27AAPFU0939F1ZV", "KA");
    expect(verdict.valid).toBe(false);
    expect(verdict.says).toContain("Maharashtra");
    expect(verdict.says).toContain("Karnataka");
  });

  it("is happy when the state matches", () => {
    expect(checkGstin("27AAPFU0939F1ZV", "MH").valid).toBe(true);
  });
});

/* ---------------------------------------------------------------- fixtures */

const SELLER = { name: "Brightline Studio", region: "KA", taxId: "29AAGCB7383J1Z4" };

const line = (over: Partial<{ rate: number; code: string; quantity: number; unit: string; description: string; taxRuleId: string }> = {}) => ({
  id: Math.random().toString(36).slice(2, 8),
  description: over.description ?? "Design work",
  quantity: over.quantity ?? 1,
  rate: over.rate ?? 100000,
  code: over.code ?? "998311",
  unit: over.unit,
  taxRuleId: over.taxRuleId ?? "in-gst-18"
});

const docData = (over: Partial<DocumentData> = {}): DocumentData => ({
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-10", number: "INV-001",
  seller: SELLER, buyer: { name: "Globex Private Limited", region: "KA" },
  placeOfSupply: "KA", items: [line()], taxInclusive: false, ...over
} as DocumentData);

const saved = (over: Partial<SavedDocument> & { doc?: DocumentData } = {}): SavedDocument => {
  const doc = over.doc ?? docData();
  return {
    id: over.id ?? Math.random().toString(36).slice(2), kind: doc.kind as SavedDocument["kind"],
    number: doc.number, clientName: doc.buyer.name, issueDate: doc.issueDate,
    currency: "INR", totalMinor: 11800000, paidMinor: 0, status: "sent",
    doc, createdAt: "", updatedAt: "", ...over
  };
};

const profile: Profile = { name: "Brightline Studio", country: "IN", currency: "INR", region: "KA", taxId: "29AAGCB7383J1Z4" };
const SEPTEMBER = returnPeriod("2026-09-15");

/* --------------------------------------------------------------- the boxes */

describe("the period", () => {
  it("covers the whole month and writes it the way a return does", () => {
    expect(SEPTEMBER).toEqual({ from: "2026-09-01", to: "2026-09-30", fp: "092026", label: "September 2026" });
  });

  it("gets the length of February right", () => {
    expect(returnPeriod("2028-02-03").to).toBe("2028-02-29");
  });
});

describe("sorting sales into the return's boxes", () => {
  const registered = saved({ doc: docData({ number: "INV-001", buyer: { name: "Globex Private Limited", region: "KA", taxId: "29AAGCB7383J1Z4" } }) });
  const walkIn = saved({ doc: docData({ number: "INV-002", buyer: { name: "A customer", region: "KA" } }) });
  const farAway = saved({
    doc: docData({
      number: "INV-003", placeOfSupply: "MH",
      buyer: { name: "Someone in Mumbai", region: "MH" },
      items: [line({ rate: 400000, taxRuleId: "in-igst-18" })]
    })
  });

  const r = gstr1([registered, walkIn, farAway], profile, SEPTEMBER);

  it("puts a sale to a registered customer in B2B, invoice by invoice", () => {
    expect(r.b2b).toHaveLength(1);
    expect(r.b2b[0].ctin).toBe("29AAGCB7383J1Z4");
    expect(r.b2b[0].number).toBe("INV-001");
    expect(r.b2b[0].posName).toBe("29-Karnataka");
    expect(r.b2b[0].lines[0]).toMatchObject({ rate: 18, taxableMinor: 10000000, cgstMinor: 900000, sgstMinor: 900000, igstMinor: 0 });
  });

  it("summarises small sales to people without a GSTIN", () => {
    expect(r.b2cs).toHaveLength(1);
    expect(r.b2cs[0]).toMatchObject({ pos: "29", rate: 18, taxableMinor: 10000000, cgstMinor: 900000, sgstMinor: 900000 });
  });

  it("lists a large inter-state sale to an unregistered customer on its own", () => {
    expect(r.b2cl).toHaveLength(1);
    expect(r.b2cl[0].number).toBe("INV-003");
    expect(r.b2cl[0].posName).toBe("27-Maharashtra");
    expect(r.b2cl[0].lines[0].igstMinor).toBe(7200000);
  });

  it("splits the tax the way the law does: half and half at home, all IGST away", () => {
    expect(r.b2b[0].lines[0].igstMinor).toBe(0);
    expect(r.b2cl[0].lines[0].cgstMinor).toBe(0);
  });

  it("adds the whole month up", () => {
    expect(r.totals.documents).toBe(3);
    expect(r.totals.taxableMinor).toBe(10000000 + 10000000 + 40000000);
    expect(r.totals.taxMinor).toBe(1800000 + 1800000 + 7200000);
  });

  it("carries your own GSTIN and the period onto the return", () => {
    expect(r.gstin).toBe("29AAGCB7383J1Z4");
    expect(r.fp).toBe("092026");
  });
});

describe("the threshold that moved", () => {
  it("uses the figure in force on the date, not today's", () => {
    expect(b2clThresholdOn("2020-05-01").amountMinor).toBe(25000000);
    expect(b2clThresholdOn("2026-09-01").amountMinor).toBe(10000000);
  });

  it("marks the newer one as unverified, because we have not seen the notification ourselves", () => {
    expect(b2clThresholdOn("2026-09-01").status).toBe("unverified");
  });

  it("summarises a sale under the threshold rather than listing it", () => {
    const small = saved({
      doc: docData({ number: "INV-004", placeOfSupply: "MH", buyer: { name: "Someone", region: "MH" }, items: [line({ rate: 50000, taxRuleId: "in-igst-18" })] })
    });
    const r = gstr1([small], profile, SEPTEMBER);
    expect(r.b2cl).toHaveLength(0);
    expect(r.b2cs).toHaveLength(1);
  });
});

describe("what the return leaves out", () => {
  it("leaves out drafts entirely", () => {
    const r = gstr1([saved({ status: "draft" })], profile, SEPTEMBER);
    expect(r.totals.documents).toBe(0);
    expect(r.b2cs).toHaveLength(0);
  });

  it("leaves a cancelled invoice out of the figures but counts it as issued", () => {
    const r = gstr1([saved({ doc: docData({ number: "INV-001" }) }), saved({ doc: docData({ number: "INV-002" }), status: "cancelled" })], profile, SEPTEMBER);
    expect(r.totals.documents).toBe(1);
    expect(r.docs[0]).toMatchObject({ issued: 2, cancelled: 1, net: 1 });
  });

  it("leaves out quotations, purchase orders and receipts, which are not supplies", () => {
    const quote = saved({ kind: "quote", doc: docData({ kind: "quote", number: "QUO-1" }) });
    const receipt = saved({ kind: "receipt", doc: docData({ kind: "receipt", number: "REC-1" }) });
    expect(gstr1([quote, receipt], profile, SEPTEMBER).totals.documents).toBe(0);
  });

  it("leaves out another month", () => {
    expect(gstr1([saved({ doc: docData({ issueDate: "2026-08-30" }) })], profile, SEPTEMBER).totals.documents).toBe(0);
  });

  it("leaves out a document from another country", () => {
    const abroad = saved({ doc: docData({ country: "GB", issueDate: "2026-09-10" }) });
    expect(gstr1([abroad], profile, SEPTEMBER).totals.documents).toBe(0);
  });
});

describe("credit notes", () => {
  const invoice = saved({ doc: docData({ number: "INV-001", buyer: { name: "Globex", region: "KA", taxId: "29AAGCB7383J1Z4" } }) });
  const note = saved({
    kind: "credit-note",
    doc: docData({ kind: "credit-note", number: "CN-001", reference: "INV-001", buyer: { name: "Globex", region: "KA", taxId: "29AAGCB7383J1Z4" }, items: [line({ rate: 20000 })] })
  });
  const r = gstr1([invoice, note], profile, SEPTEMBER);

  it("puts the note in its own box, against the customer", () => {
    expect(r.cdnr).toHaveLength(1);
    expect(r.cdnr[0]).toMatchObject({ noteType: "C", against: "INV-001", ctin: "29AAGCB7383J1Z4" });
  });

  it("takes the note off the month's totals rather than adding it on", () => {
    expect(r.totals.taxableMinor).toBe(10000000 - 2000000);
  });
});

describe("exports", () => {
  const withoutPayment = saved({
    doc: docData({
      number: "EXP-001", placeOfSupply: "KA",
      buyer: { name: "Acme Inc", region: undefined },
      items: [line({ rate: 500000, taxRuleId: "in-gst-0" })],
      export: { enabled: true, kind: "services", taxMode: "lut", buyerCountry: "US", lutNumber: "LUT/2026/11" }
    })
  });
  const r = gstr1([withoutPayment], profile, SEPTEMBER);

  it("puts an export in its own box, not among the home sales", () => {
    expect(r.exp).toHaveLength(1);
    expect(r.b2b).toHaveLength(0);
    expect(r.b2cs).toHaveLength(0);
    expect(r.exp[0].type).toBe("WOPAY");
  });

  it("does not count a zero rated export as a nil rated home supply", () => {
    expect(r.nil.nilRatedMinor).toBe(0);
  });
});

describe("the HSN summary", () => {
  it("adds up by code and rate across the month", () => {
    const a = saved({ doc: docData({ number: "INV-001", items: [line({ code: "998311", quantity: 2, unit: "hours" })] }) });
    const b = saved({ doc: docData({ number: "INV-002", items: [line({ code: "998311", quantity: 3, unit: "hours" })] }) });
    const r = gstr1([a, b], profile, SEPTEMBER);
    expect(r.hsn).toHaveLength(1);
    expect(r.hsn[0]).toMatchObject({ code: "998311", rate: 18, quantity: 5, uqc: "HRS", taxableMinor: 50000000 });
  });

  it("writes units the way the return does, and says other when it cannot tell", () => {
    expect(uqcFor("hours")).toBe("HRS");
    expect(uqcFor("Kgs")).toBe("KGS");
    expect(uqcFor("nos")).toBe("NOS");
    expect(uqcFor("sprockets")).toBe("OTH");
    expect(uqcFor(undefined)).toBe("OTH");
  });
});

describe("the numbers you issued", () => {
  it("finds a gap in the series", () => {
    expect(missingInSeries(["INV-001", "INV-002", "INV-004"])).toEqual(["INV-003"]);
  });

  it("keeps separate series apart", () => {
    expect(missingInSeries(["INV-001", "INV-002", "CN-001"])).toEqual([]);
  });

  it("says nothing when the series is whole", () => {
    expect(missingInSeries(["INV-001", "INV-002", "INV-003"])).toEqual([]);
  });

  it("does not invent thousands of gaps from two unrelated numbers", () => {
    expect(missingInSeries(["INV-1", "INV-99999"])).toEqual([]);
  });
});

/* ---------------------------------------------------------------- GSTR-3B */

describe("the summary return", () => {
  const home = saved({ doc: docData({ number: "INV-001", buyer: { name: "Globex", region: "KA", taxId: "29AAGCB7383J1Z4" } }) });
  const away = saved({ doc: docData({ number: "INV-002", placeOfSupply: "MH", buyer: { name: "Someone", region: "MH" }, items: [line({ rate: 400000, taxRuleId: "in-igst-18" })] }) });
  const bills: Expense[] = [
    { id: "e1", date: "2026-09-05", supplier: "Hosting", category: "6040", currency: "INR", netMinor: 500000, taxMinor: 90000, paidFrom: "1020", createdAt: "", updatedAt: "" },
    { id: "e2", date: "2026-08-05", supplier: "Last month", category: "6040", currency: "INR", netMinor: 500000, taxMinor: 90000, paidFrom: "1020", createdAt: "", updatedAt: "" }
  ];
  const one = gstr1([home, away], profile, SEPTEMBER);
  const three = gstr3b(one, bills);

  it("is built from the same sales as GSTR-1, so the two cannot disagree", () => {
    expect(three.outwardTaxable.taxableMinor).toBe(one.totals.taxableMinor);
    expect(three.outwardTaxable.cgstMinor + three.outwardTaxable.sgstMinor + three.outwardTaxable.igstMinor).toBe(one.totals.taxMinor);
  });

  it("lists inter-state sales to unregistered people separately, as 3.2 asks", () => {
    expect(three.interStateToUnregistered).toHaveLength(1);
    expect(three.interStateToUnregistered[0]).toMatchObject({ pos: "27", igstMinor: 7200000 });
  });

  it("counts only this month's bills as credit", () => {
    expect(three.inputTaxCredit.recordedMinor).toBe(90000);
    expect(three.inputTaxCredit.bills).toBe(1);
  });

  it("refuses to split the credit it cannot split, and says so", () => {
    expect(three.inputTaxCredit.unsplit).toBe(true);
    expect(three.notes.join(" ")).toContain("GSTR-2B");
  });

  it("works out what is payable before any credit, and what is left after it", () => {
    expect(three.payable.totalMinor).toBe(one.totals.taxMinor);
    expect(three.afterCredit.totalMinor).toBe(one.totals.taxMinor - 90000);
  });

  it("takes a credit note off the outward supplies", () => {
    const note = saved({ kind: "credit-note", doc: docData({ kind: "credit-note", number: "CN-1", buyer: { name: "Globex", region: "KA", taxId: "29AAGCB7383J1Z4" }, items: [line({ rate: 50000 })] }) });
    const withNote = gstr3b(gstr1([home, note], profile, SEPTEMBER), []);
    expect(withNote.outwardTaxable.taxableMinor).toBe(10000000 - 5000000);
  });
});

/* ---------------------------------------------------------------- checking */

describe("before you file", () => {
  const base = { expenses: [] as Expense[], profile, period: SEPTEMBER };
  const findingsFor = (documents: SavedDocument[], over: Partial<typeof base> = {}) => {
    const opts = { ...base, ...over, documents };
    return checksFor({ ...opts, return: gstr1(documents, opts.profile, opts.period) });
  };

  it("says when a draft would be missing from the return", () => {
    const found = findingsFor([saved({ status: "draft" })]);
    expect(found.find((f) => f.id === "drafts")?.severity).toBe("stop");
  });

  it("catches a customer's mistyped tax number", () => {
    const found = findingsFor([saved({ doc: docData({ buyer: { name: "Globex", region: "KA", taxId: "29AAGCB7383J1ZZ" } }) })]);
    expect(found.find((f) => f.id === "buyer-gstin")?.severity).toBe("stop");
  });

  it("does not complain about a customer with no tax number at all", () => {
    expect(findingsFor([saved()]).find((f) => f.id === "buyer-gstin")).toBeUndefined();
  });

  it("catches your own GSTIN being missing", () => {
    const found = findingsFor([saved()], { profile: { ...profile, taxId: undefined } });
    expect(found.find((f) => f.id === "own-gstin-missing")?.severity).toBe("stop");
  });

  it("notices a document with no place of supply", () => {
    const found = findingsFor([saved({ doc: docData({ placeOfSupply: "", buyer: { name: "Someone" } }) })]);
    expect(found.find((f) => f.id === "place-of-supply")?.severity).toBe("stop");
  });

  it("notices lines with no HSN code, without treating it as fatal", () => {
    const found = findingsFor([saved({ doc: docData({ items: [line({ code: "" })] }) })]);
    expect(found.find((f) => f.id === "hsn")?.severity).toBe("check");
  });

  it("flags the sales that sit between the old and new B2CL thresholds", () => {
    const between = saved({ doc: docData({ number: "INV-9", placeOfSupply: "MH", buyer: { name: "Someone", region: "MH" }, items: [line({ rate: 150000, taxRuleId: "in-igst-18" })] }) });
    const found = findingsFor([between]);
    const finding = found.find((f) => f.id === "b2cl-threshold");
    expect(finding?.severity).toBe("check");
    expect(finding?.detail).toContain("2,50,000");
  });

  it("points at a gap in the invoice numbers", () => {
    const found = findingsFor([
      saved({ doc: docData({ number: "INV-001" }) }),
      saved({ doc: docData({ number: "INV-003" }) })
    ]);
    expect(found.find((f) => f.id === "series-gaps")?.detail).toContain("INV-002");
  });

  it("gives a clean month nothing to stop for", () => {
    const clean = [saved({ doc: docData({ number: "INV-001", buyer: { name: "Globex", region: "KA", taxId: "29AAGCB7383J1Z4" } }) })];
    const found = findingsFor(clean);
    expect(found.filter((f) => f.severity === "stop")).toHaveLength(0);
    expect(verdictOf(found).ready).toBe(true);
  });

  it("puts what would be wrong above what is only worth a look", () => {
    const found = findingsFor([saved({ status: "draft", doc: docData({ items: [line({ code: "" })] }) })]);
    expect(found[0].severity).toBe("stop");
  });

  it("says plainly how many things would be wrong", () => {
    expect(verdictOf([{ id: "a", severity: "stop", title: "", detail: "" }]).says).toContain("1 thing would be wrong");
    expect(verdictOf([]).says).toBe("Nothing here looks wrong.");
  });
});

/* ----------------------------------------------------------------- getting it out */

describe("handing it to the portal", () => {
  const registered = saved({ doc: docData({ number: "INV-001", buyer: { name: "Globex", region: "KA", taxId: "29AAGCB7383J1Z4" } }) });
  const away = saved({ doc: docData({ number: "INV-002", placeOfSupply: "MH", buyer: { name: "Someone", region: "MH" }, items: [line({ rate: 400000, taxRuleId: "in-igst-18" })] }) });
  const r = gstr1([registered, away], profile, SEPTEMBER);
  const json = JSON.parse(gstr1Json(r));

  it("writes the JSON the offline utility reads", () => {
    expect(json.gstin).toBe("29AAGCB7383J1Z4");
    expect(json.fp).toBe("092026");
    expect(json.b2b[0].ctin).toBe("29AAGCB7383J1Z4");
    expect(json.b2b[0].inv[0]).toMatchObject({ inum: "INV-001", idt: "10-09-2026", pos: "29", rchrg: "N", inv_typ: "R" });
  });

  it("writes money in rupees, not paise", () => {
    expect(json.b2b[0].inv[0].itms[0].itm_det).toMatchObject({ txval: 100000, rt: 18, camt: 9000, samt: 9000, iamt: 0 });
  });

  it("groups several invoices under one customer, as the shape requires", () => {
    const two = gstr1([registered, saved({ doc: docData({ number: "INV-003", buyer: { name: "Globex", region: "KA", taxId: "29AAGCB7383J1Z4" } }) })], profile, SEPTEMBER);
    const grouped = JSON.parse(gstr1Json(two));
    expect(grouped.b2b).toHaveLength(1);
    expect(grouped.b2b[0].inv).toHaveLength(2);
  });

  it("leaves out sections with nothing in them rather than sending them empty", () => {
    const only = JSON.parse(gstr1Json(gstr1([registered], profile, SEPTEMBER)));
    expect(only.b2cl).toBeUndefined();
    expect(only.cdnr).toBeUndefined();
    expect(only.b2b).toBeDefined();
  });

  it("writes one CSV per section, named as the utility's templates are", () => {
    const files = gstr1Csvs(r);
    expect(files.map((f) => f.name)).toEqual(["b2b.csv", "b2cl.csv", "hsn.csv", "docs.csv"]);
    expect(files[0].csv.split("\n")[0]).toContain("GSTIN/UIN of Recipient");
    expect(files[0].csv.split("\n")[1]).toContain("29AAGCB7383J1Z4,INV-001,10-09-2026");
  });

  it("quotes a customer name with a comma in it rather than breaking the row", () => {
    const comma = saved({ doc: docData({ number: "INV-5", items: [line({ description: "Design, and build" })] }) });
    const csv = gstr1Csvs(gstr1([comma], profile, SEPTEMBER)).find((f) => f.name === "hsn.csv")!.csv;
    expect(csv).toContain('"Design, and build"');
  });

  it("lays the summary return out box by box", () => {
    const csv = gstr3bCsv(gstr3b(r, []));
    expect(csv).toContain("3.1(a) Outward taxable supplies");
    expect(csv).toContain("3.2 Unregistered persons in 27-Maharashtra");
    expect(csv).toContain("6.1 Tax payable before credit");
  });
});
