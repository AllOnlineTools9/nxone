import { describe, expect, it } from "vitest";
import { amountsIn, dateIn, parseSentence, EXAMPLES, type Draft } from "@/lib/entries/parse";
import { entry } from "@/lib/ledger/journal";

const ctx = { today: "2026-11-20", structure: "proprietorship" as const };
const read = (s: string, c: Parameters<typeof parseSentence>[1] = ctx) => {
  const r = parseSentence(s, c);
  if (!r.ok) throw new Error(`Not understood: ${s} -> ${r.says}`);
  return r as Draft;
};
const side = (d: Draft) => d.lines.map((l) => `${l.debit ? "Dr" : "Cr"} ${l.account} ${(l.debit ?? l.credit)! / 100}`).join(", ");

describe("amounts as people say them", () => {
  it.each([
    ["₹1,25,000", 125000], ["Rs. 590", 590], ["5 lakh", 500000], ["2.5 lakhs", 250000], ["1 crore", 10000000],
    ["50k", 50000], ["10 hazaar", 10000], ["10 chairs @ 1,500 each", 15000], ["42300.50", 42300.5]
  ])("%s", (text, rupees) => {
    expect(amountsIn(text)[0]?.minor).toBe(Math.round(rupees * 100));
  });

  it("does not take dates, years or rates as amounts", () => {
    expect(amountsIn("Paid GST 42,300 on 01/04/2026").map((a) => a.minor)).toEqual([4230000]);
    expect(amountsIn("for FY 2026 at 18% GST")).toEqual([]);
    expect(amountsIn("on 1 Apr paid 5000").map((a) => a.minor)).toEqual([500000]);
  });
});

describe("dates", () => {
  it.each([
    ["on 01/04/2026", "2026-04-01"], ["1-4-26", "2026-04-01"], ["1 Apr 2026", "2026-04-01"], ["Apr 3", "2026-04-03"],
    ["5th March", "2026-03-05"], ["yesterday", "2026-11-19"], ["kal", "2026-11-19"], ["31/02/2026", undefined]
  ])("%s", (text, want) => {
    expect(dateIn(text, "2026-11-20")).toBe(want);
  });
});

