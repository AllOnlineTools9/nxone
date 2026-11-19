import { calculate } from "../documents/totals";
import { convertMinor, rateFor } from "../fx";
import { uqcFor } from "../returns/gstr1";
import { checkGstin, stateByRegion } from "../returns/states";
import type { Profile, SavedDocument } from "../store/types";

/**
 * E-way bills: the permit goods need to travel in India above a certain value.
 *
 * The government portal takes a JSON file with many bills at once (E-way Bill > Generate Bulk).
 * This builds that file from invoices already made, so nothing is typed twice, and checks it
 * first, because the portal turns a file away for one bad pincode and says little about which.
 *
 * Nothing is generated from here: the portal does that, after the person signs in, and hands
 * back the e-way bill number. That number can be kept against the invoice once it exists.
 *
 * Services move nothing and need no e-way bill, so only goods lines count (HSN codes; SAC codes
 * start 99). A business that sells no goods will find nothing to do here, which is correct.
 */

/** The file version the bulk upload tool writes. */
export const BULK_VERSION = "1.0.0621";

/**
 * The general limit is ₹50,000 of goods in one consignment. Some states set a higher limit for
 * movement inside the state, so below the limit it says "not needed" and above it "needed",
 * without trying to know every state's rule.
 */
export const THRESHOLD_MINOR = 50_000_00;

/** The longest distance the portal accepts for one bill. */
export const MAX_DISTANCE_KM = 4000;

export type TransportMode = "road" | "rail" | "air" | "ship";
const MODE_CODE: Record<TransportMode, string> = { road: "1", rail: "2", air: "3", ship: "4" };

/** Part B: how the goods travel. Kept on the invoice once filled in, so a re-download keeps it. */
export interface EwayTransport {
  mode: TransportMode;
  distanceKm: number;
  vehicleNumber?: string;
  /** "R" regular, "O" over-dimensional cargo. */
  vehicleType?: "R" | "O";
  transporterId?: string;
  transporterName?: string;
  /** For rail, air and ship: the railway receipt, airway bill or bill of lading. */
  transportDocNumber?: string;
  transportDocDate?: string;
  /** Pincode the goods are going to, where it is not in the customer's address. */
  toPincode?: string;
}

export interface EwayRecord {
  transport: EwayTransport;
  /** The number the portal gave back, once somebody has generated it there. */
  number?: string;
  preparedAt: string;
}

export interface EwayItem {
  itemNo: number;
  productName: string;
  productDesc: string;
  hsnCode: number;
  quantity: number;
  qtyUnit: string;
  taxableAmount: number;
  sgstRate: number;
  cgstRate: number;
  igstRate: number;
  cessRate: number;
  cessNonAdvol: number;
}

export interface EwayBill {
  userGstin: string;
  supplyType: "O";
  subSupplyType: number;
  subSupplyDesc: string;
  docType: "INV" | "BIL";
  docNo: string;
  docDate: string;
  transType: number;
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  actualFromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  actualToStateCode: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  TotNonAdvolVal: number;
  OthValue: number;
  totInvValue: number;
  transMode: string;
  transDistance: number;
  transporterName: string;
  transporterId: string;
  transDocNo: string;
  transDocDate: string;
  vehicleNo: string;
  vehicleType: string;
  mainHsnCode: number;
  itemList: EwayItem[];
}

const rupees = (minor: number) => Number((minor / 100).toFixed(2));
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const pinIn = (text: string | undefined) => Number((text ?? "").match(/\b(\d{6})\b/)?.[1] ?? 0);
const isGoods = (code: string | undefined) => !(code ?? "").trim().startsWith("99");
/** "URP" is how the portal writes an unregistered buyer. */
const URP = "URP";

