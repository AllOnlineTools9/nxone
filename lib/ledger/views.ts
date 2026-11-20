import { accountByCode, CHART } from "./accounts";
import type { JournalEntry } from "./journal";

/**
 * The views an accountant reads the books through, all worked out from the same journal as the
 * statements: one account's history with its running balance, the day book, the receipts and
 * payments account, the trading and profit and loss account in the traditional two-sided form,
 * and each partner's capital and drawings.
 *
 * Amounts are minor units throughout; screens format them.
 */

const live = (entries: JournalEntry[], currency: string) => entries.filter((e) => e.currency === currency);
const nameOf = (code: string) => accountByCode(code)?.name ?? code;
/** The side an account's balance normally sits on, by its type: assets and costs on the debit side. */
const debitSide = (code: string) => {
  const t = accountByCode(code)?.type;
  return t === "asset" || t === "expense";
};

/* ------------------------------------------------------------ one account */

export interface LedgerRow {
  date: string;
  entryId: string;
  narration: string;
  /** The other accounts in the entry: who the money came from or went to. */
  against: string;
  memo?: string;
  debit: number;
  credit: number;
  /** Running balance, positive on the account's normal side. */
  balance: number;
}

export interface AccountLedger {
  code: string;
  name: string;
  normal: "debit" | "credit";
  opening: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

export function accountLedger(entries: JournalEntry[], code: string, currency: string, from: string, to: string): AccountLedger {
  const normalDebit = debitSide(code);
  const signed = (d: number, c: number) => (normalDebit ? d - c : c - d);
  let opening = 0;
  const rows: LedgerRow[] = [];
  let balance = 0;

  const sorted = live(entries, currency).slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const e of sorted) {
    if (e.date > to) break;
    const mine = e.lines.filter((l) => l.account === code);
    if (!mine.length) continue;
    const debit = mine.reduce((a, l) => a + (l.debit ?? 0), 0);
    const credit = mine.reduce((a, l) => a + (l.credit ?? 0), 0);
    if (e.date < from) { opening += signed(debit, credit); continue; }
    if (!rows.length) balance = opening;
    balance += signed(debit, credit);
    // The other side: accounts on the opposite side of this account's lines.
    const others = e.lines.filter((l) => l.account !== code && (debit > credit ? (l.credit ?? 0) > 0 : (l.debit ?? 0) > 0));
    rows.push({
      date: e.date, entryId: e.id, narration: e.narration,
      against: [...new Set(others.map((l) => nameOf(l.account)))].join(", ") || "Several",
      memo: mine.find((l) => l.memo)?.memo,
      debit, credit, balance
    });
  }
  const totalDebit = rows.reduce((a, r) => a + r.debit, 0);
  const totalCredit = rows.reduce((a, r) => a + r.credit, 0);
  return {
    code, name: nameOf(code), normal: normalDebit ? "debit" : "credit",
    opening, rows, totalDebit, totalCredit, closing: opening + signed(totalDebit, totalCredit)
  };
}

/** Every account that has anything in it, for picking which ledger to open. */
export function accountsInUse(entries: JournalEntry[], currency: string): Array<{ code: string; name: string; type: string }> {
  const used = new Set<string>();
  for (const e of live(entries, currency)) for (const l of e.lines) used.add(l.account);
  return CHART.filter((a) => used.has(a.code)).map((a) => ({ code: a.code, name: a.name, type: a.type }));
}

/* -------------------------------------------------------------- day book */

export interface DayBookEntry {
  date: string;
  id: string;
  narration: string;
  kind: string;
  lines: Array<{ account: string; name: string; debit: number; credit: number; memo?: string }>;
}

export function dayBook(entries: JournalEntry[], currency: string, from: string, to: string): DayBookEntry[] {
  return live(entries, currency)
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => ({
      date: e.date, id: e.id, narration: e.narration, kind: e.source.kind,
      lines: [...e.lines].sort((a, b) => (b.debit ?? 0) - (a.debit ?? 0)).map((l) => ({
        account: l.account, name: nameOf(l.account), debit: l.debit ?? 0, credit: l.credit ?? 0, memo: l.memo
      }))
    }));
}

/* ------------------------------------------------- receipts and payments */

export interface ReceiptsAndPayments {
  opening: number;
  receipts: Array<{ name: string; amount: number }>;
  payments: Array<{ name: string; amount: number }>;
  totalReceipts: number;
  totalPayments: number;
  closing: number;
}

/**
 * Money in and out of cash and bank, by what it was for. Moving money between the drawer and the
 * bank is neither, so an entry made only of cash accounts is left out. Where one payment covers
 * several things it is shared between them in proportion.
 */
