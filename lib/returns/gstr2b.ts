/**
 * Reading GSTR-2B, the government's monthly statement of the credit you are allowed.
 *
 * This is the one piece of GST work that cannot be derived from your own records, because it is
 * about somebody else's behaviour: your supplier charged you tax, and you can only claim it back
 * if they actually filed. Every month some of them have not, and the credit silently is not
 * there. Finding that out in March, for April, is how businesses lose real money.
 *
 * The file comes off the portal as JSON. Two things in it catch people out, and both are handled
 * here: `val` is the whole invoice including tax, not the taxable value; and credit notes sit in
 * a separate section and have to count the other way.
 *
 * Built to the published schema rather than to a file from your own portal login, so the parser
 * is deliberately forgiving: it reads what it recognises, counts what it could not, and says so,
 * instead of quietly producing a zero.
 */

export interface TwoBInvoice {
  supplierGstin: string;
  supplierName: string;
  number: string;
  date: string;
  /** Negative for a credit note, which reduces the credit you may claim. */
  taxableMinor: number;
  igstMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  cessMinor: number;
  totalTaxMinor: number;
  /** The whole invoice including tax, as the portal reports it. */
  valueMinor: number;
  /** "N" when the portal says this credit cannot be claimed, with a reason. */
  itcAvailable: boolean;
  itcReason?: string;
  kind: "invoice" | "credit-note";
}

export interface TwoBFile {
  gstin?: string;
  /** The return period the statement covers, as YYYY-MM. */
  period?: string;
  generatedOn?: string;
  invoices: TwoBInvoice[];
  /** Sections present in the file that this reader does not handle, so nothing looks complete when it is not. */
  skipped: Array<{ section: string; count: number; why: string }>;
}

export class NotATwoB extends Error {
  constructor(message: string) { super(message); this.name = "NotATwoB"; }
}

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : 0;
  return Number.isFinite(n) ? n : 0;
};

/** Rupees as the portal writes them, into the minor units used everywhere else. */
const minor = (value: unknown): number => Math.round(num(value) * 100);

/** The portal writes dates as DD-MM-YYYY. */
export function portalDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const parts = value.trim().split(/[-/]/);
  if (parts.length !== 3) return "";
  const [d, m, y] = parts;
  if (y.length !== 4) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** The return period is MMYYYY in the file, which reads backwards to everything else. */
export function portalPeriod(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{6}$/.test(value)) return undefined;
  return `${value.slice(2)}-${value.slice(0, 2)}`;
}

/**
 * The statement sits at a different depth depending on who handed you the file: straight from
 * the portal, or wrapped by whichever API your accountant's software used.
 */
