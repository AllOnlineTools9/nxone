import { accountByCode } from "../ledger/accounts";
import { trialBalance, type JournalEntry } from "../ledger/journal";
import { balanceSheet, profitAndLoss } from "../ledger/statements";
import { accountLedger, accountsInUse, dayBook, receiptsAndPayments, tradingAndPL } from "../ledger/views";
import type { Sheet } from "../files/xlsx";
import type { Period } from "../store/reports";

/**
 * The whole set of books for a period as one Excel workbook: the statements, the trial balance,
 * the day book, receipts and payments, and a sheet for every account with its running balance.
 * Amounts are in rupees (major units) so Excel's own sums work on them.
 */
export function booksWorkbook(entries: JournalEntry[], currency: string, period: Period, business: string): Sheet[] {
  const r = (minor: number) => Math.round(minor) / 100;
  const title = `${business}, ${period.label ?? `${period.from} to ${period.to}`}`;
  const sheets: Sheet[] = [];

  const pl = profitAndLoss(entries, currency, period.from, period.to);
  sheets.push({
    name: "Profit and loss", widths: [40, 18], bold: [0, 1],
    rows: [[title], ["Account", "Amount"],
      ["Income"], ...pl.income.map((x) => [x.name, r(x.balance.minor)]), ["Total income", r(pl.totalIncome.minor)], [],
      ["Costs"], ...pl.expenses.map((x) => [x.name, r(x.balance.minor)]), ["Total costs", r(pl.totalExpenses.minor)], [],
      ["Net profit", r(pl.netProfit.minor)]]
  });

  const t = tradingAndPL(entries, currency, period.from, period.to);
  const twoSided = (dr: Array<{ name: string; amount: number }>, cr: Array<{ name: string; amount: number }>) => {
    const n = Math.max(dr.length, cr.length);
    return Array.from({ length: n }, (_, i) => [dr[i]?.name, dr[i] ? r(dr[i].amount) : null, cr[i]?.name, cr[i] ? r(cr[i].amount) : null]);
  };
  sheets.push({
    name: "Trading and P&L", widths: [34, 16, 34, 16], bold: [0, 1, 3 + Math.max(t.trading.debit.length, t.trading.credit.length) + 1],
    rows: [[title], ["Dr", "", "Cr", ""], ["Trading account"], ...twoSided(t.trading.debit, t.trading.credit), ["Total", r(t.trading.total), "Total", r(t.trading.total)], [],
      ["Profit and loss account"], ...twoSided(t.pl.debit, t.pl.credit), ["Total", r(t.pl.total), "Total", r(t.pl.total)]]
  });

  const bs = balanceSheet(entries, currency, period.to);
  sheets.push({
    name: "Balance sheet", widths: [40, 18], bold: [0, 1],
    rows: [[`${business}, as at ${period.to}`], ["Account", "Amount"],
      ["Assets"], ...bs.assets.map((x) => [x.name, r(x.balance.minor)]), ["Total assets", r(bs.totalAssets.minor)], [],
      ["Liabilities"], ...bs.liabilities.map((x) => [x.name, r(x.balance.minor)]), ["Total liabilities", r(bs.totalLiabilities.minor)], [],
      ["Capital"], ...bs.equity.map((x) => [x.name, r(x.balance.minor)]), ["Profit kept in the business", r(bs.retained.minor)], ["Total capital", r(bs.totalEquity.minor)]]
  });

  const tb = trialBalance(entries, currency, period.to);
  sheets.push({
    name: "Trial balance", widths: [10, 36, 16, 16], bold: [0],
    rows: [["Code", "Account", "Debit", "Credit"], ...tb.rows.map((x) => [x.code, x.name, r(x.debit.minor), r(x.credit.minor)]), ["", "Total", r(tb.debit.minor), r(tb.credit.minor)]]
  });

  const rp = receiptsAndPayments(entries, currency, period.from, period.to);
  sheets.push({
    name: "Receipts and payments", widths: [34, 16, 34, 16], bold: [0, 1],
    rows: [[title], ["Receipts", "", "Payments", ""],
      ["Opening cash and bank", r(rp.opening), null, null],
      ...twoSided(rp.receipts, rp.payments),
      [null, null, "Closing cash and bank", r(rp.closing)],
      ["Total", r(rp.opening + rp.totalReceipts), "Total", r(rp.totalPayments + rp.closing)]]
  });

  const day = dayBook(entries, currency, period.from, period.to);
  sheets.push({
    name: "Day book", widths: [12, 44, 32, 16, 16], bold: [0],
    rows: [["Date", "Narration", "Account", "Debit", "Credit"],
      ...day.flatMap((d) => d.lines.map((l, i) => [i === 0 ? d.date : null, i === 0 ? d.narration : null, l.memo ? `${l.name} (${l.memo})` : l.name, l.debit ? r(l.debit) : null, l.credit ? r(l.credit) : null]))]
  });

  for (const a of accountsInUse(entries, currency)) {
    const l = accountLedger(entries, a.code, currency, period.from, period.to);
    if (!l.rows.length && !l.opening) continue;
    sheets.push({
      name: `${a.code} ${accountByCode(a.code)?.name ?? ""}`, widths: [12, 44, 30, 16, 16, 18], bold: [0, 1],
      rows: [[`${l.name} (${a.code})`], ["Date", "Narration", "Against", "Debit", "Credit", "Balance"],
        [null, "Opening balance", null, null, null, r(l.opening)],
        ...l.rows.map((x) => [x.date, x.memo ? `${x.narration} (${x.memo})` : x.narration, x.against, x.debit ? r(x.debit) : null, x.credit ? r(x.credit) : null, r(x.balance)]),
        [null, "Closing balance", null, r(l.totalDebit), r(l.totalCredit), r(l.closing)]]
    });
  }
  return sheets;
}