export function receiptsAndPayments(entries: JournalEntry[], currency: string, from: string, to: string): ReceiptsAndPayments {
  const isCash = (code: string) => Boolean(accountByCode(code)?.isCash);
  let opening = 0;
  const receipts = new Map<string, number>();
  const payments = new Map<string, number>();

  for (const e of live(entries, currency)) {
    if (e.date > to) continue;
    const cash = e.lines.filter((l) => isCash(l.account));
    if (!cash.length) continue;
    const net = cash.reduce((a, l) => a + (l.debit ?? 0) - (l.credit ?? 0), 0);
    // Opening balances are where the account starts, not money that came in during the period.
    if (e.date < from || e.source?.kind === "opening") { opening += net; continue; }
    if (cash.length === e.lines.length) continue;

    const others = e.lines.filter((l) => !isCash(l.account));
    const into = net > 0 ? receipts : payments;
    const amount = Math.abs(net);
    if (!amount) continue;
    // The other side of the cash: credits when money came in, debits when it went out.
    const side = others.filter((l) => (net > 0 ? (l.credit ?? 0) > 0 : (l.debit ?? 0) > 0));
    const weight = side.reduce((a, l) => a + (net > 0 ? l.credit ?? 0 : l.debit ?? 0), 0);
    let left = amount;
    side.forEach((l, i) => {
      const part = i === side.length - 1 ? left : Math.round((amount * (net > 0 ? l.credit ?? 0 : l.debit ?? 0)) / (weight || 1));
      left -= part;
      const key = nameOf(l.account);
      into.set(key, (into.get(key) ?? 0) + part);
    });
  }

  const list = (m: Map<string, number>) => [...m.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  const r = list(receipts);
  const p = list(payments);
  const totalReceipts = r.reduce((a, x) => a + x.amount, 0);
  const totalPayments = p.reduce((a, x) => a + x.amount, 0);
  return { opening, receipts: r, payments: p, totalReceipts, totalPayments, closing: opening + totalReceipts - totalPayments };
}

/* ------------------------------- trading and profit and loss, two-sided */

export interface TSide { name: string; amount: number }
export interface TradingAndPL {
  trading: { debit: TSide[]; credit: TSide[]; grossProfit: number; total: number };
  pl: { debit: TSide[]; credit: TSide[]; netProfit: number; total: number };
}

/**
 * The traditional form: the trading account works out gross profit from sales and the cost of
 * what was sold, and the profit and loss account takes that with every other income and cost.
 * A loss is shown on the other side, as an accountant writes it.
 */
export function tradingAndPL(entries: JournalEntry[], currency: string, from: string, to: string): TradingAndPL {
  const totals = new Map<string, number>();
  for (const e of live(entries, currency)) {
    if (e.date < from || e.date > to) continue;
    for (const l of e.lines) totals.set(l.account, (totals.get(l.account) ?? 0) + (l.debit ?? 0) - (l.credit ?? 0));
  }
  const debitBal = (code: string) => totals.get(code) ?? 0;
  const creditBal = (code: string) => -(totals.get(code) ?? 0);

  const sales = creditBal("4000");
  const cost = debitBal("5000");
  const gross = sales - cost;
  const tradingDebit: TSide[] = [{ name: "Cost of goods sold", amount: cost }];
  const tradingCredit: TSide[] = [{ name: "Sales", amount: sales }];
  if (gross >= 0) tradingDebit.push({ name: "Gross profit carried to P&L", amount: gross });
  else tradingCredit.push({ name: "Gross loss carried to P&L", amount: -gross });

  const plDebit: TSide[] = [];
  const plCredit: TSide[] = [];
  if (gross >= 0) plCredit.push({ name: "Gross profit brought down", amount: gross });
  else plDebit.push({ name: "Gross loss brought down", amount: -gross });

  for (const a of CHART) {
    if (a.code === "4000" || a.code === "5000") continue;
    const bal = totals.get(a.code) ?? 0;
    if (!bal) continue;
    if (a.type === "expense") plDebit.push({ name: a.name, amount: bal });
    // Discounts given sit with income but are a cost to the owner: shown on the debit side.
    else if (a.type === "income") (bal > 0 ? plDebit : plCredit).push({ name: a.code === "4900" ? "Discount allowed" : a.name, amount: Math.abs(bal) });
  }

  const sum = (s: TSide[]) => s.reduce((a, x) => a + x.amount, 0);
  const net = sum(plCredit) - sum(plDebit);
  if (net >= 0) plDebit.push({ name: "Net profit", amount: net });
  else plCredit.push({ name: "Net loss", amount: -net });

  return {
    trading: { debit: tradingDebit, credit: tradingCredit, grossProfit: gross, total: Math.max(sum(tradingDebit), sum(tradingCredit)) },
    pl: { debit: plDebit, credit: plCredit, netProfit: net, total: Math.max(sum(plDebit), sum(plCredit)) }
  };
}

/* --------------------------------------------------------- the partners */

export interface PartnerAccount { partner: string; introduced: number; drawings: number; balance: number }

/**
 * Each partner's capital and drawings, from the name on each line. Profit is not shared out here:
 * how a firm splits it is in the partnership deed, which NXOne does not hold, so the accountant
 * adds the share at year end.
 */
export function partnerAccounts(entries: JournalEntry[], currency: string, partners: string[], to: string): PartnerAccount[] {
  const rows = new Map<string, PartnerAccount>();
  const keyFor = (memo?: string) => partners.find((p) => memo && memo.toLowerCase() === p.toLowerCase()) ?? "Not named";
  for (const p of partners) rows.set(p, { partner: p, introduced: 0, drawings: 0, balance: 0 });
  for (const e of live(entries, currency)) {
    if (e.date > to) continue;
    for (const l of e.lines) {
      if (l.account !== "3000" && l.account !== "3100") continue;
      const k = keyFor(l.memo);
      const row = rows.get(k) ?? { partner: k, introduced: 0, drawings: 0, balance: 0 };
      if (l.account === "3000") row.introduced += (l.credit ?? 0) - (l.debit ?? 0);
      else row.drawings += (l.debit ?? 0) - (l.credit ?? 0);
      row.balance = row.introduced - row.drawings;
      rows.set(k, row);
    }
  }
  return [...rows.values()].filter((r) => r.partner !== "Not named" || r.introduced || r.drawings);
}