function findDocData(parsed: unknown): { docdata: Record<string, unknown>; head: Record<string, unknown> } | undefined {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): { docdata: Record<string, unknown>; head: Record<string, unknown> } | undefined => {
    if (!node || typeof node !== "object" || depth > 4 || seen.has(node)) return undefined;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    if (obj.docdata && typeof obj.docdata === "object") {
      return { docdata: obj.docdata as Record<string, unknown>, head: obj };
    }
    for (const value of Object.values(obj)) {
      const found = walk(value, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return walk(parsed, 0);
}

/** Tax on an invoice, which different exports spell differently. */
function taxOf(row: Record<string, unknown>): { igst: number; cgst: number; sgst: number; cess: number } {
  return {
    igst: minor(row.igst ?? row.iamt),
    cgst: minor(row.cgst ?? row.camt),
    sgst: minor(row.sgst ?? row.samt),
    cess: minor(row.cess ?? row.csamt)
  };
}

/**
 * Taxable value. Taken from the line items when they are there, because that is the figure the
 * supplier declared; worked back from the invoice total when they are not. Never `val` itself:
 * that includes the tax, and treating it as the taxable value overstates every claim.
 */
function taxableOf(row: Record<string, unknown>, tax: { igst: number; cgst: number; sgst: number; cess: number }): number {
  const items = row.items ?? row.itms;
  if (Array.isArray(items) && items.length > 0) {
    const sum = items.reduce((total: number, item: unknown) => {
      const it = item as Record<string, unknown>;
      const detail = (it.itm_det ?? it) as Record<string, unknown>;
      return total + minor(detail.txval);
    }, 0);
    if (sum > 0) return sum;
  }
  return minor(row.val) - (tax.igst + tax.cgst + tax.sgst + tax.cess);
}

function readSection(
  rows: unknown,
  kind: "invoice" | "credit-note",
  listKey: "inv" | "nt"
): TwoBInvoice[] {
  if (!Array.isArray(rows)) return [];
  const out: TwoBInvoice[] = [];

  for (const entry of rows) {
    const supplier = entry as Record<string, unknown>;
    const gstin = String(supplier.ctin ?? "").trim().toUpperCase();
    const name = String(supplier.trdnm ?? "").trim();
    const list = supplier[listKey] ?? supplier.inv ?? supplier.nt;
    if (!Array.isArray(list)) continue;

    for (const item of list) {
      const row = item as Record<string, unknown>;
      const tax = taxOf(row);
      // A credit note reduces the credit available, so everything about it counts the other way.
      const sign = kind === "credit-note" ? -1 : 1;
      const taxable = taxableOf(row, tax);
      const totalTax = tax.igst + tax.cgst + tax.sgst + tax.cess;

      out.push({
        supplierGstin: gstin,
        supplierName: name,
        number: String(row.inum ?? row.nt_num ?? "").trim(),
        date: portalDate(row.dt ?? row.idt ?? row.nt_dt),
        taxableMinor: taxable * sign,
        igstMinor: tax.igst * sign,
        cgstMinor: tax.cgst * sign,
        sgstMinor: tax.sgst * sign,
        cessMinor: tax.cess * sign,
        totalTaxMinor: totalTax * sign,
        valueMinor: minor(row.val) * sign,
        itcAvailable: String(row.itcavl ?? "Y").toUpperCase() !== "N",
        itcReason: row.rsn ? String(row.rsn) : undefined,
        kind
      });
    }
  }
  return out;
}

/** Sections this reader does not handle, named rather than ignored. */
const UNHANDLED: Array<{ key: string; why: string }> = [
  { key: "isd", why: "credit passed down by an input service distributor" },
  { key: "impg", why: "goods imported through customs" },
  { key: "impgsez", why: "goods imported from an SEZ" },
  { key: "b2bur", why: "purchases from unregistered suppliers under reverse charge" }
];

export function readTwoB(text: string): TwoBFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NotATwoB("That file is not JSON. Download GSTR-2B from the portal as JSON, not as the Excel summary.");
  }

  const found = findDocData(parsed);
  if (!found) {
    throw new NotATwoB("That JSON does not look like a GSTR-2B: it has no document section in it. Check you downloaded GSTR-2B and not GSTR-2A or GSTR-1.");
  }

  const { docdata, head } = found;
  const invoices = [
    ...readSection(docdata.b2b, "invoice", "inv"),
    ...readSection(docdata.b2ba, "invoice", "inv"),
    ...readSection(docdata.cdnr, "credit-note", "nt"),
    ...readSection(docdata.cdnra, "credit-note", "nt")
  ];

  const skipped = UNHANDLED
    .map(({ key, why }) => {
      const section = docdata[key];
      const count = Array.isArray(section) ? section.length : 0;
      return { section: key.toUpperCase(), count, why };
    })
    .filter((s) => s.count > 0);

  return {
    gstin: typeof head.gstin === "string" ? head.gstin : undefined,
    period: portalPeriod(head.rtnprd),
    generatedOn: portalDate(head.gendt) || undefined,
    invoices,
    skipped
  };
}

/* ------------------------------------------------------------------ matching */

/**
 * Invoice numbers are typed by two different people in two different systems, so they are
 * compared with the punctuation and padding taken out. INV/2026/0012 and inv-2026-12 are the
 * same invoice, and pretending otherwise produces a reconciliation full of false alarms.
 */
export const numberKey = (value: string): string =>
  (value.toUpperCase().match(/[A-Z]+|\d+/g) ?? [])
    // Each run of digits loses its padding on its own. Stripping zeros after the separators are
    // gone cannot be done safely: by then nothing says where one part ended and the next began.
    .map((run) => (/^\d+$/.test(run) ? String(Number(run)) : run))
    .join("");

export const invoiceKey = (gstin: string, number: string): string =>
  `${gstin.trim().toUpperCase()}|${numberKey(number)}`;

export interface PurchaseRecord {
  id: string;
  date: string;
  supplier: string;
  supplierGstin?: string;
  reference?: string;
  netMinor: number;
  taxMinor: number;
}

