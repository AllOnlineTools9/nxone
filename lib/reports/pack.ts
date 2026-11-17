import { trialBalance, type JournalEntry } from "../ledger/journal";
import { balanceSheet, cashFlow, profitAndLoss } from "../ledger/statements";
import { accountByCode } from "../ledger/accounts";
import { formatMoney, fromMinor, toMajor } from "../money";
import { formatDate } from "../format";
import type { Expense, SavedDocument } from "../store/types";
import type { Period } from "../store/reports";
import type { ZipEntry } from "../files/zip";
import { calculate } from "../documents/totals";

/**
 * The books for a period, as a folder an accountant can open.
 *
 * The person using NXOne is not the only person who needs their accounts: at some point a CA,
 * a bookkeeper or a bank manager has to read them, and that person does not have NXOne, will not
 * install it, and wants figures they can tie up in a spreadsheet. Until now they had to be walked
 * through four screens and four downloads.
 *
 * So: one folder, in CSV, which every accounting package on earth imports; a covering note that
 * says what period it covers and how it was prepared; and the documents behind the totals, so a
 * figure that looks wrong can be traced to the invoice that caused it rather than argued about.
 */

export interface PackInput {
  businessName: string;
  taxId?: string;
  country: string;
  currency: string;
  period: Period;
  entries: JournalEntry[];
  documents: SavedDocument[];
  expenses: Expense[];
  /** Written on the covering note, so nobody has to guess when it was taken. */
  preparedOn: string;
}

const esc = (value: string | number | undefined): string => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csv = (rows: Array<Array<string | number | undefined>>): string =>
  rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";

/** Accountants reconcile in spreadsheets, so money goes out as a plain number, not ₹1,234.00. */
const plain = (minor: number, currency: string): string => toMajor(fromMinor(minor, currency)).toFixed(2);

const inPeriod = (date: string, period: Period) => date >= period.from && date <= period.to;

export function profitAndLossCsv(entries: JournalEntry[], input: PackInput): string {
  const pl = profitAndLoss(entries, input.currency, input.period.from, input.period.to);
  const rows: Array<Array<string | number>> = [["Account code", "Account", "Amount"]];
  for (const row of pl.income) rows.push([row.code, row.name, plain(row.balance.minor, input.currency)]);
  rows.push(["", "Total income", plain(pl.totalIncome.minor, input.currency)]);
  rows.push([]);
  for (const row of pl.expenses) rows.push([row.code, row.name, plain(row.balance.minor, input.currency)]);
  rows.push(["", "Total expenses", plain(pl.totalExpenses.minor, input.currency)]);
  rows.push([]);
  rows.push(["", "Net profit", plain(pl.netProfit.minor, input.currency)]);
  return csv(rows);
}

export function balanceSheetCsv(entries: JournalEntry[], input: PackInput): string {
  const bs = balanceSheet(entries, input.currency, input.period.to);
  const rows: Array<Array<string | number>> = [["Section", "Account code", "Account", "Amount"]];
  const section = (name: string, list: typeof bs.assets) => {
    for (const row of list) rows.push([name, row.code, row.name, plain(row.balance.minor, input.currency)]);
  };
  section("Assets", bs.assets);
  rows.push(["Assets", "", "Total assets", plain(bs.totalAssets.minor, input.currency)]);
  section("Liabilities", bs.liabilities);
  rows.push(["Liabilities", "", "Total liabilities", plain(bs.totalLiabilities.minor, input.currency)]);
  section("Equity", bs.equity);
  rows.push(["Equity", "", "Profit for the period", plain(bs.retained.minor, input.currency)]);
  rows.push(["Equity", "", "Total equity", plain(bs.totalEquity.minor, input.currency)]);
  return csv(rows);
}

export function trialBalanceCsv(entries: JournalEntry[], input: PackInput): string {
  const tb = trialBalance(entries, input.currency, input.period.to);
  const rows: Array<Array<string | number>> = [["Account code", "Account", "Type", "Debit", "Credit"]];
  for (const row of tb.rows) {
    rows.push([row.code, row.name, row.type, plain(row.debit.minor, input.currency), plain(row.credit.minor, input.currency)]);
  }
  rows.push(["", "Total", "", plain(tb.debit.minor, input.currency), plain(tb.credit.minor, input.currency)]);
  return csv(rows);
}

