import { checkGstin, stateByCode } from "../returns/states";
import type { EInvoicePayload } from "./schema";

/**
 * What the registration portal will reject, found before it rejects it.
 *
 * The portal's refusals are terse and arrive one at a time, so an invoice with three faults takes
 * three attempts to discover them. These are the same checks, run all at once, in words that say
 * what to change.
 */

export type Severity = "stop" | "check";

export interface Problem {
  field: string;
  severity: Severity;
  says: string;
}

/**
 * The rates the portal accepts. It keeps its own list, and a rate outside it is refused even when
 * the law allows it — which happens for a while after every rate change, including the 2025 one
 * that brought in 40%.
 */
export const ALLOWED_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

/** The portal takes the document number in a narrow shape and refuses anything else. */
export const DOCUMENT_NUMBER = /^[A-Za-z0-9/-]{1,16}$/;

/** Amounts are checked against each other, and a rupee either way is allowed for rounding. */
const TOLERANCE = 1;

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

export function validateEInvoice(payload: EInvoicePayload): Problem[] {
  const out: Problem[] = [];
  const stop = (field: string, says: string) => out.push({ field, severity: "stop", says });
  const check = (field: string, says: string) => out.push({ field, severity: "check", says });

  /* ---- the document itself ---- */
  if (!DOCUMENT_NUMBER.test(payload.DocDtls.No)) {
    stop("DocDtls.No", `The portal takes up to 16 characters, letters, numbers, slash and dash only. "${payload.DocDtls.No}" will be refused.`);
  }
  if (/^[/-]/.test(payload.DocDtls.No)) {
    stop("DocDtls.No", "A document number cannot begin with a slash or a dash.");
  }

  /* ---- the two parties ---- */
  for (const [who, party, label] of [
    ["SellerDtls", payload.SellerDtls, "Your own"],
    ["BuyerDtls", payload.BuyerDtls, "The customer's"]
  ] as const) {
    const gstin = checkGstin(party.Gstin);
    if (!party.Gstin) stop(`${who}.Gstin`, `${label} GSTIN is missing.`);
    else if (!gstin.valid) stop(`${who}.Gstin`, `${label} GSTIN will be refused: ${gstin.says}`);

    if (!party.LglNm?.trim()) stop(`${who}.LglNm`, `${label} legal name is missing.`);
    if (!party.Addr1?.trim()) stop(`${who}.Addr1`, `${label} address is missing. The portal needs at least a first line.`);
    if (!party.Loc?.trim()) stop(`${who}.Loc`, `${label} town or city is missing.`);
    if (!party.Pin || String(party.Pin).length !== 6) {
      stop(`${who}.Pin`, `${label} PIN code is missing or is not six digits. The portal checks it against the state.`);
    }
    if (!party.Stcd || !stateByCode(party.Stcd)) stop(`${who}.Stcd`, `${label} state is missing or not a state code.`);
    else if (gstin.valid && party.Gstin.slice(0, 2) !== party.Stcd) {
      stop(`${who}.Stcd`, `${label} state does not match the first two digits of the GSTIN, and the portal compares them.`);
    }
  }

  if (!payload.BuyerDtls.Pos || !stateByCode(payload.BuyerDtls.Pos)) {
    stop("BuyerDtls.Pos", "The place of supply is missing. Every invoice needs one.");
  }

  /* ---- the lines ---- */
  if (!payload.ItemList.length) stop("ItemList", "There are no lines on this invoice.");

  payload.ItemList.forEach((item, index) => {
    const where = `ItemList[${index + 1}]`;
    if (!item.HsnCd) stop(`${where}.HsnCd`, `Line ${index + 1} has no HSN or SAC code. The portal will not take a line without one.`);
    else if (!/^\d{4}|\d{6}|\d{8}$/.test(item.HsnCd)) {
      check(`${where}.HsnCd`, `Line ${index + 1}'s code "${item.HsnCd}" is not four, six or eight digits.`);
    }
    if (!item.PrdDesc?.trim()) stop(`${where}.PrdDesc`, `Line ${index + 1} has no description.`);
    if (!item.Qty && item.Qty !== 0) stop(`${where}.Qty`, `Line ${index + 1} has no quantity.`);
    if (!ALLOWED_RATES.includes(item.GstRt)) {
      check(`${where}.GstRt`, `Line ${index + 1} is at ${item.GstRt}%, which is not on the portal's list of rates. It may be refused even though the rate is correct in law.`);
    }

    const expected = Number((item.Qty * item.UnitPrice - item.Discount).toFixed(2));
    if (!near(expected, item.AssAmt)) {
      stop(`${where}.AssAmt`, `Line ${index + 1} does not add up: ${item.Qty} × ${item.UnitPrice} less ${item.Discount} is ${expected.toFixed(2)}, but the line says ${item.AssAmt.toFixed(2)}. The portal allows a rupee either way.`);
    }

    const lineTotal = Number((item.AssAmt + item.IgstAmt + item.CgstAmt + item.SgstAmt + item.CesAmt).toFixed(2));
    if (!near(lineTotal, item.TotItemVal)) {
      stop(`${where}.TotItemVal`, `Line ${index + 1}'s total of ${item.TotItemVal.toFixed(2)} does not match its parts, which come to ${lineTotal.toFixed(2)}.`);
    }

    if (item.IgstAmt > 0 && (item.CgstAmt > 0 || item.SgstAmt > 0)) {
      stop(`${where}.IgstAmt`, `Line ${index + 1} carries both IGST and CGST or SGST. A supply is one or the other.`);
    }
  });

  /* ---- the totals ---- */
  const v = payload.ValDtls;
  const sumAss = Number(payload.ItemList.reduce((a, i) => a + i.AssAmt, 0).toFixed(2));
  if (!near(sumAss, v.AssVal)) {
    stop("ValDtls.AssVal", `The taxable value of ${v.AssVal.toFixed(2)} does not match the lines, which add up to ${sumAss.toFixed(2)}.`);
  }

  const expectedTotal = Number((v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + v.CesVal + v.RndOffAmt).toFixed(2));
  if (!near(expectedTotal, v.TotInvVal)) {
    stop("ValDtls.TotInvVal", `The invoice total of ${v.TotInvVal.toFixed(2)} does not match its parts, which come to ${expectedTotal.toFixed(2)}.`);
  }

  if (v.IgstVal > 0 && (v.CgstVal > 0 || v.SgstVal > 0)) {
    stop("ValDtls", "The invoice carries both IGST and CGST or SGST.");
  }

  /* ---- exports ---- */
  if (payload.TranDtls.SupTyp === "EXPWP" || payload.TranDtls.SupTyp === "EXPWOP") {
    if (!payload.ExpDtls?.CntCode) check("ExpDtls.CntCode", "The buyer's country is not set on this export.");
    if (payload.TranDtls.SupTyp === "EXPWOP" && v.IgstVal > 0) {
      stop("ValDtls.IgstVal", "This is marked as an export without payment of tax, but it carries IGST.");
    }
  }

  return out;
}

/** Whether a payload would be accepted, in one line. */
export function verdictOf(problems: Problem[]): { ready: boolean; says: string } {
  const stops = problems.filter((p) => p.severity === "stop").length;
  if (stops) return { ready: false, says: `${stops} thing${stops === 1 ? "" : "s"} the portal would refuse.` };
  if (problems.length) return { ready: true, says: `Should be accepted. ${problems.length} thing${problems.length === 1 ? "" : "s"} worth a look.` };
  return { ready: true, says: "Nothing here the portal should object to." };
}