export type MatchState =
  | "matched"
  | "different-amount"
  | "only-on-the-portal"
  | "credit-note-not-recorded"
  | "only-in-your-books"
  | "cannot-be-claimed"
  | "no-gstin";

export interface MatchRow {
  state: MatchState;
  supplier: string;
  supplierGstin?: string;
  number: string;
  date: string;
  /** Tax the portal says is available, in minor units. */
  portalTaxMinor?: number;
  /** Tax recorded in your own books. */
  booksTaxMinor?: number;
  differenceMinor?: number;
  purchaseId?: string;
  /** What to do about it, in a sentence. */
  advice: string;
}

export interface Reconciliation {
  rows: MatchRow[];
  /** Credit the portal allows this period. */
  availableMinor: number;
  /** Credit your books have claimed against purchases that appear on the portal. */
  claimedMinor: number;
  /** Tax on purchases your suppliers have not filed: at risk until they do. */
  atRiskMinor: number;
  /** Credit on the portal that you have not recorded at all: yours to claim once entered. */
  unrecordedMinor: number;
  /** Credit notes on the portal that your books do not have: your claim must come down by this. */
  creditNotesMinor: number;
  counts: Record<MatchState, number>;
  /** Suppliers worth a message, worst first. */
  chase: Array<{ supplier: string; gstin?: string; missing: number; taxMinor: number }>;
}

/** A rupee of difference is rounding between two systems, not a discrepancy worth a letter. */
const TOLERANCE_MINOR = 100;

