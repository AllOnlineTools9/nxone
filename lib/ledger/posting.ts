import { carryingValue, depreciationEntries, type AssetInput } from "../assets/depreciate";
import { calculate } from "../documents/totals";
import { todayIso } from "../format";
import type { DocumentData } from "../documents/types";
import { convertMinor, rateFor, usableRate } from "../fx";
import { keepingStock, stockFrom, type StockItem, type StockMove } from "../stock/ledger";
import type { Expense, SavedDocument } from "../store/types";
import { entry, totalCredits, totalDebits, type JournalEntry, type JournalLine } from "./journal";

/**
 * Turning what a business does into what accountants record. A sale debits what the customer owes
 * and credits income plus the tax you now hold for the government. A payment moves the debt into
 * the bank. An expense is the mirror image.
 *
 * Nobody using NXOne has to know any of this, which is rather the point.
 */

export interface PaymentInput {
  id?: string;
  date: string;
  amountMinor: number;
  currency: string;
  /** Which cash account it landed in. */
  account: string;
  reference?: string;
  documentNumber?: string;
  /**
   * Set when the money arrived in another currency. `rate` is what it was worth on the day it
   * landed; `invoiceRate` is what it was worth when the invoice was raised. The gap between the
   * two is a real gain or loss, and it is posted as one rather than quietly absorbed.
   */
  fx?: Fx & { invoiceRate?: number };
}

/** An asset, as the books need it. */
export interface AssetForBooks extends AssetInput {
  /** Where the money came from, when it was not bought on a bill already in the books. */
  paidFrom?: string;
  expenseId?: string;
}

export interface ExpenseInput {
  /** Tax held back from the supplier, owed to the government rather than paid out. */
  tdsMinor?: number;
  tdsSection?: string;
  id?: string;
  date: string;
  supplier: string;
  description?: string;
  /** Expense account code from the chart. */
  category: string;
  currency: string;
  /** What the expense cost before any reclaimable tax. */
  netMinor: number;
  /** Tax you can reclaim, where the rules allow it. Zero when you cannot. */
  taxMinor?: number;
  /** Paid now from an account, or left owing to the supplier. */
  paidFrom?: string;
  /** What one unit of this bill's currency was worth in the books' currency on the day. */
  fxRate?: number;
  /** How many arrived, when the bill is a purchase of stock rather than a cost of the month. */
  stockQuantity?: number;
}

/** Where a document was written in one currency and the books are kept in another. */
export interface Fx {
  /** The currency the books are kept in. */
  base: string;
  /** What one unit of the document's currency was worth in it. */
  rate: number;
}

/**
 * The same entry, in the books' currency.
 *
 * Each amount is converted on its own, which can leave the entry a minor unit or two out of
 * balance — convert a total and its parts separately and the parts need not add back up. Rather
 * than let that through, or silently round the receivable (which is what the customer actually
 * owes, and must be exact), the difference is given to the anchor line: income on a sale, the
 * cost itself on a bill. That is where a rounding difference belongs.
 */
function inBase(lines: JournalLine[], from: string, fx: Fx, anchor: string): JournalLine[] {
  const out = lines.map((l) => ({
    ...l,
    debit: l.debit === undefined ? undefined : convertMinor(l.debit, from, fx.base, fx.rate),
    credit: l.credit === undefined ? undefined : convertMinor(l.credit, from, fx.base, fx.rate)
  }));

  const drift = totalDebits(out) - totalCredits(out);
  if (drift !== 0) {
    const target = out.find((l) => l.account === anchor);
    if (target) {
      if (target.credit !== undefined) target.credit += drift;
      else if (target.debit !== undefined) target.debit -= drift;
    }
  }
  return out;
}

