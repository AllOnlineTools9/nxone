import { calculate } from "../documents/totals";
import { convertMinor, rateFor } from "../fx";
import { accountByCode } from "../ledger/accounts";
import { stateByCode, stateByRegion } from "../returns/states";
import type { Period } from "../store/reports";
import type { Expense, Profile, SavedDocument } from "../store/types";
import type { ZipEntry } from "../files/zip";

/**
 * The books for a period as files Tally imports, so an accountant on Tally loads them rather
 * than typing every invoice in again.
 *
 * Two files, because Tally imports them separately and in order: the ledgers first (customers,
 * suppliers, sales, the tax ledgers, cash and bank), then the vouchers that use them. Vouchers
 * are written in accounting view, with no stock items, which every Tally company accepts
 * whatever its inventory settings.
 *
 * What goes:
 *   Sales            every invoice that is not a draft or cancelled
 *   Credit Note      every credit note
 *   Receipt          money received against an invoice, on the day it arrived
 *   Purchase         every bill recorded as an expense
 *   Payment          bills that were paid, from the account they were paid from
 *
 * Amounts are in the books' currency. A document in another currency is converted at the rate
 * on the document; one with no rate is left out and named in the notes, never guessed.
 *
 * Tally's sign rule: a debit is ISDEEMEDPOSITIVE Yes with a negative amount, a credit is No with
 * a positive one. Every voucher here is checked to balance before it is written.
 */

export interface TallyInput {
  profile: Profile;
  documents: SavedDocument[];
  expenses: Expense[];
  period: Period;
}

export interface TallyResult {
  masters: string;
  vouchers: string;
  counts: { sales: number; creditNotes: number; receipts: number; purchases: number; payments: number; ledgers: number };
  /** Anything left out or approximated, in words, for the accountant. */
  notes: string[];
}

type Group =
  | "Sundry Debtors" | "Sundry Creditors" | "Sales Accounts" | "Purchase Accounts" | "Duties & Taxes"
  | "Indirect Expenses" | "Indirect Incomes" | "Bank Accounts" | "Cash-in-Hand" | "Current Assets" | "Fixed Assets";

interface Ledger {
  name: string;
  parent: Group;
  party?: { gstin?: string; address?: string; region?: string; country?: string };
  gstHead?: "Central Tax" | "State Tax" | "Integrated Tax";
}

interface Entry { ledger: string; minor: number; debit: boolean; bill?: { name: string; type: "New Ref" | "Agst Ref" } }

interface Voucher {
  type: "Sales" | "Credit Note" | "Receipt" | "Purchase" | "Payment";
  id: string;
  date: string;
  number: string;
  party: string;
  narration: string;
  reference?: string;
  entries: Entry[];
}

/* ------------------------------------------------------------------ text */

export const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    // Characters XML 1.0 cannot hold at all, which Tally then refuses the whole file for.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const amount = (minor: number) => (minor / 100).toFixed(2);
const tallyDate = (iso: string) => iso.replace(/-/g, "").slice(0, 8);
/** Tally ledger names: no leading or trailing space, nothing over its length limit. */
const cleanName = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 100) || "Unnamed";

/* ------------------------------------------------------------- the ledgers */

const SALES = "Sales";
const PURCHASES = "Purchases";
const ROUND_OFF = "Round Off";
const TDS_PAYABLE = "TDS Payable";

const cashLedger = (code?: string) =>
  code === "1010" ? { name: "Cash", parent: "Cash-in-Hand" as Group }
    : code === "1030" ? { name: "Payment Gateway", parent: "Current Assets" as Group }
      : { name: "Bank", parent: "Bank Accounts" as Group };

const expenseLedger = (category: string): Ledger => {
  if (category === "5000") return { name: PURCHASES, parent: "Purchase Accounts" };
  const account = accountByCode(category);
  // Equipment bought is something the business owns, not a cost of the month.
  if (account?.type === "asset") return { name: cleanName(account.name), parent: "Fixed Assets" };
  return { name: cleanName(account?.name ?? "Other expenses"), parent: "Indirect Expenses" };
};

