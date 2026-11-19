import { describe, expect, it } from "vitest";
import { BULK_VERSION, buildEwayBill, bulkFile, checkEwayBill, cleanVehicle, needFor, type EwayTransport } from "@/lib/ewaybill/ewaybill";
import type { DocumentData } from "@/lib/documents/types";
import type { Profile, SavedDocument } from "@/lib/store/types";

const SELLER_GSTIN = "29AAGCB7383J1Z4";
const BUYER_GSTIN = "27AAPFU0939F1ZV";

const profile: Profile = {
  name: "Brightline Traders", country: "IN", currency: "INR", region: "KA",
  taxId: SELLER_GSTIN, address: "4th Cross, Indiranagar\nBengaluru 560038"
};

const docData = (over: Partial<DocumentData> = {}): DocumentData => ({
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-10", number: "INV-001",
  seller: { name: "Brightline Traders", region: "KA", taxId: SELLER_GSTIN, address: "4th Cross, Indiranagar\nBengaluru 560038" },
  buyer: { name: "Globex Private Limited", region: "MH", taxId: BUYER_GSTIN, address: "12 Nariman Point\nMumbai 400021" },
  placeOfSupply: "MH",
  items: [
    { id: "l1", description: "Steel rods", quantity: 100, rate: 800, unit: "kg", code: "7214", taxRuleId: "in-igst-18" },
    { id: "l2", description: "Installation", quantity: 1, rate: 5000, code: "995468", taxRuleId: "in-igst-18" }
  ],
  taxInclusive: false, ...over
} as DocumentData);

const saved = (doc = docData(), over: Partial<SavedDocument> = {}): SavedDocument => ({
  id: "d1", kind: doc.kind as SavedDocument["kind"], number: doc.number, clientName: doc.buyer.name,
  issueDate: doc.issueDate, currency: doc.currency, totalMinor: 0, paidMinor: 0, status: "sent",
  doc, createdAt: "", updatedAt: "", ...over
});

const road: EwayTransport = { mode: "road", distanceKm: 980, vehicleNumber: "ka 01 ab 1234" };

describe("which invoices need an e-way bill", () => {
  it("counts only goods, not services, against the limit", () => {
    const need = needFor(saved());
    // 100 kg x ₹800 + 18% = ₹94,400 of goods; the installation does not count
    expect(need.goodsMinor).toBe(9_440_000);
    expect(need.required).toBe(true);
  });

  it("says nothing is needed below ₹50,000", () => {
    const need = needFor(saved(docData({ items: [{ id: "l1", description: "Rods", quantity: 10, rate: 800, code: "7214", taxRuleId: "in-igst-18" }] })));
    expect(need.applies).toBe(true);
    expect(need.required).toBe(false);
  });

  it("leaves out services, drafts and quotations", () => {
    expect(needFor(saved(docData({ items: [{ id: "l", description: "Design", quantity: 1, rate: 90000, code: "998311" }] }))).applies).toBe(false);
    expect(needFor(saved(docData(), { status: "draft" })).applies).toBe(false);
    expect(needFor(saved(docData({ kind: "quote" }), { kind: "quote" })).applies).toBe(false);
  });
});

describe("the bill for the bulk file", () => {
  const bill = buildEwayBill(saved(), profile, road)!;

  it("carries only the goods, in rupees, with IGST between states", () => {
    expect(bill.itemList).toHaveLength(1);
    expect(bill.itemList[0]).toMatchObject({ hsnCode: 7214, quantity: 100, qtyUnit: "KGS", taxableAmount: 80000, igstRate: 18, cgstRate: 0 });
    expect(bill.totalValue).toBe(80000);
    expect(bill.igstValue).toBe(14400);
    expect(bill.totInvValue).toBe(94400);
    expect(bill.mainHsnCode).toBe(7214);
  });

  it("fills both ends from the business and the customer", () => {
    expect(bill).toMatchObject({
      fromGstin: SELLER_GSTIN, fromPincode: 560038, fromStateCode: 29, fromPlace: "Bengaluru",
      toGstin: BUYER_GSTIN, toPincode: 400021, toStateCode: 27, docDate: "10/09/2026", docType: "INV"
    });
  });

  it("writes the vehicle as the portal does, and the mode as its code", () => {
    expect(bill.vehicleNo).toBe("KA01AB1234");
    expect(bill.transMode).toBe("1");
    expect(bill.vehicleType).toBe("R");
  });

  it("splits CGST and SGST inside the state", () => {
    const local = buildEwayBill(saved(docData({
      buyer: { name: "Local Co", region: "KA", address: "MG Road\nBengaluru 560001" }, placeOfSupply: "KA",
      items: [{ id: "l1", description: "Rods", quantity: 100, rate: 800, code: "7214", taxRuleId: "in-gst-18" }]
    })), profile, road)!;
    expect(local.toGstin).toBe("URP");
    expect(local.cgstValue + local.sgstValue).toBe(14400);
    expect(local.itemList[0]).toMatchObject({ cgstRate: 9, sgstRate: 9, igstRate: 0 });
  });

  it("passes the checks when everything is there", () => {
    expect(checkEwayBill(bill, road)).toEqual([]);
  });

  it("wraps bills in the version the bulk tool expects", () => {
    const file = JSON.parse(bulkFile([bill]));
    expect(file.version).toBe(BULK_VERSION);
    expect(file.billLists).toHaveLength(1);
  });
});

describe("what the portal would refuse", () => {
  const says = (t: EwayTransport, doc = docData()) => {
    const b = buildEwayBill(saved(doc), profile, t)!;
    return checkEwayBill(b, t).map((p) => p.says).join(" | ");
  };

  it("asks for the distance, within the portal's limit", () => {
    expect(says({ ...road, distanceKm: 0 })).toContain("distance");
    expect(says({ ...road, distanceKm: 4500 })).toContain("4000 km");
  });

  it("asks for a vehicle on the road, and a document number otherwise", () => {
    expect(says({ mode: "road", distanceKm: 10 })).toContain("vehicle number");
    expect(says({ mode: "road", distanceKm: 10, vehicleNumber: "HELLO" })).toContain("does not look right");
    expect(says({ mode: "rail", distanceKm: 10 })).toContain("railway receipt");
  });

  it("lets the transporter add the vehicle later", () => {
    expect(says({ mode: "road", distanceKm: 10, transporterId: "29AAGCB7383J1Z4" })).toBe("");
  });

  it("asks for a delivery pincode and HSN codes", () => {
    const doc = docData({
      buyer: { name: "Globex", region: "MH", taxId: BUYER_GSTIN, address: "Nariman Point, Mumbai" },
      items: [{ id: "l1", description: "Rods", quantity: 100, rate: 800, code: "72", taxRuleId: "in-igst-18" }]
    });
    const out = says(road, doc);
    expect(out).toContain("pincode");
    expect(out).toContain("HSN code of at least 4 digits");
    expect(says({ ...road, toPincode: "400021" }, doc)).not.toContain("pincode");
  });
});

describe("vehicle numbers", () => {
  it("drops spaces and dashes and uses capitals", () => {
    expect(cleanVehicle("mh-12 ab-1234")).toBe("MH12AB1234");
  });
});
