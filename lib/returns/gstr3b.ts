import type { Expense } from "../store/types";
import { rcmSummary } from "./rcm";
import { placeOfSupply, stateByRegion } from "./states";
import type { Gstr1 } from "./gstr1";

/**
 * GSTR-3B: the monthly summary, and the money.
 *
 * It is built from the same documents as GSTR-1 rather than typed again, so the two returns
 * cannot disagree with each other - which is the mismatch that brings a notice.
 *
 * One figure is genuinely beyond the books: input tax credit. The expenses here record how much
 * tax was paid but not whether it was IGST or CGST and SGST, and nothing here has seen the
 * supplier's own return. So the credit is reported as what was recorded, unsplit, and labelled as
 * something to check against GSTR-2B before it is claimed. Claiming credit that the portal does
 * not show is how people end up paying it back with interest.
 */

export interface TaxSplit {
  taxableMinor: number;
  igstMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  cessMinor: number;
}

export interface Gstr3b {
  gstin: string;
  fp: string;
  /** 3.1(a) Outward taxable supplies, other than zero rated, nil rated and exempted. */
  outwardTaxable: TaxSplit;
  /** 3.1(b) Outward taxable supplies, zero rated. */
  zeroRated: TaxSplit;
  /** 3.1(c) Other outward supplies: nil rated and exempt. */
  nilAndExempt: { taxableMinor: number };
  /** 3.2 Of 3.1(a), what went to unregistered people in other states, by place of supply. */
  interStateToUnregistered: Array<{ pos: string; posName: string; taxableMinor: number; igstMinor: number }>;
  /** 3.1(d) Inward supplies on which tax is payable by you, not by the supplier. */
  inwardReverseCharge: { taxableMinor: number; taxMinor: number; bills: number };
  /** 4(A)(3) The credit that comes back on those same supplies, where it is allowed. */
  reverseChargeCredit: { minor: number };
  /** 4(A)(5) All other input tax credit, as recorded on this device. */
  inputTaxCredit: { recordedMinor: number; bills: number; unsplit: true };
  /** 6.1 What is payable per head before any credit is set off. */
  payable: { igstMinor: number; cgstMinor: number; sgstMinor: number; totalMinor: number };
  /** What is left after the recorded credit, as a single figure and nothing more. */
  afterCredit: { totalMinor: number };
  notes: string[];
}

export function gstr3b(gstr1: Gstr1, expenses: Expense[], opts: { currency?: string; from?: string; to?: string } = {}): Gstr3b {
  const currency = opts.currency ?? "INR";

  // Reverse charge sits in two boxes that must agree with each other: what is owed on inward
  // supplies, and the credit for the same supplies. Filling one without the other is the
  // commonest way a 3B comes back queried.
  const reverse = rcmSummary(
    expenses.filter((e) => !e.deletedAt).map((e) => ({
      id: e.id, date: e.date, supplier: e.supplier, netMinor: e.netMinor,
      rcmCategory: e.rcmCategory, rcmRate: e.rcmRate
    })),
    opts.from ?? "0000-01-01",
    opts.to ?? "9999-12-31"
  );

  const outwardTaxable: TaxSplit = { taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, cessMinor: 0 };
  const zeroRated: TaxSplit = { taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, cessMinor: 0 };
  const unregistered = new Map<string, { pos: string; posName: string; taxableMinor: number; igstMinor: number }>();

  const addTo = (into: TaxSplit, lines: Array<{ taxableMinor: number; igstMinor: number; cgstMinor: number; sgstMinor: number; cessMinor: number }>, sign = 1) => {
    for (const line of lines) {
      into.taxableMinor += line.taxableMinor * sign;
      into.igstMinor += line.igstMinor * sign;
      into.cgstMinor += line.cgstMinor * sign;
      into.sgstMinor += line.sgstMinor * sign;
      into.cessMinor += line.cessMinor * sign;
    }
  };

  for (const row of gstr1.b2b) addTo(outwardTaxable, row.lines);
  for (const row of gstr1.b2cl) addTo(outwardTaxable, row.lines);
  for (const row of gstr1.b2cs) addTo(outwardTaxable, [row]);
  // A credit note reduces what was supplied, so it comes off the same box it went into.
  for (const row of gstr1.cdnr) addTo(outwardTaxable, row.lines, -1);
  for (const row of gstr1.exp) addTo(zeroRated, row.lines);

  // Nil rated lines were counted in the taxable box above, so take them back out of it.
  outwardTaxable.taxableMinor -= gstr1.nil.nilRatedMinor;

  for (const row of gstr1.b2cl) {
    const key = row.pos;
    const into = unregistered.get(key) ?? { pos: row.pos, posName: row.posName, taxableMinor: 0, igstMinor: 0 };
    for (const line of row.lines) { into.taxableMinor += line.taxableMinor; into.igstMinor += line.igstMinor; }
    unregistered.set(key, into);
  }
  for (const row of gstr1.b2cs) {
    if (!row.igstMinor) continue; // only inter-state supplies belong in 3.2
    const into = unregistered.get(row.pos) ?? { pos: row.pos, posName: row.posName, taxableMinor: 0, igstMinor: 0 };
    into.taxableMinor += row.taxableMinor;
    into.igstMinor += row.igstMinor;
    unregistered.set(row.pos, into);
  }

  const withTax = expenses.filter((e) => !e.deletedAt && e.currency === currency && e.taxMinor > 0
    && e.date >= gstr1.period.from && e.date <= gstr1.period.to);
  const recordedMinor = withTax.reduce((a, e) => a + e.taxMinor, 0);

  const payable = {
    igstMinor: outwardTaxable.igstMinor + zeroRated.igstMinor,
    cgstMinor: outwardTaxable.cgstMinor,
    sgstMinor: outwardTaxable.sgstMinor,
    totalMinor: 0
  };
  payable.totalMinor = payable.igstMinor + payable.cgstMinor + payable.sgstMinor;

  const notes = [
    "Input tax credit here is the tax recorded against your own bills. It is not split into IGST, CGST and SGST, because the bills do not record which it was, and it has not been checked against what your suppliers filed. Compare it with GSTR-2B on the portal before you claim it.",
    "The order in which credit is set off against each head is not worked out here. The portal does that, and it is worth letting it.",
    "Interest and late fees are not included."
  ];
  if (gstr1.cdnr.length) notes.push("Credit notes have been taken off the outward supplies they relate to.");
  for (const note of reverse.notes) notes.push(note);

  return {
    gstin: gstr1.gstin,
    fp: gstr1.fp,
    outwardTaxable,
    zeroRated,
    nilAndExempt: { taxableMinor: gstr1.nil.nilRatedMinor + gstr1.nil.exemptMinor },
    interStateToUnregistered: [...unregistered.values()]
      .map((row) => ({ ...row, posName: row.posName || placeOfSupply(stateByRegion(row.pos)?.region) }))
      .sort((a, b) => a.pos.localeCompare(b.pos)),
    inwardReverseCharge: {
      taxableMinor: reverse.taxableMinor,
      taxMinor: reverse.owedMinor,
      bills: reverse.liabilities.length
    },
    reverseChargeCredit: { minor: reverse.claimableMinor },
    inputTaxCredit: { recordedMinor, bills: withTax.length, unsplit: true },
    payable,
    // Reverse charge is deliberately left out of this figure: it has to be paid in cash and
    // cannot be set off against credit, so folding it in here would understate what to pay.
    afterCredit: { totalMinor: payable.totalMinor - recordedMinor },
    notes
  };
}
