import type { Gstr1, RateLine } from "./gstr1";
import type { Gstr3b } from "./gstr3b";

/**
 * Getting the return out of NXOne and into the portal.
 *
 * Two ways, because people file in two ways. The JSON is the shape the government's own offline
 * utility reads, for somebody filing it themselves. The CSVs are for an accountant, who will want
 * to look at the rows before anything is uploaded anywhere.
 *
 * Neither pretends to be a filing. Nothing here talks to the portal, and the screen says so: the
 * utility validates what it is given, and that validation is worth keeping in the loop.
 */

/** Returns write money in rupees with two decimals, not paise. */
const rupees = (minor: number) => Number((minor / 100).toFixed(2));
const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
};

const items = (lines: RateLine[]) =>
  lines.map((line, index) => ({
    num: index + 1,
    itm_det: {
      txval: rupees(line.taxableMinor),
      rt: line.rate,
      iamt: rupees(line.igstMinor),
      camt: rupees(line.cgstMinor),
      samt: rupees(line.sgstMinor),
      csamt: rupees(line.cessMinor)
    }
  }));

/**
 * The offline utility's JSON. Sections with nothing in them are left out rather than sent empty,
 * which is what the utility expects.
 */
export function gstr1Json(r: Gstr1): string {
  const byCustomer = new Map<string, typeof r.b2b>();
  for (const row of r.b2b) byCustomer.set(row.ctin, [...(byCustomer.get(row.ctin) ?? []), row]);

  const payload: Record<string, unknown> = {
    gstin: r.gstin,
    fp: r.fp,
    version: "GST3.2.2",
    hash: "hash"
  };

  if (byCustomer.size) {
    payload.b2b = [...byCustomer.entries()].map(([ctin, rows]) => ({
      ctin,
      inv: rows.map((row) => ({
        inum: row.number,
        idt: dmy(row.date),
        val: rupees(row.invoiceValueMinor),
        pos: row.pos,
        rchrg: row.reverseCharge ? "Y" : "N",
        inv_typ: row.type,
        itms: items(row.lines)
      }))
    }));
  }

  if (r.b2cl.length) {
    const byState = new Map<string, typeof r.b2cl>();
    for (const row of r.b2cl) byState.set(row.pos, [...(byState.get(row.pos) ?? []), row]);
    payload.b2cl = [...byState.entries()].map(([pos, rows]) => ({
      pos,
      inv: rows.map((row) => ({
        inum: row.number,
        idt: dmy(row.date),
        val: rupees(row.invoiceValueMinor),
        itms: items(row.lines)
      }))
    }));
  }

  if (r.b2cs.length) {
    payload.b2cs = r.b2cs.map((row) => ({
      sply_ty: row.igstMinor > 0 ? "INTER" : "INTRA",
      pos: row.pos,
      typ: row.type,
      rt: row.rate,
      txval: rupees(row.taxableMinor),
      iamt: rupees(row.igstMinor),
      camt: rupees(row.cgstMinor),
      samt: rupees(row.sgstMinor),
      csamt: rupees(row.cessMinor)
    }));
  }

  if (r.cdnr.length) {
    const byCustomerNote = new Map<string, typeof r.cdnr>();
    for (const row of r.cdnr) byCustomerNote.set(row.ctin, [...(byCustomerNote.get(row.ctin) ?? []), row]);
    payload.cdnr = [...byCustomerNote.entries()].map(([ctin, rows]) => ({
      ctin,
      nt: rows.map((row) => ({
        ntty: row.noteType,
        nt_num: row.number,
        nt_dt: dmy(row.date),
        val: rupees(row.valueMinor),
        pos: row.pos,
        rchrg: "N",
        inv_typ: "R",
        itms: items(row.lines)
      }))
    }));
  }

  if (r.exp.length) {
    const byType = new Map<string, typeof r.exp>();
    for (const row of r.exp) byType.set(row.type, [...(byType.get(row.type) ?? []), row]);
    payload.exp = [...byType.entries()].map(([exp_typ, rows]) => ({
      exp_typ,
      inv: rows.map((row) => ({
        inum: row.number,
        idt: dmy(row.date),
        val: rupees(row.valueMinor),
        sbpcode: row.portCode ?? "",
        sbnum: row.shippingBillNumber ?? "",
        sbdt: row.shippingBillDate ? dmy(row.shippingBillDate) : "",
        itms: row.lines.map((line) => ({ txval: rupees(line.taxableMinor), rt: line.rate, iamt: rupees(line.igstMinor), csamt: rupees(line.cessMinor) }))
      }))
    }));
  }

  if (r.hsn.length) {
    payload.hsn = {
      data: r.hsn.map((row, index) => ({
        num: index + 1,
        hsn_sc: row.code === "Not set" ? "" : row.code,
        desc: row.description.slice(0, 30),
        uqc: row.uqc,
        qty: Number(row.quantity.toFixed(2)),
        rt: row.rate,
        txval: rupees(row.taxableMinor),
        iamt: rupees(row.igstMinor),
        camt: rupees(row.cgstMinor),
        samt: rupees(row.sgstMinor),
        csamt: rupees(row.cessMinor)
      }))
    };
  }

  if (r.docs.length) {
    payload.doc_issue = {
      doc_det: [{
        doc_num: 1,
        doc_typ: "Invoices for outward supply",
        docs: r.docs.map((row, index) => ({
          num: index + 1,
          from: row.from,
          to: row.to,
          totnum: row.issued,
          cancel: row.cancelled,
          net_issue: row.net
        }))
      }]
    };
  }

  return JSON.stringify(payload, null, 2);
}

/* -------------------------------------------------------------------- CSVs */