/** Every posting behind the totals, which is what gets asked for when a figure is queried. */
export function journalCsv(entries: JournalEntry[], input: PackInput): string {
  const rows: Array<Array<string | number>> = [["Date", "Reference", "Narration", "Account code", "Account", "Memo", "Debit", "Credit"]];
  for (const e of entries.filter((x) => inPeriod(x.date, input.period)).sort((a, b) => a.date.localeCompare(b.date))) {
    for (const line of e.lines) {
      rows.push([
        e.date, e.source.number ?? "", e.narration, line.account,
        accountByCode(line.account)?.name ?? "", line.memo ?? "",
        line.debit ? plain(line.debit, input.currency) : "",
        line.credit ? plain(line.credit, input.currency) : ""
      ]);
    }
  }
  return csv(rows);
}

export function salesCsv(input: PackInput): string {
  const rows: Array<Array<string | number>> = [
    ["Date", "Number", "Kind", "Customer", "Place of supply", "Taxable", "Tax", "Total", "Paid", "Outstanding", "Status"]
  ];
  for (const d of input.documents.filter((x) => inPeriod(x.issueDate, input.period)).sort((a, b) => a.issueDate.localeCompare(b.issueDate))) {
    const totals = calculate(d.doc);
    rows.push([
      d.issueDate, d.number, d.kind, d.clientName, d.doc.placeOfSupply ?? "",
      plain(totals.taxableTotal.minor, d.currency), plain(totals.taxTotal.minor, d.currency), plain(d.totalMinor, d.currency),
      plain(d.paidMinor, d.currency), plain(d.totalMinor - d.paidMinor, d.currency), d.status
    ]);
  }
  return csv(rows);
}

export function expensesCsv(input: PackInput): string {
  const rows: Array<Array<string | number>> = [["Date", "Supplier", "Description", "Account code", "Account", "Net", "Tax", "Total", "Paid from", "Reference"]];
  for (const e of input.expenses.filter((x) => inPeriod(x.date, input.period)).sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([
      e.date, e.supplier, e.description ?? "", e.category, accountByCode(e.category)?.name ?? "",
      plain(e.netMinor, e.currency), plain(e.taxMinor, e.currency), plain(e.netMinor + e.taxMinor, e.currency),
      e.paidFrom ? accountByCode(e.paidFrom)?.name ?? e.paidFrom : "unpaid", e.reference ?? ""
    ]);
  }
  return csv(rows);
}