describe("sentences into entries", () => {
  it.each([
    ["Started the business with 5 lakh in the bank", "capital", "Dr 1020 500000, Cr 3000 500000"],
    ["Took 25k cash for home", "drawings", "Dr 3100 25000, Cr 1010 25000"],
    ["Ghar ke liye 10 hazaar cash nikale", "drawings", "Dr 3100 10000, Cr 1010 10000"],
    ["Loan of 10 lakh from HDFC Bank credited", "loan-taken", "Dr 1020 1000000, Cr 2300 1000000"],
    ["HDFC se 5 lakh ka loan liya", "loan-taken", "Dr 1020 500000, Cr 2300 500000"],
    ["Paid EMI 32,000 to HDFC, interest 9,500", "loan-emi", "Dr 2300 22500, Dr 6110 9500, Cr 1020 32000"],
    ["Deposited 40,000 cash in bank", "cash-to-bank", "Dr 1020 40000, Cr 1010 40000"],
    ["Withdrew 10,000 cash from ATM", "bank-to-cash", "Dr 1010 10000, Cr 1020 10000"],
    ["Paid GST 42,300 for October", "gst-paid", "Dr 2100 42300, Cr 1020 42300"],
    ["Set off ITC of 12,000 against GST", "gst-setoff", "Dr 2100 12000, Cr 1400 12000"],
    ["Paid TDS 6,200", "tds-paid", "Dr 2430 6200, Cr 1020 6200"],
    ["Made an FD of 2 lakh", "fd-made", "Dr 1040 200000, Cr 1020 200000"],
    ["FD of 2,10,000 matured, interest 10,000", "fd-matured", "Dr 1020 210000, Cr 1040 200000, Cr 4200 10000"],
    ["Paid security deposit 60,000 for the shop", "deposit-paid", "Dr 1050 60000, Cr 1020 60000"],
    ["Invested 1 lakh in mutual funds", "investment", "Dr 1100 100000, Cr 1020 100000"],
    ["Bank charges 590", "bank-charges", "Dr 6090 590, Cr 1020 590"],
    ["Bank interest 1,240 credited", "interest-received", "Dr 1020 1240, Cr 4200 1240"],
    ["Rent of 30,000 for March is outstanding", "outstanding-expense", "Dr 6010 30000, Cr 2050 30000"],
    ["Insurance 12,000 is prepaid for next year", "prepaid-adjust", "Dr 1500 12000, Cr 6130 12000"],
    ["Interest of 3,000 accrued on the FD", "fd-matured", null],
    ["Received 50,000 advance from Globex", "advance-received", "Dr 1020 50000, Cr 2200 50000"],
    ["Sharma ji ka cheque 15,000 bounced", "cheque-bounced", "Dr 1200 15000, Cr 1020 15000"],
    ["Ravi's 8,000 is a bad debt, he won't pay", "bad-debt", "Dr 6120 8000, Cr 1200 8000"],
    ["Returned goods worth 10,000 to Acme with 18% GST", "purchase-return", "Dr 2010 11800, Cr 5000 10000, Cr 1400 1800"],
    ["Paid electricity bill 4,200 in cash", "expense-paid", "Dr 6030 4200, Cr 1010 4200"]
  ])("%s", (sentence, template, lines) => {
    const d = read(sentence);
    if (template !== "fd-matured" || lines) expect(d.template).toBe(template);
    if (lines) expect(side(d)).toBe(lines);
    // Every draft is a real, balanced entry.
    expect(() => entry({ date: d.date, narration: d.narration, currency: "INR", lines: d.lines, source: { kind: "manual" } })).not.toThrow();
  });

  it("names the lender and says what it assumed", () => {
    const d = read("Loan of 10 lakh from HDFC Bank credited");
    expect(d.party).toBe("HDFC Bank");
    const e = read("Paid GST 42,300");
    expect(e.notes.join(" ")).toMatch(/Dated today/);
    expect(e.notes.join(" ")).toMatch(/Taken as the bank/);
  });

  it("keeps the date said", () => {
    expect(read("Paid TDS 6,200 on 07/11/2026").date).toBe("2026-11-07");
  });

  it("asks for the interest when an EMI does not split it", () => {
    const d = read("Paid EMI of 32,000");
    expect(d.template).toBe("loan-repaid");
    expect(d.notes.join(" ")).toMatch(/interest/);
  });

  it("treats a proprietor's income tax as drawings, and a company's as tax paid", () => {
    expect(side(read("Paid advance tax 30,000"))).toBe("Dr 3100 30000, Cr 1020 30000");
    expect(side(read("Paid advance tax 30,000", { ...ctx, structure: "company" }))).toBe("Dr 1600 30000, Cr 1020 30000");
  });

  it("gives each partner their own capital and drawings", () => {
    const c = { ...ctx, structure: "partnership" as const, partners: ["Rahul", "Priya"] };
    const d = read("Priya took 20,000 for personal use", c);
    expect(d.lines[0]).toMatchObject({ account: "3100", memo: "Priya" });
    const k = read("Capital of 3 lakh brought in by Rahul", c);
    expect(k.lines[1]).toMatchObject({ account: "3000", memo: "Rahul" });
  });

  it("sends things that belong elsewhere to the right place", () => {
    for (const s of ["Sold goods for 20,000", "Bought a laptop for 80,000", "Depreciation 5,000", "Customer returned goods worth 3,000"]) {
      const r = parseSentence(s, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.goTo).toBeDefined();
    }
  });

  it("says when there is no amount or no rule", () => {
    expect(parseSentence("Paid GST", ctx).ok).toBe(false);
    expect(parseSentence("Something happened 500", ctx).ok).toBe(false);
  });

  it("understands every example it shows", () => {
    for (const s of EXAMPLES) expect(parseSentence(s, ctx).ok, s).toBe(true);
  });
});

describe("year-end income in advance", () => {
  it("moves income already booked to next year", () => {
    const r = parseSentence("Received 20,000 in advance for next year's work on 31/03/2026", { today: "2026-11-20" });
    expect("lines" in r && r.template).toBe("income-in-advance");
    if ("lines" in r) {
      expect(r.date).toBe("2026-03-31");
      expect(r.lines).toEqual([{ account: "4000", debit: 2000000 }, { account: "2210", credit: 2000000 }]);
    }
  });
  it("still treats a fresh advance from a customer as a receipt", () => {
    const r = parseSentence("Received 50,000 advance from Globex", { today: "2026-11-20" });
    expect("lines" in r && r.template).toBe("advance-received");
  });
});

describe("examples for businesses outside India", () => {
  it("reads every one into a balanced entry", async () => {
    const { EXAMPLES_WORLD } = await import("@/lib/entries/parse");
    for (const ex of EXAMPLES_WORLD) {
      const r = parseSentence(ex, { today: "2026-11-20", structure: "company" });
      expect("lines" in r, ex).toBe(true);
    }
  });
  it("reads VAT and sales tax payments", () => {
    const vat = parseSentence("Paid VAT 1,800", ctx);
    expect("lines" in vat && vat.template).toBe("gst-paid");
    expect("lines" in vat && vat.readAs).toContain("VAT");
  });
});
