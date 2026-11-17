import { calculate } from "../documents/totals";
import { convertMinor, rateFor } from "../fx";
import { uqcFor } from "../returns/gstr1";
import { checkGstin, stateByRegion } from "../returns/states";
import type { Profile, SavedDocument } from "../store/types";

/**
 * E-invoicing: the registration an invoice needs before it is legally an invoice.
 *
 * Above a turnover threshold an Indian business must send each B2B invoice to the government's
 * registration portal and put the number it hands back on the document. An invoice that should
 * have been registered and was not is not a valid invoice, and the customer cannot claim credit
 * on it - which is how a supplier finds out, months later, from an annoyed customer.
 *
 * This builds the payload the portal takes and checks it first. It does not register anything:
 * that needs credentials from the portal, which this has none of, and it says so rather than
 * implying an invoice has been filed when it has not.
 */

export const SCHEMA_VERSION = "1.1";

/* ------------------------------------------------------- who has to do it */

export interface Threshold {
  effectiveFrom: string;
  /** Aggregate turnover in any financial year from 2017-18 onwards. */
  turnoverMinor: number;
  source: string;
  status: "published" | "unverified";
}

export const THRESHOLDS: Threshold[] = [
  { effectiveFrom: "2020-10-01", turnoverMinor: 500000000000, source: "Notification 61/2020-Central Tax", status: "published" },
  { effectiveFrom: "2021-01-01", turnoverMinor: 100000000000, source: "Notification 88/2020-Central Tax", status: "published" },
  { effectiveFrom: "2021-04-01", turnoverMinor: 50000000000, source: "Notification 05/2021-Central Tax", status: "published" },
  { effectiveFrom: "2022-04-01", turnoverMinor: 20000000000, source: "Notification 01/2022-Central Tax", status: "published" },
  { effectiveFrom: "2022-10-01", turnoverMinor: 10000000000, source: "Notification 17/2022-Central Tax", status: "published" },
  { effectiveFrom: "2023-08-01", turnoverMinor: 5000000000, source: "Notification 10/2023-Central Tax", status: "published" }
];

export const thresholdOn = (date: string): Threshold =>
  [...THRESHOLDS].reverse().find((t) => t.effectiveFrom <= date) ?? THRESHOLDS[0];

export interface Applicability {
  required: boolean;
  thresholdMinor: number;
  turnoverMinor: number;
  says: string;
  threshold: Threshold;
}

/** Whether the business has to register its invoices at all, from its own turnover. */
export function applicability(turnoverMinor: number, date: string): Applicability {
  const threshold = thresholdOn(date);
  const required = turnoverMinor >= threshold.turnoverMinor;
  const crore = (minor: number) => `₹${(minor / 10000000 / 100).toFixed(2).replace(/\.00$/, "")} crore`;
  return {
    required,
    thresholdMinor: threshold.turnoverMinor,
    turnoverMinor,
    threshold,
    says: required
      ? `Your turnover is above ${crore(threshold.turnoverMinor)}, so B2B invoices have to be registered before they are issued.`
      : `Your turnover is under ${crore(threshold.turnoverMinor)}, so you do not have to register invoices. You may do it anyway, and some customers ask for it.`
  };
}

/* ---------------------------------------------- which invoices need one */

export type DocType = "INV" | "CRN" | "DBN";
export type SupplyType = "B2B" | "SEZWP" | "SEZWOP" | "EXPWP" | "EXPWOP" | "DEXP";

export interface Eligibility {
  eligible: boolean;
  supplyType?: SupplyType;
  docType?: DocType;
  reason?: string;
}

/**
 * Only some invoices go to the portal. A sale to somebody without a GSTIN never does, which is
 * the first thing to get right: a shop registering its counter sales would be registering
 * thousands of documents that do not belong there.
 */
export function eligibility(d: SavedDocument): Eligibility {
  if (d.deletedAt) return { eligible: false, reason: "Deleted." };
  if (d.doc.country?.toUpperCase() !== "IN") return { eligible: false, reason: "Not an Indian invoice." };
  if (d.status === "draft") return { eligible: false, reason: "Still a draft." };
  if (d.status === "cancelled") return { eligible: false, reason: "Cancelled." };

  const docType: DocType | undefined = d.kind === "invoice" ? "INV" : d.kind === "credit-note" ? "CRN" : undefined;
  if (!docType) return { eligible: false, reason: "Only invoices and credit notes are registered." };

  const exported = d.doc.export?.enabled;
  if (exported) {
    return {
      eligible: true, docType,
      supplyType: d.doc.export?.taxMode === "with-igst" ? "EXPWP" : "EXPWOP"
    };
  }

  if (!checkGstin(d.doc.buyer.taxId).valid) {
    return { eligible: false, reason: "The customer has no GSTIN, so this is a B2C sale and is not registered." };
  }

  return { eligible: true, docType, supplyType: "B2B" };
}

/* ---------------------------------------------------------- the payload */

export interface EInvoiceParty {
  Gstin: string;
  LglNm: string;
  TrdNm?: string;
  Addr1: string;
  Addr2?: string;
  Loc: string;
  Pin: number;
  Stcd: string;
  Ph?: string;
  Em?: string;
  Pos?: string;
}

export interface EInvoiceItem {
  SlNo: string;
  PrdDesc: string;
  IsServc: "Y" | "N";
  HsnCd: string;
  Qty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  CesRt: number;
  CesAmt: number;
  TotItemVal: number;
}

