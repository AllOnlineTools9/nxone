import { describe, expect, it } from "vitest";
import { entry, type JournalEntry } from "@/lib/ledger/journal";
import { accountLedger, dayBook, partnerAccounts, receiptsAndPayments, tradingAndPL } from "@/lib/ledger/views";
import { balanceSheet } from "@/lib/ledger/statements";
import { makeXlsx, column, sheetNames } from "@/lib/files/xlsx";

const e = (date: string, narration: string, lines: JournalEntry["lines"]) =>
  entry({ date, narration, currency: "INR", lines, source: { kind: "manual" } });

const books = [
  e("2026-04-01", "Capital", [{ account: "1020", debit: 500_000_00 }, { account: "3000", credit: 300_000_00, memo: "Rahul" }, { account: "3000", credit: 200_000_00, memo: "Priya" }]),
  e("2026-04-05", "Sale", [{ account: "1200", debit: 118_000_00 }, { account: "4000", credit: 100_000_00 }, { account: "2100", credit: 18_000_00 }]),
  e("2026-04-10", "Cost", [{ account: "5000", debit: 60_000_00 }, { account: "1300", credit: 60_000_00 }]),
  e("2026-04-12", "Rent", [{ account: "6010", debit: 20_000_00 }, { account: "1020", credit: 20_000_00 }]),
  e("2026-04-15", "Cash to bank", [{ account: "1020", debit: 5_000_00 }, { account: "1010", credit: 5_000_00 }]),
  e("2026-04-20", "Received", [{ account: "1020", debit: 118_000_00 }, { account: "1200", credit: 118_000_00 }]),
  e("2026-04-25", "Drawings", [{ account: "3100", debit: 10_000_00, memo: "Priya" }, { account: "1020", credit: 10_000_00 }]),
  e("2026-04-28", "Discount", [{ account: "4900", debit: 1_000_00 }, { account: "1200", credit: 1_000_00 }])
];

describe("one account's history", () => {
  it("runs a balance from the opening", () => {
    const bank = accountLedger(books, "1020", "INR", "2026-04-10", "2026-04-30");
    expect(bank.opening).toBe(500_000_00);
    expect(bank.rows.map((r) => r.balance)).toEqual([480_000_00, 485_000_00, 603_000_00, 593_000_00]);
    expect(bank.closing).toBe(593_000_00);
    expect(bank.rows[0].against).toBe("Rent");
  });

  it("runs a credit-side account the right way up", () => {
    const tax = accountLedger(books, "2100", "INR", "2026-04-01", "2026-04-30");
    expect(tax.closing).toBe(18_000_00);
    expect(tax.normal).toBe("credit");
  });
});

describe("the day book", () => {
  it("lists every entry in the period by date, debits first", () => {
    const db = dayBook(books, "INR", "2026-04-05", "2026-04-12");
    expect(db.map((d) => d.narration)).toEqual(["Sale", "Cost", "Rent"]);
    expect(db[0].lines[0]).toMatchObject({ name: "Accounts receivable", debit: 118_000_00 });
  });
});

describe("the receipts and payments account", () => {
  it("leaves out money moved between cash and bank", () => {
    const rp = receiptsAndPayments(books, "INR", "2026-04-01", "2026-04-30");
    expect(rp.receipts).toEqual([{ name: "Owner's capital", amount: 500_000_00 }, { name: "Accounts receivable", amount: 118_000_00 }]);
    expect(rp.payments).toEqual([{ name: "Rent", amount: 20_000_00 }, { name: "Drawings", amount: 10_000_00 }]);
    expect(rp.opening + rp.totalReceipts - rp.totalPayments).toBe(rp.closing);
    expect(rp.closing).toBe(588_000_00);
  });
});

describe("trading and profit and loss, two-sided", () => {
  const t = tradingAndPL(books, "INR", "2026-04-01", "2026-04-30");
  it("works out gross profit, then net", () => {
    expect(t.trading.grossProfit).toBe(40_000_00);
    expect(t.pl.netProfit).toBe(19_000_00);
    expect(t.pl.debit.map((x) => x.name).sort()).toEqual(["Discount allowed", "Net profit", "Rent"]);
  });
  it("balances both sides", () => {
    const sum = (s: { amount: number }[]) => s.reduce((a, x) => a + x.amount, 0);
    expect(sum(t.trading.debit)).toBe(sum(t.trading.credit));
    expect(sum(t.pl.debit)).toBe(sum(t.pl.credit));
  });
});

describe("drawings and discounts reduce what they sit with", () => {
  it("keeps the balance sheet balanced", () => {
    const bs = balanceSheet(books, "INR", "2026-04-30");
    expect(bs.balanced).toBe(true);
    expect(bs.equity.find((r) => r.code === "3100")?.balance.minor).toBe(-10_000_00);
  });
});

describe("partners", () => {
  it("keeps each partner's capital and drawings apart", () => {
    expect(partnerAccounts(books, "INR", ["Rahul", "Priya"], "2026-04-30")).toEqual([
      { partner: "Rahul", introduced: 300_000_00, drawings: 0, balance: 300_000_00 },
      { partner: "Priya", introduced: 200_000_00, drawings: 10_000_00, balance: 190_000_00 }
    ]);
  });
});

describe("excel", () => {
  it("names columns and sheets as Excel allows", () => {
    expect([column(0), column(25), column(26), column(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(sheetNames(["Bank / Cash", "Bank / Cash", "a".repeat(40)])).toEqual(["Bank   Cash", "Bank   Cash 2", "a".repeat(31)]);
  });
  it("writes a zip with a sheet per tab", () => {
    const bytes = makeXlsx([{ name: "One", rows: [["A", 1]] }, { name: "Two", rows: [["B & C", 2.5]] }]);
    expect(bytes[0]).toBe(0x50);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("xl/worksheets/sheet2.xml");
    expect(text).toContain("B &amp; C");
  });
});

describe("receipts and payments with an opening balance inside the period", () => {
  it("shows the opening cash as opening, not as capital received", () => {
    const opening: JournalEntry = { id: "o", date: "2026-04-01", currency: "INR", createdAt: "", narration: "Opening balance", source: { kind: "opening" },
      lines: [{ account: "1020", debit: 60000000 }, { account: "3000", credit: 60000000 }] } as JournalEntry;
    const rp = receiptsAndPayments([opening], "INR", "2026-04-01", "2027-03-31");
    expect(rp.opening).toBe(60000000);
    expect(rp.receipts.length).toBe(0);
  });
});