/* ---------------------------------------------------------------- building */

export function tallyExport(input: TallyInput): TallyResult {
  const { profile, period } = input;
  const books = (profile.currency ?? "INR").toUpperCase();
  const india = (profile.country ?? "IN").toUpperCase() === "IN";
  const ownState = stateByRegion(profile.region)?.code;
  const inPeriod = (iso?: string) => Boolean(iso) && iso! >= period.from && iso! <= period.to;

  const ledgers = new Map<string, Ledger>();
  const vouchers: Voucher[] = [];
  const notes: string[] = [];
  const add = (l: Ledger) => { if (!ledgers.has(l.name)) ledgers.set(l.name, l); return l.name; };

  // A customer and a supplier with the same name would otherwise share one ledger.
  const customers = new Set<string>();
  const customerLedger = (d: SavedDocument) => {
    const name = cleanName(d.doc.buyer.name || d.clientName);
    customers.add(name);
    return add({ name, parent: "Sundry Debtors", party: { gstin: d.doc.buyer.taxId, address: d.doc.buyer.address, region: d.doc.buyer.region, country: d.doc.export?.enabled ? d.doc.export.buyerCountry : undefined } });
  };
  const supplierLedger = (e: Expense) => {
    let name = cleanName(e.supplier);
    if (customers.has(name)) name = cleanName(`${name} (supplier)`);
    return add({ name, parent: "Sundry Creditors", party: { gstin: e.supplierGstin, region: e.supplierGstin ? stateByCode(e.supplierGstin.slice(0, 2))?.region : undefined } });
  };

  /** Output tax ledgers for one document: CGST and SGST inside the state, IGST between states. */
  const taxEntries = (taxMinor: number, inter: boolean, utgst: boolean, side: "Output" | "Input", debit: boolean, labels: string[]): Entry[] => {
    if (!taxMinor) return [];
    if (!india) {
      const name = add({ name: `${side} ${labels[0] || "Tax"}`, parent: "Duties & Taxes" });
      return [{ ledger: name, minor: taxMinor, debit }];
    }
    if (inter) {
      return [{ ledger: add({ name: `${side} IGST`, parent: "Duties & Taxes", gstHead: "Integrated Tax" }), minor: taxMinor, debit }];
    }
    const half = Math.round(taxMinor / 2);
    return [
      { ledger: add({ name: `${side} CGST`, parent: "Duties & Taxes", gstHead: "Central Tax" }), minor: half, debit },
      { ledger: add({ name: `${side} ${utgst ? "UTGST" : "SGST"}`, parent: "Duties & Taxes", gstHead: "State Tax" }), minor: taxMinor - half, debit }
    ];
  };

  /* sales, credit notes and the money received against them */
  const sorted = [...input.documents].sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number));
  for (const d of sorted) {
    if (d.deletedAt) continue;
    const isSale = d.kind === "invoice";
    const isCredit = d.kind === "credit-note";
    if (!isSale && !isCredit) continue;
    if (d.status === "draft" || d.status === "cancelled") continue;

    const rate = rateFor(d.currency, books, input.documents, d.doc.fxRate);
    if (!rate) {
      if (inPeriod(d.issueDate) || inPeriod(d.paidOn)) notes.push(`${d.number} is in ${d.currency} with no exchange rate, so it was left out.`);
      continue;
    }
    const conv = (minor: number) => convertMinor(minor, d.currency, books, rate.rate);
    const party = () => customerLedger(d);

    if (inPeriod(d.issueDate)) {
      const t = calculate(d.doc);
      const total = conv(t.total.minor);
      const tax = conv(t.taxTotal.minor);
      const round = conv(t.roundOff.minor);
      const sales = total - tax - round;
      // A sale debits the customer and credits sales and tax; a credit note does the reverse.
      const dr = isSale;
      const entries: Entry[] = [
        { ledger: party(), minor: total, debit: dr, bill: { name: d.number, type: "New Ref" } },
        { ledger: add({ name: SALES, parent: "Sales Accounts" }), minor: sales, debit: !dr },
        ...taxEntries(tax, t.supply.interRegion, t.supply.stateTaxLabel === "UTGST", "Output", !dr, t.taxRows.map((r) => r.label)),
        ...(round ? [{ ledger: add({ name: ROUND_OFF, parent: "Indirect Expenses" }), minor: Math.abs(round), debit: round > 0 ? !dr : dr }] : [])
      ];
      if (isCredit && d.madeFrom) entries[0].bill = { name: d.madeFrom.number, type: "Agst Ref" };
      vouchers.push({
        type: isSale ? "Sales" : "Credit Note", id: d.id, date: d.issueDate, number: d.number, party: party(),
        narration: `${isSale ? "Invoice" : "Credit note"} ${d.number} to ${d.clientName}`, entries
      });
    }

    // Money received. Only one date is kept for it, so a part payment followed by the rest
    // arrives as one receipt on the later day, which the notes say.
    const paidOn = d.paidOn ?? (d.paidMinor > 0 ? d.updatedAt.slice(0, 10) : undefined);
    if (isSale && d.paidMinor > 0 && inPeriod(paidOn)) {
      const received = convertMinor(d.paidMinor, d.currency, books, d.paymentFxRate ?? rate.rate);
      const bank = cashLedger("1020");
      vouchers.push({
        type: "Receipt", id: `${d.id}-r`, date: paidOn!, number: `R-${d.number}`, party: party(),
        narration: `Received against ${d.number}`,
        entries: [
          { ledger: add(bank), minor: received, debit: true },
          { ledger: party(), minor: received, debit: false, bill: { name: d.number, type: "Agst Ref" } }
        ]
      });
      if (!d.paidOn) notes.push(`${d.number}: the day the money arrived was not recorded, so its receipt is dated the day it was marked paid.`);
    }
  }

  /* bills, and paying them */
  const bills = [...input.expenses].filter((e) => !e.deletedAt && inPeriod(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  bills.forEach((e, i) => {
    const sameCurrency = e.currency.toUpperCase() === books;
    if (!sameCurrency && !e.fxRate) {
      notes.push(`The ${e.supplier} bill of ${e.date} is in ${e.currency} with no exchange rate, so it was left out.`);
      return;
    }
    const conv = (minor: number) => convertMinor(minor, e.currency, books, e.fxRate ?? 1);
    const net = conv(e.netMinor);
    const tax = conv(e.taxMinor);
    const supplier = supplierLedger(e);
    const reference = e.reference?.trim() || `${e.date}-${i + 1}`;
    const number = `P-${tallyDate(e.date)}-${i + 1}`;

    // Inside the state or between states, from the supplier's GSTIN when there is one. Without
    // it the split is a guess, so it goes to one ledger to be split in Tally and the notes say so.
    let taxLines: Entry[] = [];
    if (tax) {
      const theirState = e.supplierGstin?.slice(0, 2);
      if (!india || (theirState && ownState)) {
        taxLines = taxEntries(tax, Boolean(theirState && theirState !== ownState), false, "Input", true, ["Tax"]);
      } else {
        taxLines = [{ ledger: add({ name: "Input GST (to split)", parent: "Duties & Taxes" }), minor: tax, debit: true }];
        notes.push(`The ${e.supplier} bill of ${e.date} has no supplier GSTIN, so its GST is in "Input GST (to split)".`);
      }
    }

    vouchers.push({
      type: "Purchase", id: e.id, date: e.date, number, party: supplier, reference,
      narration: [e.description, e.reference ? `Bill ${e.reference}` : ""].filter(Boolean).join(" - ") || `Bill from ${e.supplier}`,
      entries: [
        { ledger: supplier, minor: net + tax, debit: false, bill: { name: reference, type: "New Ref" } },
        { ledger: add(expenseLedger(e.category)), minor: net, debit: true },
        ...taxLines
      ]
    });

    if (e.paidFrom) {
      const tds = conv(e.tdsMinor ?? 0);
      const paid = net + tax - tds;
      vouchers.push({
        type: "Payment", id: `${e.id}-p`, date: e.date, number: `PAY-${tallyDate(e.date)}-${i + 1}`, party: supplier,
        narration: `Paid ${e.supplier}${tds ? `, tax of ${amount(tds)} held back` : ""}`,
        entries: [
          { ledger: supplier, minor: net + tax, debit: true, bill: { name: reference, type: "Agst Ref" } },
          { ledger: add(cashLedger(e.paidFrom)), minor: paid, debit: false },
          ...(tds ? [{ ledger: add({ name: TDS_PAYABLE, parent: "Duties & Taxes" }), minor: tds, debit: false }] : [])
        ]
      });
    }
  });

  // Every voucher must balance, or Tally refuses it. Any that does not is left out and named.
  const balanced = vouchers.filter((v) => {
    const net = v.entries.reduce((s, en) => s + (en.debit ? en.minor : -en.minor), 0);
    if (net !== 0) notes.push(`${v.type} ${v.number} did not balance (${amount(net)}), so it was left out.`);
    return net === 0;
  }).map((v) => ({ ...v, entries: v.entries.filter((en) => en.minor !== 0) }));

  const count = (t: Voucher["type"]) => balanced.filter((v) => v.type === t).length;
  return {
    masters: mastersXml([...ledgers.values()], india),
    vouchers: vouchersXml(balanced),
    counts: {
      sales: count("Sales"), creditNotes: count("Credit Note"), receipts: count("Receipt"),
      purchases: count("Purchase"), payments: count("Payment"), ledgers: ledgers.size
    },
    notes: [...new Set(notes)]
  };
}

/* ------------------------------------------------------------------- XML */

const envelope = (report: "All Masters" | "Vouchers", body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${report}</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${body}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;

function mastersXml(ledgers: Ledger[], india: boolean): string {
  const body = ledgers.map((l) => {
    const lines: string[] = [
      `<LEDGER NAME="${xml(l.name)}" ACTION="Create">`,
      `  <NAME.LIST TYPE="String"><NAME>${xml(l.name)}</NAME></NAME.LIST>`,
      `  <PARENT>${xml(l.parent)}</PARENT>`
    ];
    if (l.parent === "Sundry Debtors" || l.parent === "Sundry Creditors") {
      lines.push("  <ISBILLWISEON>Yes</ISBILLWISEON>");
      const address = (l.party?.address ?? "").split("\n").map((a) => a.trim()).filter(Boolean);
      if (address.length) {
        lines.push(`  <ADDRESS.LIST TYPE="String">${address.map((a) => `<ADDRESS>${xml(a)}</ADDRESS>`).join("")}</ADDRESS.LIST>`);
        const pin = (l.party?.address ?? "").match(/\b(\d{6})\b/)?.[1];
        if (pin && india) lines.push(`  <PINCODE>${pin}</PINCODE>`);
      }
      if (india) {
        const state = stateByRegion(l.party?.region);
        const foreign = l.party?.country && l.party.country.toUpperCase() !== "IN";
        lines.push(`  <COUNTRYNAME>${foreign ? xml(l.party!.country!) : "India"}</COUNTRYNAME>`);
        if (state && !foreign) lines.push(`  <LEDSTATENAME>${xml(state.name)}</LEDSTATENAME>`);
        const gstin = (l.party?.gstin ?? "").trim().toUpperCase();
        if (/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
          lines.push("  <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>", `  <PARTYGSTIN>${gstin}</PARTYGSTIN>`);
        } else {
          lines.push(`  <GSTREGISTRATIONTYPE>${foreign ? "Unknown" : "Unregistered/Consumer"}</GSTREGISTRATIONTYPE>`);
        }
      }
    }
    if (l.gstHead) lines.push("  <TAXTYPE>GST</TAXTYPE>", `  <GSTDUTYHEAD>${l.gstHead}</GSTDUTYHEAD>`);
    else if (l.parent === "Duties & Taxes") lines.push(`  <TAXTYPE>${india && !l.name.startsWith("TDS") ? "GST" : "Others"}</TAXTYPE>`);
    lines.push("</LEDGER>");
    return `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n${lines.map((x) => `          ${x}`).join("\n")}\n        </TALLYMESSAGE>`;
  }).join("\n");
  return envelope("All Masters", body);
}

function vouchersXml(vouchers: Voucher[]): string {
  const body = vouchers.map((v) => {
    const entries = v.entries.map((en) => {
      const signed = en.debit ? -en.minor : en.minor;
      const isParty = en.ledger === v.party;
      return [
        "  <ALLLEDGERENTRIES.LIST>",
        `    <LEDGERNAME>${xml(en.ledger)}</LEDGERNAME>`,
        `    <ISDEEMEDPOSITIVE>${en.debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
        ...(isParty ? ["    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>"] : []),
        `    <AMOUNT>${amount(signed)}</AMOUNT>`,
        ...(en.bill ? [
          "    <BILLALLOCATIONS.LIST>",
          `      <NAME>${xml(en.bill.name)}</NAME>`,
          `      <BILLTYPE>${en.bill.type}</BILLTYPE>`,
          `      <AMOUNT>${amount(signed)}</AMOUNT>`,
          "    </BILLALLOCATIONS.LIST>"
        ] : []),
        "  </ALLLEDGERENTRIES.LIST>"
      ].join("\n");
    }).join("\n");
    const lines = [
      // REMOTEID lets Tally recognise a voucher it already has when the same period is imported again.
      `<VOUCHER REMOTEID="nxone-${xml(v.id)}" VCHTYPE="${v.type}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
      `  <DATE>${tallyDate(v.date)}</DATE>`,
      `  <VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME>`,
      `  <VOUCHERNUMBER>${xml(v.number)}</VOUCHERNUMBER>`,
      ...(v.reference ? [`  <REFERENCE>${xml(v.reference)}</REFERENCE>`] : []),
      `  <PARTYLEDGERNAME>${xml(v.party)}</PARTYLEDGERNAME>`,
      `  <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>`,
      `  <NARRATION>${xml(v.narration)}</NARRATION>`,
      entries,
      "</VOUCHER>"
    ];
    return `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n${lines.join("\n").split("\n").map((x) => `          ${x}`).join("\n")}\n        </TALLYMESSAGE>`;
  }).join("\n");
  return envelope("Vouchers", body);
}

/* ------------------------------------------------------------ the folder */

export function tallyFiles(result: TallyResult, input: TallyInput): ZipEntry[] {
  const folder = `tally-${input.period.from}-to-${input.period.to}`;
  const c = result.counts;
  const readme = [
    `${input.profile.name || "This business"}: books for Tally, ${input.period.label ?? `${input.period.from} to ${input.period.to}`}`,
    "",
    "Import in this order, into the right company:",
    "1. Gateway of Tally > Import > Masters > 1-ledgers.xml",
    "   (choose \"Ignore duplicates\" if some ledgers are already there)",
    "2. Gateway of Tally > Import > Transactions > 2-vouchers.xml",
    "",
    `What is in it: ${c.sales} sales, ${c.creditNotes} credit notes, ${c.receipts} receipts, ${c.purchases} purchases, ${c.payments} payments, using ${c.ledgers} ledgers.`,
    "Vouchers are in accounting view, without stock items. Customers and suppliers are bill-wise, so receipts and payments are matched to their invoices and bills.",
    "",
    ...(result.notes.length ? ["Please check:", ...result.notes.map((n) => `- ${n}`)] : ["Nothing was left out."]),
    "",
    "Prepared with NXOne (nxone.io)."
  ].join("\r\n");
  return [
    { name: `${folder}/1-ledgers.xml`, text: result.masters },
    { name: `${folder}/2-vouchers.xml`, text: result.vouchers },
    { name: `${folder}/read-me.txt`, text: readme }
  ];
}