const escape = (value: string | number) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (headers: string[], rows: Array<Array<string | number>>) =>
  [headers.join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n");

/** One file per section, named the way the offline utility's own templates are. */
export function gstr1Csvs(r: Gstr1): Array<{ name: string; csv: string; rows: number }> {
  const files: Array<{ name: string; csv: string; rows: number }> = [];

  const b2bRows = r.b2b.flatMap((row) =>
    row.lines.map((line) => [
      row.ctin, row.number, dmy(row.date), rupees(row.invoiceValueMinor), row.posName,
      row.reverseCharge ? "Y" : "N", "", row.type === "R" ? "Regular B2B" : row.type, "",
      line.rate, rupees(line.taxableMinor), rupees(line.cessMinor)
    ]));
  if (b2bRows.length) {
    files.push({
      name: "b2b.csv", rows: b2bRows.length,
      csv: toCsv(["GSTIN/UIN of Recipient", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"], b2bRows)
    });
  }

  const b2clRows = r.b2cl.flatMap((row) =>
    row.lines.map((line) => [
      row.number, dmy(row.date), rupees(row.invoiceValueMinor), row.posName, "",
      line.rate, rupees(line.taxableMinor), rupees(line.cessMinor), ""
    ]));
  if (b2clRows.length) {
    files.push({
      name: "b2cl.csv", rows: b2clRows.length,
      csv: toCsv(["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"], b2clRows)
    });
  }

  if (r.b2cs.length) {
    files.push({
      name: "b2cs.csv", rows: r.b2cs.length,
      csv: toCsv(["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
        r.b2cs.map((row) => [row.type, row.posName, "", row.rate, rupees(row.taxableMinor), rupees(row.cessMinor), ""]))
    });
  }

  const cdnrRows = r.cdnr.flatMap((row) =>
    row.lines.map((line) => [
      row.ctin, row.against ?? "", row.number, dmy(row.date), row.noteType === "C" ? "C" : "D",
      row.posName, "", "", rupees(row.valueMinor), line.rate, rupees(line.taxableMinor), rupees(line.cessMinor)
    ]));
  if (cdnrRows.length) {
    files.push({
      name: "cdnr.csv", rows: cdnrRows.length,
      csv: toCsv(["GSTIN/UIN of Recipient", "Invoice/Advance Receipt Number", "Note/Refund Voucher Number", "Note/Refund Voucher date", "Document Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note/Refund Voucher Value", "Rate", "Taxable Value", "Cess Amount"], cdnrRows)
    });
  }

  const expRows = r.exp.flatMap((row) =>
    row.lines.map((line) => [
      row.type === "WPAY" ? "WPAY" : "WOPAY", row.number, dmy(row.date), rupees(row.valueMinor),
      row.portCode ?? "", row.shippingBillNumber ?? "", row.shippingBillDate ? dmy(row.shippingBillDate) : "",
      line.rate, rupees(line.taxableMinor), rupees(line.cessMinor)
    ]));
  if (expRows.length) {
    files.push({
      name: "exp.csv", rows: expRows.length,
      csv: toCsv(["Export Type", "Invoice Number", "Invoice date", "Invoice Value", "Port Code", "Shipping Bill Number", "Shipping Bill Date", "Rate", "Taxable Value", "Cess Amount"], expRows)
    });
  }

  if (r.hsn.length) {
    files.push({
      name: "hsn.csv", rows: r.hsn.length,
      csv: toCsv(["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"],
        r.hsn.map((row) => [
          row.code === "Not set" ? "" : row.code, row.description, row.uqc, Number(row.quantity.toFixed(2)),
          rupees(row.totalValueMinor), row.rate, rupees(row.taxableMinor),
          rupees(row.igstMinor), rupees(row.cgstMinor), rupees(row.sgstMinor), rupees(row.cessMinor)
        ]))
    });
  }

  if (r.docs.length) {
    files.push({
      name: "docs.csv", rows: r.docs.length,
      csv: toCsv(["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
        r.docs.map((row) => ["Invoices for outward supply", row.from, row.to, row.issued, row.cancelled]))
    });
  }

  return files;
}

/** GSTR-3B as one readable sheet, because it is typed into the portal by hand anyway. */
export function gstr3bCsv(r: Gstr3b): string {
  const rows: Array<Array<string | number>> = [
    ["3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)",
      rupees(r.outwardTaxable.taxableMinor), rupees(r.outwardTaxable.igstMinor), rupees(r.outwardTaxable.cgstMinor), rupees(r.outwardTaxable.sgstMinor), rupees(r.outwardTaxable.cessMinor)],
    ["3.1(b) Outward taxable supplies (zero rated)",
      rupees(r.zeroRated.taxableMinor), rupees(r.zeroRated.igstMinor), 0, 0, rupees(r.zeroRated.cessMinor)],
    ["3.1(c) Other outward supplies (nil rated, exempted)", rupees(r.nilAndExempt.taxableMinor), 0, 0, 0, 0],
    ["", "", "", "", "", ""],
    ...r.interStateToUnregistered.map((row) => [`3.2 Unregistered persons in ${row.posName}`, rupees(row.taxableMinor), rupees(row.igstMinor), 0, 0, 0]),
    ["", "", "", "", "", ""],
    ["4(A)(5) All other ITC, as recorded here", "", "", "", "", rupees(r.inputTaxCredit.recordedMinor)],
    ["6.1 Tax payable before credit", "", rupees(r.payable.igstMinor), rupees(r.payable.cgstMinor), rupees(r.payable.sgstMinor), rupees(r.payable.totalMinor)]
  ];
  return toCsv(["Box", "Taxable value", "IGST", "CGST", "SGST/UTGST", "Cess"], rows);
}