export function reconcile(portal: TwoBInvoice[], books: PurchaseRecord[]): Reconciliation {
  const byKey = new Map<string, PurchaseRecord>();
  const noGstin: PurchaseRecord[] = [];
  for (const record of books) {
    if (!record.supplierGstin || !record.reference) { noGstin.push(record); continue; }
    byKey.set(invoiceKey(record.supplierGstin, record.reference), record);
  }

  const rows: MatchRow[] = [];
  const used = new Set<string>();

  for (const entry of portal) {
    const key = invoiceKey(entry.supplierGstin, entry.number);
    const match = byKey.get(key);
    const common = {
      supplier: entry.supplierName || match?.supplier || "Unnamed supplier",
      supplierGstin: entry.supplierGstin,
      number: entry.number,
      date: entry.date,
      portalTaxMinor: entry.totalTaxMinor
    };

    if (!entry.itcAvailable) {
      if (match) used.add(key);
      rows.push({
        ...common, state: "cannot-be-claimed", purchaseId: match?.id, booksTaxMinor: match?.taxMinor,
        advice: entry.itcReason
          ? `The portal says this credit cannot be claimed: ${entry.itcReason}. Do not include it in your 3B.`
          : "The portal marks this credit as not available. Do not include it in your 3B."
      });
      continue;
    }

    if (!match) {
      // A credit note nobody recorded is the opposite of a bill nobody recorded: it takes credit
      // away rather than offering it. Telling somebody to "claim it" would be telling them to
      // claim a negative amount, which is how an overclaim gets made in good faith.
      rows.push(entry.kind === "credit-note"
        ? {
            ...common, state: "credit-note-not-recorded",
            advice: "Your supplier has raised a credit note against you that is not in your books. Your claim has to come down by this much - record it against that supplier before you file."
          }
        : {
            ...common, state: "only-on-the-portal",
            advice: "Your supplier has filed this but you have not recorded the bill. Enter it and the credit is yours to claim."
          });
      continue;
    }

    used.add(key);
    const difference = entry.totalTaxMinor - match.taxMinor;
    if (Math.abs(difference) <= TOLERANCE_MINOR) {
      rows.push({ ...common, state: "matched", purchaseId: match.id, booksTaxMinor: match.taxMinor, differenceMinor: 0, advice: "Agreed with the portal." });
    } else {
      rows.push({
        ...common, state: "different-amount", purchaseId: match.id, booksTaxMinor: match.taxMinor, differenceMinor: difference,
        advice: difference < 0
          ? "Your books claim more tax than the portal allows. Claiming the larger figure is what triggers a notice - check the bill, then ask your supplier to correct their filing."
          : "The portal shows more tax than your books recorded. Check the bill: you may be claiming less than you are entitled to."
      });
    }
  }

  for (const record of books) {
    if (!record.supplierGstin || !record.reference) continue;
    const key = invoiceKey(record.supplierGstin, record.reference);
    if (used.has(key)) continue;
    rows.push({
      state: "only-in-your-books", supplier: record.supplier, supplierGstin: record.supplierGstin,
      number: record.reference, date: record.date, booksTaxMinor: record.taxMinor, purchaseId: record.id,
      advice: "Your supplier has not filed this. The credit is not available until they do - worth a message before the month closes."
    });
  }

  for (const record of noGstin) {
    // A purchase carrying no tax has no credit to match, so saying it "cannot be matched" would
    // be nagging about every cash expense in the month.
    if (record.taxMinor === 0) continue;
    rows.push({
      state: "no-gstin", supplier: record.supplier, number: record.reference ?? "", date: record.date,
      booksTaxMinor: record.taxMinor, purchaseId: record.id,
      advice: record.supplierGstin
        ? "This purchase has no bill number, so it cannot be matched. Add the supplier's invoice number."
        : "This purchase has no supplier GSTIN, so it cannot be matched. Add it to the expense."
    });
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1;
    return acc;
  }, {} as Record<MatchState, number>);
  for (const state of ["matched", "different-amount", "only-on-the-portal", "credit-note-not-recorded", "only-in-your-books", "cannot-be-claimed", "no-gstin"] as MatchState[]) {
    counts[state] = counts[state] ?? 0;
  }

  const sum = (predicate: (row: MatchRow) => boolean, pick: (row: MatchRow) => number | undefined) =>
    rows.filter(predicate).reduce((total, row) => total + (pick(row) ?? 0), 0);

  const chaseBySupplier = new Map<string, { supplier: string; gstin?: string; missing: number; taxMinor: number }>();
  for (const row of rows.filter((r) => r.state === "only-in-your-books")) {
    const key = row.supplierGstin ?? row.supplier;
    const entry = chaseBySupplier.get(key) ?? { supplier: row.supplier, gstin: row.supplierGstin, missing: 0, taxMinor: 0 };
    entry.missing += 1;
    entry.taxMinor += row.booksTaxMinor ?? 0;
    chaseBySupplier.set(key, entry);
  }

  return {
    rows,
    availableMinor: sum((r) => r.state !== "cannot-be-claimed" && r.state !== "only-in-your-books" && r.state !== "no-gstin", (r) => r.portalTaxMinor),
    creditNotesMinor: sum((r) => r.state === "credit-note-not-recorded", (r) => r.portalTaxMinor),
    claimedMinor: sum((r) => r.state === "matched" || r.state === "different-amount", (r) => r.booksTaxMinor),
    atRiskMinor: sum((r) => r.state === "only-in-your-books", (r) => r.booksTaxMinor),
    unrecordedMinor: sum((r) => r.state === "only-on-the-portal", (r) => r.portalTaxMinor),
    counts,
    chase: [...chaseBySupplier.values()].sort((a, b) => b.taxMinor - a.taxMinor)
  };
}

/** The message to the supplier who has not filed. Specific, dated, and easy to act on. */
export function chaseMessage(
  supplier: { supplier: string; gstin?: string; missing: number; taxMinor: number },
  rows: MatchRow[],
  from: string,
  period: string,
  money: (minor: number) => string,
  date: (iso: string) => string
): { subject: string; body: string } {
  const theirs = rows.filter((r) => r.state === "only-in-your-books" && (r.supplierGstin ?? r.supplier) === (supplier.gstin ?? supplier.supplier));
  const lines = theirs.map((r) => `  ${r.number}  ${date(r.date)}  ${money(r.booksTaxMinor ?? 0)} of GST`);

  return {
    subject: `GST credit not showing for ${period} - ${from}`,
    body: [
      `Hello,`,
      ``,
      `${theirs.length === 1 ? "An invoice" : `${theirs.length} invoices`} from you ${theirs.length === 1 ? "is" : "are"} not appearing in our GSTR-2B for ${period}, so we cannot claim the GST on ${theirs.length === 1 ? "it" : "them"}:`,
      ``,
      ...lines,
      ``,
      `That is ${money(supplier.taxMinor)} of credit held up. Could you check whether ${theirs.length === 1 ? "it was" : "they were"} included in your GSTR-1 for the period? If it was filed late it may appear next month, and a note either way would help us close our books.`,
      ``,
      `Thanks,`,
      from
    ].join("\n")
  };
}