/** A sale: the customer owes you, you have earned income, and you hold tax for the government. */
export function postInvoice(doc: DocumentData, savedId?: string, fx?: Fx): JournalEntry {
  const t = calculate(doc);
  const cur = doc.currency;
  const lines = [
    { account: "1200", debit: t.total.minor, memo: doc.buyer.name || "Customer" },
    { account: "4000", credit: t.taxableTotal.minor, memo: doc.number }
  ];

  if (t.taxTotal.minor > 0) lines.push({ account: "2100", credit: t.taxTotal.minor, memo: `Tax on ${doc.number}` });
  if (t.shipping.minor > 0) {
    // shipping is income too, and was already inside the total
    lines[1] = { account: "4000", credit: t.taxableTotal.minor + t.shipping.minor, memo: doc.number };
  }
  if (t.roundOff.minor !== 0) {
    const r = t.roundOff.minor;
    lines.push(r > 0 ? { account: "4100", credit: r, memo: "Rounding" } : { account: "6900", debit: -r, memo: "Rounding" });
  }

  const foreign = fx && fx.base !== cur;
  return entry({
    date: doc.issueDate,
    narration: `${doc.number} to ${doc.buyer.name || "customer"}`,
    currency: foreign ? fx.base : cur,
    lines: foreign ? inBase(lines, cur, fx, "4000") : lines,
    source: { kind: "invoice", id: savedId, number: doc.number },
    ...(foreign ? { original: { currency: cur, rate: fx.rate, totalMinor: t.total.minor } } : {})
  });
}

/**
 * Money arriving against an invoice: the debt shrinks and the bank grows.
 *
 * In another currency those two are not the same number. The debt comes off at the rate the
 * invoice was raised at, because that is what was put on the books; the bank goes up at the rate
 * the money actually arrived at. What is left over is an exchange gain or loss, which is money
 * the business genuinely made or lost by being paid later.
 */
export function postPayment(input: PaymentInput): JournalEntry {
  const fx = input.fx;
  if (fx && fx.base !== input.currency) {
    const invoiceRate = usableRate(fx.invoiceRate) ? fx.invoiceRate : fx.rate;
    const arrived = convertMinor(input.amountMinor, input.currency, fx.base, fx.rate);
    const owed = convertMinor(input.amountMinor, input.currency, fx.base, invoiceRate);
    const difference = arrived - owed;

    return entry({
      date: input.date,
      narration: `Payment received${input.documentNumber ? ` for ${input.documentNumber}` : ""}`,
      currency: fx.base,
      lines: [
        { account: input.account, debit: arrived, memo: input.reference },
        { account: "1200", credit: owed, memo: input.documentNumber },
        ...(difference > 0 ? [{ account: "4300", credit: difference, memo: `Exchange on ${input.documentNumber ?? "payment"}` }] : []),
        ...(difference < 0 ? [{ account: "6950", debit: -difference, memo: `Exchange on ${input.documentNumber ?? "payment"}` }] : [])
      ],
      source: { kind: "payment", id: input.id, number: input.documentNumber },
      original: { currency: input.currency, rate: fx.rate, totalMinor: input.amountMinor }
    });
  }

  return entry({
    date: input.date,
    narration: `Payment received${input.documentNumber ? ` for ${input.documentNumber}` : ""}`,
    currency: input.currency,
    lines: [
      { account: input.account, debit: input.amountMinor, memo: input.reference },
      { account: "1200", credit: input.amountMinor, memo: input.documentNumber }
    ],
    source: { kind: "payment", id: input.id, number: input.documentNumber }
  });
}

/** Something you bought: a cost, any reclaimable tax, and either cash out or a supplier owed. */
/**
 * An expense, narrowed to what the ledger needs.
 *
 * Written once because it has been written three times by hand, and each time a newly added
 * field was silently left behind — stock quantities once, tax deducted nearly a second time.
 * A field added to Expense now reaches the books everywhere or nowhere, which is a failure
 * somebody notices.
 */
export function toExpenseInput(e: {
  id: string; date: string; supplier: string; description?: string; category: string;
  currency: string; netMinor: number; taxMinor: number; paidFrom?: string;
  stockQuantity?: number; fxRate?: number; tdsMinor?: number; tdsSection?: string;
}): ExpenseInput {
  return {
    id: e.id, date: e.date, supplier: e.supplier, description: e.description, category: e.category,
    currency: e.currency, netMinor: e.netMinor, taxMinor: e.taxMinor, paidFrom: e.paidFrom,
    stockQuantity: e.stockQuantity, fxRate: e.fxRate, tdsMinor: e.tdsMinor, tdsSection: e.tdsSection
  };
}