/** Vehicle numbers as the portal writes them: no spaces or dashes, capitals. */
export const cleanVehicle = (v: string | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A normal Indian registration (KA01AB1234, DL3CAB1234) or a temporary one (TR...) or defence (BA...). */
const VEHICLE = /^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|TR[A-Z0-9]{6,13}|BP[A-Z0-9]{6,13}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;

export interface Need {
  /** Whether this invoice can have an e-way bill at all. */
  applies: boolean;
  /** Whether it is over the general limit. */
  required: boolean;
  goodsMinor: number;
  reason?: string;
}

/** Whether an invoice moves goods, and whether their value is over the limit. */
export function needFor(d: SavedDocument): Need {
  if (d.kind !== "invoice") return { applies: false, required: false, goodsMinor: 0, reason: "Only invoices move goods." };
  if (d.status === "draft") return { applies: false, required: false, goodsMinor: 0, reason: "Still a draft." };
  const totals = calculate(d.doc);
  const goodsMinor = d.doc.items.reduce((sum, line, i) => {
    const row = totals.lines[i];
    return isGoods(line.code) ? sum + (row?.total.minor ?? 0) : sum;
  }, 0);
  if (goodsMinor === 0) return { applies: false, required: false, goodsMinor, reason: "Services only, so nothing travels." };
  return { applies: true, required: goodsMinor > THRESHOLD_MINOR, goodsMinor };
}

/** One bill for the bulk file, from an invoice and how its goods travel. Rupees, as the portal takes. */
export function buildEwayBill(
  d: SavedDocument,
  profile: Profile | undefined,
  transport: EwayTransport,
  documents: SavedDocument[] = []
): EwayBill | undefined {
  const totals = calculate(d.doc);
  const rate = rateFor(d.currency, "INR", documents, d.doc.fxRate);
  if (!rate) return undefined;
  const inr = (minor: number) => convertMinor(minor, d.currency, "INR", rate.rate);
  const inter = totals.supply.interRegion;

  const sellerAddress = (profile?.address ?? d.doc.seller.address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const buyerAddress = (d.doc.buyer.address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const fromState = Number(stateByRegion(profile?.region ?? d.doc.seller.region)?.code ?? 0);
  const toState = Number(stateByRegion(d.doc.buyer.region)?.code ?? 0);
  const supplyState = Number(stateByRegion(d.doc.placeOfSupply || d.doc.buyer.region)?.code ?? toState);
  const buyerGstin = (d.doc.buyer.taxId ?? "").trim().toUpperCase();

  let goodsTaxable = 0, goodsTax = 0;
  const itemList: EwayItem[] = [];
  d.doc.items.forEach((line, i) => {
    if (!isGoods(line.code)) return;
    const row = totals.lines[i];
    const taxable = inr(row?.net.minor ?? 0);
    const tax = inr(row?.tax.minor ?? 0);
    goodsTaxable += taxable;
    goodsTax += tax;
    const r = row?.rate ?? 0;
    itemList.push({
      itemNo: itemList.length + 1,
      productName: line.description.slice(0, 100),
      productDesc: line.description.slice(0, 100),
      hsnCode: Number((line.code ?? "").replace(/\D/g, "")) || 0,
      quantity: line.quantity,
      qtyUnit: uqcFor(line.unit),
      taxableAmount: rupees(taxable),
      sgstRate: inter ? 0 : r / 2,
      cgstRate: inter ? 0 : r / 2,
      igstRate: inter ? r : 0,
      cessRate: 0,
      cessNonAdvol: 0
    });
  });

  // The portal wants the main HSN to be the one with the largest value.
  const main = [...itemList].sort((a, b) => b.taxableAmount - a.taxableAmount)[0];
  const half = Math.round(goodsTax / 2);
  const road = transport.mode === "road";

  return {
    userGstin: (profile?.taxId ?? d.doc.seller.taxId ?? "").trim().toUpperCase(),
    supplyType: "O",
    subSupplyType: d.doc.export?.enabled ? 3 : 1,
    subSupplyDesc: "",
    docType: d.doc.composition || d.doc.noGst ? "BIL" : "INV",
    docNo: d.number,
    docDate: dmy(d.issueDate),
    transType: 1,
    fromGstin: (profile?.taxId ?? d.doc.seller.taxId ?? "").trim().toUpperCase(),
    fromTrdName: (profile?.name ?? d.doc.seller.name ?? "").slice(0, 100),
    fromAddr1: (sellerAddress[0] ?? "").slice(0, 120),
    fromAddr2: (sellerAddress[1] ?? "").slice(0, 120),
    fromPlace: (sellerAddress[sellerAddress.length - 1] ?? "").replace(/\b\d{6}\b/, "").trim().slice(0, 50),
    fromPincode: pinIn(profile?.address ?? d.doc.seller.address),
    fromStateCode: fromState,
    actualFromStateCode: fromState,
    toGstin: checkGstin(buyerGstin).valid ? buyerGstin : URP,
    toTrdName: (d.doc.buyer.name ?? "").slice(0, 100),
    toAddr1: (buyerAddress[0] ?? "").slice(0, 120),
    toAddr2: (buyerAddress[1] ?? "").slice(0, 120),
    toPlace: (buyerAddress[buyerAddress.length - 1] ?? "").replace(/\b\d{6}\b/, "").trim().slice(0, 50),
    toPincode: Number(transport.toPincode) || pinIn(d.doc.buyer.address),
    // Export goods go to the port, but the bill is still made out to "other country" (96).
    toStateCode: d.doc.export?.enabled ? 96 : supplyState,
    actualToStateCode: toState || supplyState,
    totalValue: rupees(goodsTaxable),
    cgstValue: rupees(inter ? 0 : half),
    sgstValue: rupees(inter ? 0 : goodsTax - half),
    igstValue: rupees(inter ? goodsTax : 0),
    cessValue: 0,
    TotNonAdvolVal: 0,
    OthValue: 0,
    totInvValue: rupees(goodsTaxable + goodsTax),
    transMode: MODE_CODE[transport.mode],
    transDistance: Math.round(transport.distanceKm),
    transporterName: (transport.transporterName ?? "").slice(0, 100),
    transporterId: (transport.transporterId ?? "").trim().toUpperCase(),
    transDocNo: road ? "" : (transport.transportDocNumber ?? "").slice(0, 15),
    transDocDate: road ? "" : dmy(transport.transportDocDate ?? ""),
    vehicleNo: road ? cleanVehicle(transport.vehicleNumber) : "",
    vehicleType: road && transport.vehicleNumber ? (transport.vehicleType ?? "R") : "",
    mainHsnCode: main?.hsnCode ?? 0,
    itemList
  };
}

export interface EwayProblem { field: string; says: string }

/** What the portal would refuse, said in words, all at once. */
export function checkEwayBill(bill: EwayBill, transport: EwayTransport): EwayProblem[] {
  const out: EwayProblem[] = [];
  const add = (field: string, says: string) => out.push({ field, says });

  if (!checkGstin(bill.fromGstin).valid) add("fromGstin", "Your GSTIN is missing or not valid. Add it in Your business.");
  if (!/^[1-9]\d{5}$/.test(String(bill.fromPincode))) add("fromPincode", "Your address needs a 6-digit pincode.");
  if (!bill.fromStateCode) add("fromStateCode", "Your state is not set. Add it in Your business.");
  if (!/^[1-9]\d{5}$/.test(String(bill.toPincode))) add("toPincode", "The delivery pincode is missing. Add it here or in the customer's address.");
  if (!bill.toStateCode) add("toStateCode", "The customer's state is not set on the invoice.");
  if (!/^[A-Za-z0-9/-]{1,16}$/.test(bill.docNo)) add("docNo", "The invoice number must be 16 characters or fewer, using letters, numbers, / and -.");
  if (bill.itemList.length === 0) add("itemList", "There are no goods on this invoice.");
  bill.itemList.forEach((item) => {
    if (String(item.hsnCode).length < 4) add(`hsn-${item.itemNo}`, `"${item.productName}" needs an HSN code of at least 4 digits.`);
  });

  if (!Number.isFinite(transport.distanceKm) || transport.distanceKm < 1) add("distance", "Enter the distance in kilometres.");
  else if (transport.distanceKm > MAX_DISTANCE_KM) add("distance", `The portal takes at most ${MAX_DISTANCE_KM} km for one bill.`);

  if (transport.transporterId && !checkGstin(transport.transporterId).valid && !/^[0-9A-Z]{15}$/.test(transport.transporterId.toUpperCase())) {
    add("transporterId", "The transporter ID is a 15-character GSTIN or TRANSIN.");
  }

  if (transport.mode === "road") {
    const v = cleanVehicle(transport.vehicleNumber);
    if (!v && !transport.transporterId) add("vehicle", "Add the vehicle number, or the transporter ID if they will add the vehicle.");
    else if (v && !VEHICLE.test(v)) add("vehicle", "That vehicle number does not look right. It is written like KA01AB1234.");
  } else if (!transport.transportDocNumber) {
    add("transportDoc", `Add the ${transport.mode === "rail" ? "railway receipt" : transport.mode === "air" ? "airway bill" : "bill of lading"} number.`);
  }

  return out;
}

/** The file the portal's Generate Bulk page takes. */
export function bulkFile(bills: EwayBill[]): string {
  return JSON.stringify({ version: BULK_VERSION, billLists: bills }, null, 2);
}