export interface EInvoicePayload {
  Version: string;
  TranDtls: { TaxSch: "GST"; SupTyp: SupplyType; RegRev: "Y" | "N"; IgstOnIntra: "Y" | "N" };
  DocDtls: { Typ: DocType; No: string; Dt: string };
  SellerDtls: EInvoiceParty;
  BuyerDtls: EInvoiceParty;
  ItemList: EInvoiceItem[];
  ValDtls: {
    AssVal: number; CgstVal: number; SgstVal: number; IgstVal: number;
    CesVal: number; Discount: number; RndOffAmt: number; TotInvVal: number;
  };
  ExpDtls?: { ShipBNo?: string; ShipBDt?: string; Port?: string; ForCur?: string; CntCode?: string };
}

const rupees = (minor: number) => Number((minor / 100).toFixed(2));
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pinOf = (value: string | undefined) => {
  const digits = (value ?? "").match(/\b(\d{6})\b/);
  return digits ? Number(digits[1]) : 0;
};

function partyOf(party: { name?: string; tradeName?: string; address?: string; taxId?: string; region?: string; phone?: string; email?: string; pin?: string }, fallbackRegion?: string): EInvoiceParty {
  const lines = (party.address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const state = stateByRegion(party.region ?? fallbackRegion);
  return {
    Gstin: (party.taxId ?? "").trim().toUpperCase(),
    LglNm: party.name ?? "",
    ...(party.tradeName ? { TrdNm: party.tradeName } : {}),
    Addr1: lines[0] ?? "",
    ...(lines[1] ? { Addr2: lines[1] } : {}),
    Loc: lines[lines.length - 1] ?? lines[0] ?? "",
    Pin: pinOf(party.pin ?? party.address),
    Stcd: state?.code ?? "",
    ...(party.phone ? { Ph: party.phone.replace(/\D/g, "").slice(-10) } : {}),
    ...(party.email ? { Em: party.email } : {})
  };
}

/**
 * The payload for one invoice.
 *
 * Everything is in rupees to two decimals, as the portal expects, and converted first where the
 * invoice was billed in another currency - the portal takes rupees whatever the customer paid in.
 */
export function buildEInvoice(d: SavedDocument, profile: Profile | undefined, documents: SavedDocument[] = []): EInvoicePayload | undefined {
  const fit = eligibility(d);
  if (!fit.eligible || !fit.docType || !fit.supplyType) return undefined;

  const totals = calculate(d.doc);
  const rate = rateFor(d.currency, "INR", documents, d.doc.fxRate);
  if (!rate) return undefined;
  const inr = (minor: number) => convertMinor(minor, d.currency, "INR", rate.rate);

  const seller = partyOf({
    name: profile?.name ?? d.doc.seller.name,
    address: profile?.address ?? d.doc.seller.address,
    taxId: profile?.taxId ?? d.doc.seller.taxId,
    region: profile?.region ?? d.doc.seller.region,
    phone: profile?.phone,
    email: profile?.email
  });

  const buyer = {
    ...partyOf({
      name: d.doc.buyer.name,
      address: d.doc.buyer.address,
      taxId: d.doc.buyer.taxId,
      region: d.doc.buyer.region
    }),
    Pos: stateByRegion(d.doc.placeOfSupply || d.doc.buyer.region)?.code ?? ""
  };

  const ItemList: EInvoiceItem[] = d.doc.items.map((line, index) => {
    const row = totals.lines[index];
    const taxable = inr(row?.net.minor ?? 0);
    const tax = inr(row?.tax.minor ?? 0);
    const half = Math.round(tax / 2);
    const inter = totals.supply.interRegion;
    return {
      SlNo: String(index + 1),
      PrdDesc: line.description.slice(0, 300),
      IsServc: (line.code ?? "").startsWith("99") ? "Y" : "N",
      HsnCd: line.code ?? "",
      Qty: line.quantity,
      Unit: uqcFor(line.unit),
      UnitPrice: rupees(inr(Math.round(line.rate * 100))),
      TotAmt: rupees(taxable),
      Discount: 0,
      AssAmt: rupees(taxable),
      GstRt: row?.rate ?? 0,
      IgstAmt: rupees(inter ? tax : 0),
      CgstAmt: rupees(inter ? 0 : half),
      SgstAmt: rupees(inter ? 0 : tax - half),
      CesRt: 0,
      CesAmt: 0,
      TotItemVal: rupees(taxable + tax)
    };
  });

  const inter = totals.supply.interRegion;
  const taxTotal = inr(totals.taxTotal.minor);
  const halfTotal = Math.round(taxTotal / 2);

  return {
    Version: SCHEMA_VERSION,
    TranDtls: { TaxSch: "GST", SupTyp: fit.supplyType, RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: fit.docType, No: d.number, Dt: dmy(d.issueDate) },
    SellerDtls: seller,
    BuyerDtls: buyer,
    ItemList,
    ValDtls: {
      AssVal: rupees(inr(totals.taxableTotal.minor)),
      CgstVal: rupees(inter ? 0 : halfTotal),
      SgstVal: rupees(inter ? 0 : taxTotal - halfTotal),
      IgstVal: rupees(inter ? taxTotal : 0),
      CesVal: 0,
      Discount: 0,
      RndOffAmt: rupees(inr(totals.roundOff.minor)),
      TotInvVal: rupees(inr(totals.total.minor))
    },
    ...(d.doc.export?.enabled ? {
      ExpDtls: {
        ShipBNo: d.doc.export.shippingBillNumber,
        ShipBDt: d.doc.export.shippingBillDate ? dmy(d.doc.export.shippingBillDate) : undefined,
        Port: d.doc.export.portCode,
        ForCur: d.currency === "INR" ? undefined : d.currency,
        CntCode: d.doc.export.buyerCountry
      }
    } : {})
  };
}