/** A stored asset, narrowed to what the books need. Written once, for the same reason as above. */
export function toAssetForBooks(a: {
  id: string; name: string; classId: string; purchasedOn: string; costMinor: number;
  salvageMinor?: number; method?: "straight-line" | "written-down"; usefulLifeYears?: number;
  disposedOn?: string; disposalMinor?: number; expenseId?: string;
}): AssetForBooks {
  return {
    id: a.id, name: a.name, classId: a.classId, purchasedOn: a.purchasedOn, costMinor: a.costMinor,
    salvageMinor: a.salvageMinor, method: a.method, usefulLifeYears: a.usefulLifeYears,
    disposedOn: a.disposedOn, disposalMinor: a.disposalMinor, expenseId: a.expenseId
  };
}

export function postExpense(input: ExpenseInput, fx?: Fx): JournalEntry {
  const tax = input.taxMinor ?? 0;
  const gross = input.netMinor + tax;
  // Tax held back never leaves the business: the supplier is paid less, and the difference is
  // owed to the government until it is deposited. Treating it as cash paid out would overstate
  // what went out of the bank and hide a liability that carries interest.
  const held = Math.min(input.tdsMinor ?? 0, gross);
  const toSupplier = gross - held;
  const lines = [
    { account: input.category, debit: input.netMinor, memo: input.description || input.supplier },
    ...(tax > 0 ? [{ account: "1400", debit: tax, memo: "Reclaimable tax" }] : []),
    ...(held > 0 ? [{ account: "2430", credit: held, memo: `Tax deducted${input.tdsSection ? ` under ${input.tdsSection}` : ""}` }] : []),
    input.paidFrom
      ? { account: input.paidFrom, credit: toSupplier, memo: input.supplier }
      : { account: "2010", credit: toSupplier, memo: input.supplier }
  ];

  const foreign = fx && fx.base !== input.currency;
  return entry({
    date: input.date,
    narration: `${input.supplier}${input.description ? `: ${input.description}` : ""}`,
    currency: foreign ? fx.base : input.currency,
    lines: foreign ? inBase(lines, input.currency, fx, input.category) : lines,
    source: { kind: "expense", id: input.id },
    ...(foreign ? { original: { currency: input.currency, rate: fx.rate, totalMinor: gross } } : {})
  });
}

/** Paying a supplier you already owed. */
export function postBillPayment(input: PaymentInput): JournalEntry {
  return entry({
    date: input.date,
    narration: `Paid supplier${input.reference ? ` (${input.reference})` : ""}`,
    currency: input.currency,
    lines: [
      { account: "2010", debit: input.amountMinor, memo: input.reference },
      { account: input.account, credit: input.amountMinor }
    ],
    source: { kind: "payment", id: input.id }
  });
}

/**
 * The ledger for everything saved. Documents produce a sale entry, and whatever has been paid
 * against them produces a receipt entry, so the books follow the documents without double entry
 * of data by the user.
 */
/** What was in the bank before NXOne knew anything: money in, owner's capital out. */
export function postOpeningBalance(amountMinor: number, date: string, currency: string, account = "1020"): JournalEntry {
  return entry({
    date,
    narration: "Opening balance",
    currency,
    lines: [
      { account, debit: amountMinor },
      { account: "3000", credit: amountMinor }
    ],
    source: { kind: "opening" }
  });
}

/**
 * The ledger for everything saved, in the books' own currency.
 *
 * A document billed in another currency is converted at its own rate. One with no rate is left
 * out — there is no honest number to put in — but it is never left out quietly: `unrated` in
 * lib/fx lists exactly what is missing, and the screens ask for it. Leaving money out without
 * saying so is the one failure nobody would catch.
 */
