import { calculate } from "../documents/totals";
import { convertMinor, rateFor } from "../fx";
import type { SavedDocument } from "../store/types";
import type { Profile } from "../store/types";
import { checkGstin, placeOfSupply, stateByRegion } from "./states";

/**
 * GSTR-1: everything you sold, in the shape the return asks for.
 *
 * The books already hold what a return needs - taxable value per rate, whether the tax was IGST or
 * CGST and SGST, the place of supply, the HSN of each line. What has been missing is the sorting
 * into the government's own boxes, which is the part people pay a fee every month to have done.
 *
 * Nothing here is invented. Where a figure cannot be known from the books - a reverse charge flag
 * nobody recorded, which threshold applies on a given date - it is reported as something to check
 * rather than filled in with a guess, because a return is signed by the person filing it.
 */

/* ------------------------------------------------------------------ period */

export interface ReturnPeriod {
  from: string;
  to: string;
  /** The return's own period format: MMYYYY. */
  fp: string;
  label: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");

export function returnPeriod(iso: string): ReturnPeriod {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}`, fp: `${pad(m)}${y}`, label: `${MONTHS[m - 1]} ${y}` };
}

/* --------------------------------------------------------------- the rules */

/**
 * Above this, an inter-state sale to somebody without a GSTIN is listed invoice by invoice (B2CL)
 * rather than summarised (B2CS). The figure has changed, so it is dated like every other rule in
 * NXOne, and the newer one is marked unverified until somebody has checked it against the
 * notification itself.
 */
export const B2CL_THRESHOLDS = [
  { effectiveFrom: "2017-07-01", amountMinor: 25000000, source: "Rule 46 and the GSTR-1 instructions", status: "verified" as const },
  { effectiveFrom: "2024-11-01", amountMinor: 10000000, source: "Notification 12/2024-Central Tax", status: "unverified" as const }
];

export const b2clThresholdOn = (iso: string) =>
  [...B2CL_THRESHOLDS].reverse().find((t) => t.effectiveFrom <= iso) ?? B2CL_THRESHOLDS[0];

/* --------------------------------------------------------------- the boxes */

export interface RateLine {
  rate: number;
  taxableMinor: number;
  igstMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  cessMinor: number;
}

export interface B2BRow {
  ctin: string;
  buyer: string;
  number: string;
  date: string;
  invoiceValueMinor: number;
  pos: string;
  posName: string;
  reverseCharge: boolean;
  /** Regular, SEZ with payment, SEZ without payment, deemed export. */
  type: "R" | "SEWP" | "SEWOP" | "DE";
  lines: RateLine[];
}

export interface B2CLRow {
  buyer: string;
  number: string;
  date: string;
  invoiceValueMinor: number;
  pos: string;
  posName: string;
  lines: RateLine[];
}

export interface B2CSRow {
  pos: string;
  posName: string;
  type: "OE";
  rate: number;
  taxableMinor: number;
  igstMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  cessMinor: number;
}

export interface CdnrRow {
  ctin: string;
  buyer: string;
  number: string;
  date: string;
  noteType: "C" | "D";
  /** What it was raised against, where the document says so. */
  against?: string;
  valueMinor: number;
  pos: string;
  posName: string;
  lines: RateLine[];
}

export interface ExpRow {
  /** With payment of IGST, or without it under a letter of undertaking. */
  type: "WPAY" | "WOPAY";
  number: string;
  date: string;
  valueMinor: number;
  portCode?: string;
  shippingBillNumber?: string;
  shippingBillDate?: string;
  lines: RateLine[];
}

export interface HsnRow {
  code: string;
  description: string;
  uqc: string;
  quantity: number;
  rate: number;
  taxableMinor: number;
  igstMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  cessMinor: number;
  totalValueMinor: number;
}

export interface DocSeriesRow {
  from: string;
  to: string;
  issued: number;
  cancelled: number;
  net: number;
  /** Numbers inside the run that no document accounts for. */
  missing: string[];
}

export interface Gstr1 {
  gstin: string;
  fp: string;
  period: ReturnPeriod;
  b2b: B2BRow[];
  b2cl: B2CLRow[];
  b2cs: B2CSRow[];
  cdnr: CdnrRow[];
  exp: ExpRow[];
  hsn: HsnRow[];
  docs: DocSeriesRow[];
  nil: { nilRatedMinor: number; exemptMinor: number; nonGstMinor: number };
  totals: {
    documents: number;
    invoiceValueMinor: number;
    taxableMinor: number;
    igstMinor: number;
    cgstMinor: number;
    sgstMinor: number;
    taxMinor: number;
  };
  threshold: (typeof B2CL_THRESHOLDS)[number];
}

/* ------------------------------------------------------------------ pieces */

/** Units as the return writes them. Anything unrecognised is "other", which the return allows. */
const UQC: Array<[RegExp, string]> = [
  [/^(nos?|no|pcs?|piece|unit|each|qty)/i, "NOS"],
  [/^(kgs?|kilo)/i, "KGS"],
  [/^(gms?|gram)/i, "GMS"],
  [/^(ltr?|litre|liter)/i, "LTR"],
  [/^(mtr?|metre|meter)/i, "MTR"],
  [/^(sqf|sq ?ft|square f)/i, "SQF"],
  [/^(sqm|sq ?m|square m)/i, "SQM"],
  [/^(hrs?|hour)/i, "HRS"],
  [/^(day|month|year)/i, "OTH"],
  [/^(box|bag|bdl|bundle|pack|set|pair|dozen|doz)/i, "BOX"],
  [/^(tons?|mts?)/i, "TON"]
];

export const uqcFor = (unit?: string): string => {
  const value = (unit ?? "").trim();
  if (!value) return "OTH";
  return UQC.find(([pattern]) => pattern.test(value))?.[1] ?? "OTH";
};

const isSale = (d: SavedDocument) => d.kind === "invoice";
const isNote = (d: SavedDocument) => d.kind === "credit-note";
const counts = (d: SavedDocument) => (isSale(d) || isNote(d)) && d.status !== "draft";

/** A document's rate lines, split the way the return splits them. */
function rateLines(totals: ReturnType<typeof calculate>): RateLine[] {
  const rows = new Map<number, RateLine>();
  for (const hsn of totals.hsnSummary) {
    const row = rows.get(hsn.rate) ?? { rate: hsn.rate, taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, cessMinor: 0 };
    row.taxableMinor += hsn.taxable.minor;
    row.igstMinor += hsn.igst.minor;
    row.cgstMinor += hsn.cgst.minor;
    row.sgstMinor += hsn.sgst.minor;
    rows.set(hsn.rate, row);
  }
  // A document with no HSN codes still has rates, so fall back to the tax rows.
  if (!rows.size) {
    for (const tax of totals.taxRows) {
      const half = Math.round(tax.tax.minor / 2);
      const igst = totals.supply.interRegion;
      rows.set(tax.rate, {
        rate: tax.rate,
        taxableMinor: tax.taxable.minor,
        igstMinor: igst ? tax.tax.minor : 0,
        cgstMinor: igst ? 0 : half,
        sgstMinor: igst ? 0 : tax.tax.minor - half,
        cessMinor: 0
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.rate - b.rate);
}

const posOf = (d: SavedDocument) => d.doc.placeOfSupply || d.doc.buyer.region || d.doc.seller.region || "";

/** Where a series of numbers has a gap: INV-1, INV-2, INV-4 is missing INV-3. */
export function missingInSeries(numbers: string[]): string[] {
  const parsed = numbers
    .map((n) => /^(.*?)(\d+)(\D*)$/.exec(n))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ prefix: m[1], value: Number(m[2]), width: m[2].length, suffix: m[3] }));
  if (parsed.length < 2) return [];

  const byPrefix = new Map<string, typeof parsed>();
  for (const row of parsed) {
    const key = `${row.prefix}|${row.suffix}|${row.width}`;
    byPrefix.set(key, [...(byPrefix.get(key) ?? []), row]);
  }

  const gaps: string[] = [];
  for (const rows of byPrefix.values()) {
    const values = new Set(rows.map((r) => r.value));
    const low = Math.min(...values);
    const high = Math.max(...values);
    // A run with an implausible spread is somebody's numbering scheme, not a gap.
    if (high - low > 2000) continue;
    for (let n = low; n <= high; n += 1) {
      if (!values.has(n)) gaps.push(`${rows[0].prefix}${String(n).padStart(rows[0].width, "0")}${rows[0].suffix}`);
    }
  }
  return gaps.sort();
}

/* ------------------------------------------------------------------- entry */

export function gstr1(documents: SavedDocument[], profile: Profile | undefined, period: ReturnPeriod): Gstr1 {
  const inPeriod = documents.filter((d) =>
    !d.deletedAt && counts(d) && d.doc.country?.toUpperCase() === "IN" &&
    d.issueDate >= period.from && d.issueDate <= period.to);

  const live = inPeriod.filter((d) => d.status !== "cancelled");
  const threshold = b2clThresholdOn(period.from);

  const b2b: B2BRow[] = [];
  const b2cl: B2CLRow[] = [];
  const cdnr: CdnrRow[] = [];
  const exp: ExpRow[] = [];
  const b2csMap = new Map<string, B2CSRow>();
  const hsnMap = new Map<string, HsnRow>();
  const nil = { nilRatedMinor: 0, exemptMinor: 0, nonGstMinor: 0 };

  let invoiceValueMinor = 0;
  let taxableMinor = 0;
  let igstMinor = 0;
  let cgstMinor = 0;
  let sgstMinor = 0;

  for (const d of live) {
    const totals = calculate(d.doc);
    // A return is written in rupees. An export billed in another currency is converted at the
    // rate recorded on the invoice; one with no rate cannot go on the return at all, and the
    // checks say so rather than this quietly dropping it.
    const rate = rateFor(d.currency, "INR", documents, d.doc.fxRate);
    if (!rate) continue;
    const inr = (minor: number) => convertMinor(minor, d.currency, "INR", rate.rate);
    const lines = rateLines(totals).map((l) => ({
      rate: l.rate,
      taxableMinor: inr(l.taxableMinor), igstMinor: inr(l.igstMinor),
      cgstMinor: inr(l.cgstMinor), sgstMinor: inr(l.sgstMinor), cessMinor: inr(l.cessMinor)
    }));
    const totalMinor = inr(totals.total.minor);
    const region = posOf(d);
    const state = stateByRegion(region);
    const pos = state?.code ?? "";
    const posName = placeOfSupply(region);
    const buyerGstin = (d.doc.buyer.taxId ?? "").trim().toUpperCase();
    const registered = checkGstin(buyerGstin).valid;
    const exported = Boolean(d.doc.export?.enabled);

    invoiceValueMinor += totalMinor * (isNote(d) ? -1 : 1);
    taxableMinor += inr(totals.taxableTotal.minor) * (isNote(d) ? -1 : 1);
    for (const line of lines) {
      igstMinor += line.igstMinor * (isNote(d) ? -1 : 1);
      cgstMinor += line.cgstMinor * (isNote(d) ? -1 : 1);
      sgstMinor += line.sgstMinor * (isNote(d) ? -1 : 1);
      // Zero-rated lines that are not exports are nil rated as far as the return is concerned.
      if (line.rate === 0 && !exported) nil.nilRatedMinor += line.taxableMinor;
    }

    /* ---- the HSN summary, which covers everything regardless of box ---- */
    for (const hsn of totals.hsnSummary) {
      const key = `${hsn.code}|${hsn.rate}`;
      const item = d.doc.items.find((i) => (i.code || "Not set") === hsn.code);
      const row = hsnMap.get(key) ?? {
        code: hsn.code, description: item?.description ?? "", uqc: uqcFor(item?.unit), quantity: 0, rate: hsn.rate,
        taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, cessMinor: 0, totalValueMinor: 0
      };
      const sign = isNote(d) ? -1 : 1;
      const quantity = d.doc.items.filter((i) => (i.code || "Not set") === hsn.code).reduce((a, i) => a + i.quantity, 0);
      row.quantity += quantity * sign;
      row.taxableMinor += inr(hsn.taxable.minor) * sign;
      row.igstMinor += inr(hsn.igst.minor) * sign;
      row.cgstMinor += inr(hsn.cgst.minor) * sign;
      row.sgstMinor += inr(hsn.sgst.minor) * sign;
      row.totalValueMinor += inr(hsn.taxable.minor + hsn.total.minor) * sign;
      hsnMap.set(key, row);
    }

    /* ---- which box ---- */
    if (isNote(d)) {
      cdnr.push({
        ctin: registered ? buyerGstin : "", buyer: d.clientName, number: d.number, date: d.issueDate,
        noteType: "C", against: d.doc.reference, valueMinor: totalMinor, pos, posName, lines
      });
      continue;
    }

    if (exported) {
      exp.push({
        type: d.doc.export?.taxMode === "with-igst" ? "WPAY" : "WOPAY",
        number: d.number, date: d.issueDate, valueMinor: totalMinor,
        portCode: d.doc.export?.portCode, shippingBillNumber: d.doc.export?.shippingBillNumber,
        shippingBillDate: d.doc.export?.shippingBillDate, lines
      });
      continue;
    }

    if (registered) {
      b2b.push({
        ctin: buyerGstin, buyer: d.clientName, number: d.number, date: d.issueDate,
        invoiceValueMinor: totalMinor, pos, posName,
        // Nothing in the books records a reverse charge, so it is never claimed here.
        reverseCharge: false, type: "R", lines
      });
      continue;
    }

    if (totals.supply.interRegion && totalMinor > threshold.amountMinor) {
      b2cl.push({ buyer: d.clientName, number: d.number, date: d.issueDate, invoiceValueMinor: totalMinor, pos, posName, lines });
      continue;
    }

    for (const line of lines) {
      const key = `${pos}|${line.rate}`;
      const row = b2csMap.get(key) ?? { pos, posName, type: "OE" as const, rate: line.rate, taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, cessMinor: 0 };
      row.taxableMinor += line.taxableMinor;
      row.igstMinor += line.igstMinor;
      row.cgstMinor += line.cgstMinor;
      row.sgstMinor += line.sgstMinor;
      b2csMap.set(key, row);
    }
  }

  /* ---- the series of numbers issued, which the return asks for separately ---- */
  const docs: DocSeriesRow[] = [];
  const invoices = inPeriod.filter(isSale);
  if (invoices.length) {
    const numbers = invoices.map((d) => d.number).sort();
    docs.push({
      from: numbers[0], to: numbers[numbers.length - 1],
      issued: invoices.length,
      cancelled: invoices.filter((d) => d.status === "cancelled").length,
      net: invoices.filter((d) => d.status !== "cancelled").length,
      missing: missingInSeries(numbers)
    });
  }

  return {
    gstin: (profile?.taxId ?? "").trim().toUpperCase(),
    fp: period.fp,
    period,
    b2b: b2b.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number)),
    b2cl,
    b2cs: [...b2csMap.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate),
    cdnr,
    exp,
    hsn: [...hsnMap.values()].sort((a, b) => a.code.localeCompare(b.code) || a.rate - b.rate),
    docs,
    nil,
    totals: {
      documents: live.length,
      invoiceValueMinor, taxableMinor, igstMinor, cgstMinor, sgstMinor,
      taxMinor: igstMinor + cgstMinor + sgstMinor
    },
    threshold
  };
}