/** The covering note, which is the only part a person reads rather than imports. */
export function coveringNote(input: PackInput): string {
  const pl = profitAndLoss(input.entries, input.currency, input.period.from, input.period.to);
  const bs = balanceSheet(input.entries, input.currency, input.period.to);
  const cf = cashFlow(input.entries, input.currency, input.period.from, input.period.to);
  const money = (minor: number) => formatMoney(fromMinor(minor, input.currency));
  const outstanding = input.documents
    .filter((d) => d.kind === "invoice" && d.status !== "cancelled" && d.issueDate <= input.period.to)
    .reduce((sum, d) => sum + (d.totalMinor - d.paidMinor), 0);

  return [
    `${input.businessName}`,
    input.taxId ? `${input.country === "IN" ? "GSTIN" : "Tax ID"}: ${input.taxId}` : "",
    `Books for ${formatDate(input.period.from, input.country)} to ${formatDate(input.period.to, input.country)}`,
    `Prepared ${formatDate(input.preparedOn, input.country)}. All figures in ${input.currency}.`,
    "",
    "THE SHORT VERSION",
    `  Income            ${money(pl.totalIncome.minor)}`,
    `  Expenses          ${money(pl.totalExpenses.minor)}`,
    `  Net profit        ${money(pl.netProfit.minor)}`,
    `  Cash at the end   ${money(cf.closing.minor)}`,
    `  Owed to us        ${money(outstanding)} (at ${formatDate(input.period.to, input.country)})`,
    "",
    "WHAT IS IN THIS FOLDER",
    "  profit-and-loss.csv   income and expenses for this period only",
    "  balance-sheet.csv     what is owned and owed at the end of it",
    "  trial-balance.csv     every account as at the end, earlier periods included",
    "  journal.csv           every posting in this period, behind those totals",
    "  sales.csv             the documents issued in this period, one row each",
    "  expenses.csv          what was spent in this period, with its account code",
    "",
    "  The trial balance and the balance sheet are cumulative, as they should be; the profit",
    "  and loss covers this period alone. So the sales figure in the trial balance will be",
    "  larger than the income above whenever the business traded before this period.",
    "",
    "HOW THESE WERE PREPARED",
    "  Double entry, posted from the documents and expenses recorded in NXOne. Nothing here is",
    "  a stored balance: every figure is derived from the entries in journal.csv, so the journal",
    "  and the statements cannot disagree.",
    bs.balanced
      ? "  The balance sheet balances."
      : "  NOTE: the balance sheet does not balance. Something is missing - please look at journal.csv.",
    "",
    "  Prepared by the business, not by an accountant, and not reviewed by one. Opening balances",
    "  are whatever was entered when the books were started. Please check these before filing",
    "  anything on them."
  ].filter((line) => line !== "").join("\n") + "\n";
}

/** The folder, ready to be zipped. */
export function packFiles(input: PackInput): ZipEntry[] {
  const folder = `${input.businessName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "books"}-${input.period.from.slice(0, 7)}`;
  const at = (name: string) => `${folder}/${name}`;
  return [
    { name: at("README.txt"), text: coveringNote(input) },
    { name: at("profit-and-loss.csv"), text: profitAndLossCsv(input.entries, input) },
    { name: at("balance-sheet.csv"), text: balanceSheetCsv(input.entries, input) },
    { name: at("trial-balance.csv"), text: trialBalanceCsv(input.entries, input) },
    { name: at("journal.csv"), text: journalCsv(input.entries, input) },
    { name: at("sales.csv"), text: salesCsv(input) },
    { name: at("expenses.csv"), text: expensesCsv(input) }
  ];
}

export function packFileName(input: PackInput): string {
  const who = input.businessName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "books";
  return `${who}-books-${input.period.from.slice(0, 7)}.zip`;
}

/* ------------------------------------------------------ the note that goes with it */

export interface PackMessage { subject: string; body: string; short: string }

/**
 * What to say to the accountant. Figures in the message as well as the files, because an
 * accountant reading on a phone should be able to see whether anything looks wrong before
 * opening a single attachment.
 */
export function packMessage(input: PackInput, locale = "en-IN"): PackMessage {
  const pl = profitAndLoss(input.entries, input.currency, input.period.from, input.period.to);
  const money = (minor: number) => formatMoney(fromMinor(minor, input.currency), locale);
  const from = formatDate(input.period.from, input.country);
  const to = formatDate(input.period.to, input.country);
  const label = input.period.label ?? `${from} to ${to}`;

  const body = [
    `Hello,`,
    ``,
    `Here are the books for ${input.businessName} for ${label}.`,
    ``,
    `Income ${money(pl.totalIncome.minor)}, expenses ${money(pl.totalExpenses.minor)}, net profit ${money(pl.netProfit.minor)}.`,
    ``,
    `The folder has the profit and loss, the balance sheet, the trial balance, the journal and the documents behind them, all as CSV. The covering note inside says how they were prepared.`,
    ``,
    `Please tell me if anything looks wrong or if you need something that is not there.`,
    ``,
    `Thanks,`,
    input.businessName
  ].join("\n");

  return {
    subject: `${input.businessName} - books for ${label}`,
    body,
    short: `Books for ${input.businessName}, ${label}. Net profit ${money(pl.netProfit.minor)}. Sending the folder now.`
  };
}