export function ledgerFor(
  documents: SavedDocument[],
  expenses: ExpenseInput[],
  currency: string,
  opening?: { amountMinor: number; date: string },
  /**
   * Stock, when the business keeps any. Bills charged to the stock account have already been
   * posted as an asset by the loop below — this adds the other half: the cost of what was sold,
   * moving value off the shelf and into cost of sales in the month it left. Left out, the
   * accounts behave exactly as they did before stock existed, so nothing can be counted twice.
   */
  stock?: { items: StockItem[]; moves?: StockMove[] },
  /**
   * What the business owns. Left out, the accounts behave exactly as they did before assets
   * existed, so adding this cannot change anybody's books until they record one.
   */
  assets?: { list: AssetForBooks[]; today?: string }
): JournalEntry[] {
  const out: JournalEntry[] = [];
  const saved = documents;

  if (opening && opening.amountMinor > 0) {
    out.push(postOpeningBalance(opening.amountMinor, opening.date, currency));
  }

  for (const d of documents) {
    if (d.status === "draft" || d.status === "cancelled") continue;
    if (d.kind !== "invoice" && d.kind !== "proforma") continue;

    const rate = rateFor(d.currency, currency, saved, d.doc.fxRate);
    if (!rate) continue;
    const fx: Fx | undefined = rate.source === "same" ? undefined : { base: currency, rate: rate.rate };

    out.push(postInvoice(d.doc, d.id, fx));
    if (d.paidMinor > 0) {
      out.push(postPayment({
        id: `${d.id}-paid`,
        // The recorded day the money arrived. Records made before that was kept fall back to
        // the old guess, which is wrong in the same way it always was but no more so.
        date: d.paidOn ?? (d.status === "paid" ? d.updatedAt.slice(0, 10) : d.issueDate),
        amountMinor: Math.min(d.paidMinor, d.totalMinor),
        currency: d.currency,
        account: "1020",
        documentNumber: d.number,
        ...(fx ? { fx: { base: currency, rate: usableRate(d.paymentFxRate) ? d.paymentFxRate : rate.rate, invoiceRate: rate.rate } } : {})
      }));
    }
  }

  for (const e of expenses) {
    if (e.currency === currency) { out.push(postExpense(e)); continue; }
    if (!usableRate(e.fxRate)) continue;
    out.push(postExpense(e, { base: currency, rate: e.fxRate }));
  }

  if (stock && keepingStock(stock.items)) out.push(...costOfSalesEntries(stock.items, documents, expenses, stock.moves, currency));

  if (assets?.list.length) out.push(...assetEntries(assets.list, assets.today ?? todayIso(), currency));

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * What owning things does to the books: the purchase sits as an asset, wear is charged each
 * completed year, and a sale clears both the cost and the wear and leaves a gain or a loss.
 *
 * The purchase itself is only posted here when it did not arrive as a bill. An asset created
 * from an existing expense is already in the books through that bill, and posting it twice
 * would double the money that left the bank.
 */
function assetEntries(assets: AssetForBooks[], today: string, currency: string): JournalEntry[] {
  const out: JournalEntry[] = [];

  for (const asset of assets) {
    if (!asset.expenseId && asset.costMinor > 0) {
      out.push(entry({
        date: asset.purchasedOn,
        narration: `Bought ${asset.name}`,
        currency,
        source: { kind: "asset", id: asset.id },
        lines: [
          { account: "1700", debit: asset.costMinor, memo: asset.name },
          { account: asset.paidFrom ?? "2010", credit: asset.costMinor, memo: asset.name }
        ]
      }));
    }

    for (const charge of depreciationEntries([asset], today)) {
      out.push(entry({
        date: charge.date,
        narration: charge.narration,
        currency,
        source: { kind: "depreciation", id: charge.id },
        lines: [
          { account: "6500", debit: charge.amountMinor, memo: asset.name },
          { account: "1790", credit: charge.amountMinor, memo: asset.name }
        ]
      }));
    }

    if (asset.disposedOn && asset.disposedOn <= today) {
      const carrying = carryingValue({ ...asset, disposedOn: undefined }, asset.disposedOn);
      const wornDown = asset.costMinor - carrying;
      const proceeds = asset.disposalMinor ?? 0;
      const result = proceeds - carrying;

      out.push(entry({
        date: asset.disposedOn,
        narration: proceeds > 0 ? `Sold ${asset.name}` : `Scrapped ${asset.name}`,
        currency,
        source: { kind: "disposal", id: asset.id },
        lines: [
          ...(proceeds > 0 ? [{ account: asset.paidFrom ?? "1020", debit: proceeds, memo: asset.name }] : []),
          ...(wornDown > 0 ? [{ account: "1790", debit: wornDown, memo: `Wear written back on ${asset.name}` }] : []),
          { account: "1700", credit: asset.costMinor, memo: asset.name },
          ...(result > 0 ? [{ account: "4800", credit: result, memo: asset.name }] : []),
          ...(result < 0 ? [{ account: "6510", debit: -result, memo: asset.name }] : [])
        ]
      }));
    }
  }

  return out;
}

/**
 * One entry a month taking the cost of what was sold off the shelf.
 *
 * Monthly rather than per sale, because a shop makes hundreds of sales and a ledger nobody can
 * read is not a ledger. Each entry says which month it covers and can be traced back to the
 * stock screen, where every movement is listed.
 */
function costOfSalesEntries(
  items: StockItem[],
  documents: SavedDocument[],
  expenses: ExpenseInput[],
  extraMoves: StockMove[] | undefined,
  currency: string
): JournalEntry[] {
  const months = new Set<string>();
  for (const d of documents) {
    if (d.deletedAt || d.kind !== "invoice" || d.status === "draft" || d.status === "cancelled") continue;
    months.add(d.issueDate.slice(0, 7));
  }

  const bills = expenses as unknown as Parameters<typeof stockFrom>[0]["expenses"];

  const out: JournalEntry[] = [];
  for (const month of [...months].sort()) {
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
    const to = lastDay.toISOString().slice(0, 10);
    const cost = stockFrom({ items, documents, expenses: bills, extraMoves, from: `${month}-01`, to }).costOfSalesMinor;
    if (cost <= 0) continue;

    out.push(entry({
      date: to,
      narration: `Cost of what sold in ${month}`,
      currency,
      lines: [
        { account: "5000", debit: cost, memo: "Taken off the shelf" },
        { account: "1300", credit: cost }
      ],
      source: { kind: "stock", id: `cogs-${month}` }
    }));
  }
  return out;
}

/**
 * A month's payroll in the accounts.
 *
 * Salaries stop being a lump sum typed into an expense. The gross is the cost, what is held back
 * from it is money the business owes somebody else — the fund, the insurer, the tax department —
 * and only the net is owed to the person. The employer's own contributions are a separate cost,
 * because an employer who cannot see them does not know what their staff actually cost.
 *
 * Nothing is paid here. This records what is owed; paying it is its own entry, so the month can
 * be closed before the challans are.
 */
export function postPayroll(run: {
  month: string;
  totals: {
    grossMinor: number; netMinor: number;
    employeePfMinor: number; employerPfMinor: number; pensionMinor: number; edliMinor: number; pfAdminMinor: number;
    employeeEsiMinor: number; employerEsiMinor: number;
    professionalTaxMinor: number; taxDeductedMinor: number;
  };
}, currency: string): JournalEntry {
  const t = run.totals;
  const lastDay = new Date(Date.UTC(Number(run.month.slice(0, 4)), Number(run.month.slice(5, 7)), 0));
  const date = lastDay.toISOString().slice(0, 10);

  const employerPf = t.employerPfMinor + t.pensionMinor + t.edliMinor + t.pfAdminMinor;
  const employerContributions = employerPf + t.employerEsiMinor;

  const lines: JournalLine[] = [
    { account: "6020", debit: t.grossMinor, memo: "Salaries for the month" },
    ...(employerContributions > 0 ? [{ account: "6025", debit: employerContributions, memo: "Employer provident fund and insurance" }] : []),
    ...(t.employeePfMinor + employerPf > 0 ? [{ account: "2410", credit: t.employeePfMinor + employerPf }] : []),
    ...(t.employeeEsiMinor + t.employerEsiMinor > 0 ? [{ account: "2420", credit: t.employeeEsiMinor + t.employerEsiMinor }] : []),
    ...(t.taxDeductedMinor > 0 ? [{ account: "2430", credit: t.taxDeductedMinor }] : []),
    ...(t.professionalTaxMinor > 0 ? [{ account: "2440", credit: t.professionalTaxMinor }] : []),
    { account: "2400", credit: t.netMinor, memo: "Net pay owed to staff" }
  ];

  return entry({
    date,
    narration: `Payroll for ${run.month}`,
    currency,
    lines,
    source: { kind: "payroll", id: `payroll-${run.month}` }
  });
}
