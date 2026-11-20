import { accountByCode } from "../ledger/accounts";
import type { JournalLine } from "../ledger/journal";
import type { VoucherType } from "./types";

/**
 * Reading a sentence about money as an accounting entry.
 *
 * "Took 50k from the business for home", "HDFC se 5 lakh ka loan liya", "Paid GST of 42,300 for
 * October": the kinds of things an owner says, in English or everyday Hinglish, turned into the
 * debits and credits an accountant would write.
 *
 * It is a set of rules, not a language model: the same words always give the same entry, nothing
 * is sent anywhere, and when a sentence does not fit a rule it says so rather than guessing. What
 * it produces is a draft, shown with its accounts, for the person to check before it is posted.
 */

export type Structure = "proprietorship" | "partnership" | "company";

export interface Draft {
  ok: true;
  template: string;
  /** What it was read as, in words, shown above the entry. */
  readAs: string;
  date: string;
  amountMinor: number;
  voucher: VoucherType;
  lines: JournalLine[];
  narration: string;
  party?: string;
  /** Things to check or know, such as an assumption made. */
  notes: string[];
}

export interface NotUnderstood {
  ok: false;
  says: string;
  /** Where in the app this belongs instead, when it does. */
  goTo?: { href: string; label: string };
}

export type Parsed = Draft | NotUnderstood;

export interface ParseContext {
  today: string;
  structure?: Structure;
  partners?: string[];
}

/* ----------------------------------------------------------------- amounts */

const UNITS: Array<[RegExp, number]> = [
  [/^(crores?|cr)$/i, 1_00_00_000],
  [/^(lakhs?|lacs?|lac|l)$/i, 1_00_000],
  [/^(thousand|hazaa?r|k)$/i, 1_000]
];

interface Amount { minor: number; at: number; end: number; text: string }

/** Every amount in a sentence, in order: "₹1,25,000", "5 lakh", "50k", "10 chairs @ 1,500 each". */
export function amountsIn(text: string): Amount[] {
  const out: Amount[] = [];
  // "10 chairs @ 1,500 each" or "10 x 1500": the quantity times the price.
  const each = /(\d+(?:\.\d+)?)\s*(?:[a-z]+\s+)?(?:@|x|×|at)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:each|per|\/-)?/gi;
  for (const m of text.matchAll(each)) {
    const q = Number(m[1]);
    const p = Number(m[2].replace(/,/g, ""));
    // "at" alone is too common ("2026 at 18%"), so it counts only with "each" or "per".
    if (q > 0 && p > 0 && (/@|×|\sx\s/i.test(m[0]) || /\b(each|per)\b/i.test(m[0]))) out.push({ minor: Math.round(q * p * 100), at: m.index!, end: m.index! + m[0].length, text: m[0] });
  }
  const re = /(?:₹|rs\.?|inr|rupees?)?\s*(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|thousand|hazaa?r|k|l)?\b(?:\s*(?:rupees?|rs\.?|\/-))?/gi;
  for (const m of text.matchAll(re)) {
    // Where the digits begin, past any currency sign and space the match started with.
    const start = m.index! + m[0].indexOf(m[1]);
    if (out.some((o) => start >= o.at && start < o.end)) continue;
    const raw = m[1].replace(/,/g, "");
    // A date (1/4/2026, 01-04-2026) or a year on its own is not an amount.
    const before = text.slice(Math.max(0, start - 1), start);
    const tail = m.index! + m[0].length;
    const after = text.slice(tail, tail + 1);
    if (/[\/-]/.test(before) || /^[\/-]\d/.test(text.slice(start + m[1].length, start + m[1].length + 2))) continue;
    if (/^(19|20)\d\d$/.test(raw) && !m[2] && !/₹|rs|inr/i.test(m[0])) continue;
    if (/^\d{1,2}$/.test(raw) && !m[2] && /^\s*(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text.slice(start + m[1].length))) continue;
    if (/^\d{1,2}$/.test(raw) && !m[2] && /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*$/i.test(text.slice(0, start))) continue;
    if (after === "%" || /^\s*%/.test(text.slice(tail))) continue;
    let value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = m[2] ? UNITS.find(([u]) => u.test(m[2]!)) : undefined;
    if (unit) value *= unit[1];
    out.push({ minor: Math.round(value * 100), at: start, end: tail, text: m[0] });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The amount right after a word, such as the interest in "EMI 25,000 including interest 8,000". */
function amountAfter(text: string, word: RegExp): number | undefined {
  const m = text.match(word);
  if (!m || m.index === undefined) return undefined;
  const rest = text.slice(m.index + m[0].length);
  const a = amountsIn(rest)[0];
  return a && a.at < 25 ? a.minor : undefined;
}

/* ------------------------------------------------------------------- dates */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

/** "01/04/2026", "1-4-26", "1 Apr 2026", "Apr 1", "today", "yesterday", "kal". */
export function dateIn(text: string, today: string): string | undefined {
  const t = text.toLowerCase();
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  if (/\b(yesterday|kal)\b/.test(t)) return shift(-1);
  if (/\b(today|aaj)\b/.test(t)) return today;
  const year = Number(today.slice(0, 4));

  const num = t.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (num) {
    const y = num[3].length === 2 ? 2000 + Number(num[3]) : Number(num[3]);
    return iso(y, Number(num[2]), Number(num[1]));
  }
  const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/);
  if (dm) return iso(dm[3] ? Number(dm[3]) : year, MONTHS.indexOf(dm[2]) + 1, Number(dm[1]));
  const md = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (md) return iso(md[3] ? Number(md[3]) : year, MONTHS.indexOf(md[1]) + 1, Number(md[2]));
  return undefined;
}

/* ------------------------------------------------------------------- words */

const has = (t: string, re: RegExp) => re.test(t);

/** Cash or bank: the drawer if the sentence says cash, otherwise the bank. */
function moneyAccount(t: string): { code: string; assumed: boolean } {
  if (has(t, /\b(cash|nakad|nagad|naqad|drawer|galla)\b/) && !has(t, /\bcash (in|at) bank\b/)) return { code: "1010", assumed: false };
  if (has(t, /\b(bank|hdfc|sbi|icici|axis|kotak|pnb|bob|canara|yes bank|idfc|indusind|account|upi|neft|rtgs|imps|cheque|check|online|transfer|gpay|phonepe|paytm)\b/)) return { code: "1020", assumed: false };
  return { code: "1020", assumed: true };
}

const STOP = /\s+(?:for|on|at|of|via|by|in|with|as|towards|against|dated|worth|ka|ki|ke|ko|se|to|from|and|credited|received|paid|taken|sanctioned|disbursed|liya|mila|is|was|has|₹|rs)\b|\s+\d|[,.;]|$/i;

/** The name after "from", "to", "by" or before "se"/"ko": "loan from HDFC Bank", "Sharma ji ko". */
function partyIn(text: string, words: RegExp): string | undefined {
  const m = text.match(words);
  if (!m || m.index === undefined) return undefined;
  const rest = text.slice(m.index + m[0].length).trim();
  const end = rest.search(STOP);
  const name = (end > 0 ? rest.slice(0, end) : rest).trim().replace(/^(the|a|an|mr\.?|mrs\.?|ms\.?)\s+/i, "");
  if (!name || /^\d/.test(name) || name.length > 60) return undefined;
  if (/^(bank|cash|business|home|personal|account|my|our|the business|loan|emi|gst|tds)$/i.test(name)) return undefined;
  return titled(name);
}

/** "hdfc bank" becomes "Hdfc Bank", but "HDFC Bank" stays as typed. */
const titled = (s: string) => s.split(/\s+/).map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");

/** A Hinglish "X se" / "X ko": the word or two before it. */
function partyBefore(text: string, word: "se" | "ko" | "ka"): string | undefined {
  const m = text.match(new RegExp(`([A-Za-z][A-Za-z.&]*(?:\\s+[A-Za-z][A-Za-z.&]*){0,2})\\s+${word}\\b`, "i"));
  if (!m) return undefined;
  const words = m[1].split(/\s+/).filter((w) => !/^(ne|ka|ki|ke|loan|cash|bank|maine|humne|business|account|paise|rupaye|lakh|hazaar|k)$/i.test(w));
  const name = words.slice(-2).join(" ").trim();
  return name && !/^\d/.test(name) ? titled(name) : undefined;
}

/** The expense a sentence is about, from the words in it. */
function expenseAccount(t: string): { code: string; word?: string } {
  const map: Array<[RegExp, string]> = [
    [/\b(rent|kiraya|kiraaya)\b/, "6010"],
    [/\b(salary|salaries|wages|tankhwah|tankha|payroll)\b/, "6020"],
    [/\b(electricity|bijli|water|internet|wifi|phone bill|mobile bill|utilities)\b/, "6030"],
    [/\b(software|subscription|saas|hosting|domain)\b/, "6040"],
    [/\b(advertis\w*|marketing|ads?|promotion)\b/, "6050"],
    [/\b(travel|taxi|uber|ola|train|flight|petrol|diesel|fuel)\b/, "6060"],
    [/\b(audit fees?|professional fees?|ca fees?|legal fees?|consultancy)\b/, "6070"],
    [/\b(repairs?|maintenance)\b/, "6080"],
    [/\b(stationery|office supplies)\b/, "6100"],
    [/\b(insurance|premium)\b/, "6130"],
    [/\b(interest)\b/, "6110"]
  ];
  for (const [re, code] of map) if (re.test(t)) return { code, word: t.match(re)?.[0] };
  return { code: "6900" };
}

const name = (code: string) => accountByCode(code)?.name ?? code;
const money = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/* --------------------------------------------------------------- the rules */

export function parseSentence(sentence: string, ctx: ParseContext): Parsed {
  const text = sentence.trim();
  if (!text) return { ok: false, says: "Type what happened, in a sentence." };
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const date = dateIn(text, ctx.today) ?? ctx.today;
  const amounts = amountsIn(text);

  /* things that belong somewhere else in the app, checked first so they are never mis-posted */
  if (has(t, /\b(sales return|returned by (the )?customer|customer returned|credit note)\b/)) {
    return { ok: false, says: "Goods returned by a customer are recorded as a credit note, so GST is reduced correctly.", goTo: { href: "/documents/", label: "Open the invoice in Documents and make a credit note from it" } };
  }
  if (has(t, /\b(depreciation|ghisai)\b/)) {
    return { ok: false, says: "Depreciation is worked out each year from what you own, so it is never typed in by hand.", goTo: { href: "/assets/", label: "What you own" } };
  }
  if (has(t, /\b(bought|purchased|kharida|sold|becha)\b/) && has(t, /\b(machine|machinery|computer|laptop|furniture|vehicle|car|bike|equipment|printer|ac|air conditioner)\b/)) {
    return { ok: false, says: "Equipment and other things the business keeps are recorded in What you own, which also works out their depreciation.", goTo: { href: "/assets/", label: "What you own" } };
  }
  if (has(t, /\b(sold|becha|sale of|invoice)\b/) && !has(t, /\b(fd|shares|mutual fund|investment)\b/)) {
    return { ok: false, says: "A sale is recorded by making the invoice, which also counts it for GST.", goTo: { href: "/invoice-generator/", label: "Make an invoice" } };
  }

  if (!amounts.length) return { ok: false, says: "There is no amount in that. Say how much, such as ₹50,000, 50k or 5 lakh." };
  const amount = amounts[0].minor;
  const acct = moneyAccount(t);
  const fromWhere = acct.code === "1010" ? "cash" : "the bank";
  const notes: string[] = [];
  if (acct.assumed) notes.push("Taken as the bank account. Say \"cash\" if it was cash.");
  if (!dateIn(text, ctx.today)) notes.push("Dated today. Add a date such as 1 Apr 2026 if it was another day.");

  const partner = (ctx.partners ?? []).find((p) => t.includes(` ${p.toLowerCase()}`));
  const draft = (template: string, readAs: string, voucher: VoucherType, lines: JournalLine[], extra: Partial<Draft> = {}): Draft => ({
    ok: true, template, readAs, date, amountMinor: amount, voucher, lines,
    narration: text.charAt(0).toUpperCase() + text.slice(1), notes, ...extra
  });

  /* moving money between the drawer and the bank */
  if (has(t, /\b(deposit(ed)?|jama|daala|dala|put)\b/) && has(t, /\bcash\b/) && has(t, /\bbank\b/) && !has(t, /\b(fd|fixed|security)\b/)) {
    return draft("cash-to-bank", `Cash of ${money(amount)} put into the bank`, "contra", [
      { account: "1020", debit: amount }, { account: "1010", credit: amount }
    ], { notes: notes.filter((n) => !n.startsWith("Taken as")) });
  }
  if (has(t, /\b(withdr[ae]w\w*|nikal\w*|atm)\b/) && has(t, /\b(cash|atm)\b/) && !has(t, /\b(personal|home|ghar|drawings?|own use|self)\b/)) {
    return draft("bank-to-cash", `Cash of ${money(amount)} taken out of the bank for the business`, "contra", [
      { account: "1010", debit: amount }, { account: "1020", credit: amount }
    ], { notes: notes.filter((n) => !n.startsWith("Taken as")) });
  }

  /* the owners */
  if (has(t, /\b(drawings?|personal|for (my |our )?home|ghar|household|own use|self use|apne liye|khud ke liye|family)\b/)) {
    const who = partner ?? (ctx.structure === "partnership" ? partyIn(text, /\bby\b/i) : undefined);
    if (ctx.structure === "company") notes.push("A company has no drawings: money taken by a director is a loan to them or salary. Check with your accountant.");
    if (ctx.structure === "partnership" && !who) notes.push("Say which partner, such as \"... by Rahul\", so it goes to their account.");
    return draft("drawings", `${who ?? "The owner"} took ${money(amount)} out of the business for personal use`, "payment", [
      { account: "3100", debit: amount, memo: who }, { account: acct.code, credit: amount }
    ], { party: who });
  }
  if (has(t, /\b(capital|started (the )?business|start(ed)? with|introduced|brought in|put in|invested in (the |my |our )?(business|firm|company)|lagaye|lagaya|lagai|daale|dale)\b/)
    && !has(t, /\b(mutual funds?|shares? of|stock market|fd|fixed deposit)\b/)) {
    const who = partner ?? (ctx.structure === "partnership" ? partyIn(text, /\bby\b/i) : undefined);
    const account = ctx.structure === "company" && has(t, /\bshares?\b/) ? "3010" : "3000";
    if (ctx.structure === "partnership" && !who) notes.push("Say which partner, such as \"... by Rahul\", so it goes to their capital account.");
    return draft("capital", `${who ?? "The owner"} put ${money(amount)} into the business`, "receipt", [
      { account: acct.code, debit: amount }, { account, credit: amount, memo: who }
    ], { party: who });
  }

  /* loans */
  if (has(t, /\b(emi|kisht|installment|instalment)\b/) || (has(t, /\b(repaid|repay\w*|paid back|lauta\w*|chukaya|chukaye)\b/) && has(t, /\bloan|udhaar|karz\w*\b/))) {
    const interest = amountAfter(text, /\b(interest|byaj|byaaj)\b(\s+(of|part|portion|component))?/i);
    const lender = partyIn(text, /\b(to|for)\s+(?=[A-Z])/) ?? partyIn(text, /\bloan from\b/i);
    if (interest !== undefined && interest < amount) {
      return draft("loan-emi", `Loan instalment of ${money(amount)}: ${money(amount - interest)} off the loan and ${money(interest)} interest`, "payment", [
        { account: "2300", debit: amount - interest, memo: lender }, { account: "6110", debit: interest, memo: lender }, { account: acct.code, credit: amount }
      ], { party: lender });
    }
    notes.push("All of it is taken off the loan. Add \"interest 8,000\" to split out the interest, which is a cost.");
    return draft("loan-repaid", `${money(amount)} paid back on a loan`, "payment", [
      { account: "2300", debit: amount, memo: lender }, { account: acct.code, credit: amount }
    ], { party: lender });
  }
  if (has(t, /\b(interest|byaj|byaaj)\b/) && has(t, /\b(paid|diya|bhara)\b/) && has(t, /\bloan|udhaar|od|overdraft|cc limit\b/)) {
    return draft("loan-interest", `Interest of ${money(amount)} paid on a loan`, "payment", [
      { account: "6110", debit: amount }, { account: acct.code, credit: amount }
    ]);
  }
  if (has(t, /\b(loan|borrow\w*|udhaar|udhar|karz\w*|od|overdraft)\b/) && has(t, /\b(took|taken|take|got|received|liya|li|mila|mili|sanction\w*|disburs\w*|credited|borrowed)\b/)) {
    const lender = partyIn(text, /\bfrom\b/i) ?? partyBefore(text, "se");
    return draft("loan-taken", `Loan of ${money(amount)} taken${lender ? ` from ${lender}` : ""}`, "receipt", [
      { account: acct.code, debit: amount }, { account: "2300", credit: amount, memo: lender }
    ], { party: lender });
  }

  /* fixed deposits, deposits and investments */
  if (has(t, /\b(fd|fixed deposits?)\b/)) {
    if (has(t, /\b(matur\w*|closed|broke|break|toda|tod|redeem\w*|received back|got back|encash\w*)\b/)) {
      const interest = amountAfter(text, /\b(interest|byaj)\b(\s+of)?/i);
      const lines: JournalLine[] = interest !== undefined && interest < amount
        ? [{ account: "1020", debit: amount }, { account: "1040", credit: amount - interest }, { account: "4200", credit: interest }]
        : [{ account: "1020", debit: amount }, { account: "1040", credit: amount }];
      if (interest === undefined) notes.push("All of it is taken as the deposit coming back. Add \"interest 5,000\" if part of it is interest.");
      return draft("fd-matured", `Fixed deposit of ${money(amount)} back in the bank`, "receipt", lines, { notes: notes.filter((n) => !n.startsWith("Taken as")) });
    }
    return draft("fd-made", `${money(amount)} put into a fixed deposit`, "contra", [
      { account: "1040", debit: amount }, { account: "1020", credit: amount }
    ], { notes: notes.filter((n) => !n.startsWith("Taken as")) });
  }
  if (has(t, /\b(security deposit|rent deposit|deposit for (the )?(shop|office|premises|godown|rent)|advance for (the )?(shop|office))\b/)) {
    if (has(t, /\b(refund\w*|got back|received back|returned|wapas mila|wapas)\b/)) {
      return draft("deposit-back", `Security deposit of ${money(amount)} returned`, "receipt", [
        { account: acct.code, debit: amount }, { account: "1050", credit: amount }
      ]);
    }
    return draft("deposit-paid", `Security deposit of ${money(amount)} paid`, "payment", [
      { account: "1050", debit: amount }, { account: acct.code, credit: amount }
    ]);
  }
  if (has(t, /\b(mutual funds?|shares|stocks?|sip|bonds?|invest(ed|ment)? in)\b/)) {
    if (has(t, /\b(sold|redeem\w*|withdr\w*|becha)\b/)) {
      notes.push("Taken back at what it cost. If it sold for more or less, the difference is a gain or a loss: ask your accountant to adjust it.");
      return draft("investment-sold", `Investments of ${money(amount)} turned back into money`, "receipt", [
        { account: acct.code, debit: amount }, { account: "1100", credit: amount }
      ]);
    }
    return draft("investment", `${money(amount)} invested`, "payment", [
      { account: "1100", debit: amount }, { account: acct.code, credit: amount }
    ]);
  }

  /* tax paid to the government */
  if (has(t, /\b(set ?off|itc|input (tax )?credit)\b/) && has(t, /\bgst\b/)) {
    return draft("gst-setoff", `Input tax credit of ${money(amount)} used against GST owed`, "journal", [
      { account: "2100", debit: amount }, { account: "1400", credit: amount }
    ], { notes: [] });
  }
  if (has(t, /\b(gst|cgst|sgst|igst|utgst)\b/) && has(t, /\b(paid|pay|deposited|challan|bhara|bhari|jama|pmt)\b/)) {
    return draft("gst-paid", `GST of ${money(amount)} paid to the government`, "payment", [
      { account: "2100", debit: amount }, { account: acct.code, credit: amount }
    ]);
  }
  if (has(t, /\btds\b/) && has(t, /\b(paid|pay|deposited|challan|bhara|jama)\b/)) {
    return draft("tds-paid", `Tax held back (TDS) of ${money(amount)} paid to the government`, "payment", [
      { account: "2430", debit: amount }, { account: acct.code, credit: amount }
    ]);
  }
  if (has(t, /\b(advance tax|income tax|self[- ]assessment tax|itr tax)\b/)) {
    if (ctx.structure === "partnership" || ctx.structure === "company") {
      return draft("income-tax", `Income tax of ${money(amount)} paid by the ${ctx.structure === "company" ? "company" : "firm"}`, "payment", [
        { account: "1600", debit: amount }, { account: acct.code, credit: amount }
      ]);
    }
    notes.push("A proprietor's income tax is personal, so it is the owner's drawings, not a cost of the business.");
    return draft("income-tax-owner", `Income tax of ${money(amount)} paid for the owner`, "payment", [
      { account: "3100", debit: amount }, { account: acct.code, credit: amount }
    ]);
  }

  /* the bank's own entries */
  if (has(t, /\b(bank charges?|charges deducted|sms charges?|annual (fee|charges?)|min(imum)? balance charges?|processing fee)\b/)) {
    return draft("bank-charges", `Bank charges of ${money(amount)}`, "payment", [
      { account: "6090", debit: amount }, { account: "1020", credit: amount }
    ], { notes: notes.filter((n) => !n.startsWith("Taken as")) });
  }

  /* year-end adjustments, before the plain income and expense rules that share their words */
  if (has(t, /\b(prepaid|in advance|advance (rent|insurance|premium))\b/) && !has(t, /\b(received|from)\b/)) {
    const exp = expenseAccount(t);
    if (has(t, /\b(is|was|are) prepaid|of which|adjust\w*|relates? to next|for next year\b/)) {
      return draft("prepaid-adjust", `${money(amount)} of ${name(exp.code).toLowerCase()} is for a later period`, "journal", [
        { account: "1500", debit: amount }, { account: exp.code, credit: amount }
      ], { notes: [] });
    }
    return draft("prepaid-paid", `${money(amount)} paid in advance for ${exp.word ?? "a cost"}`, "payment", [
      { account: "1500", debit: amount }, { account: acct.code, credit: amount }
    ]);
  }
  if (has(t, /\b(outstanding|unpaid|not (yet )?paid|yet to (be )?pa(y|id)|payable|baaki|due but)\b/) && !has(t, /\b(customer|from)\b/)) {
    const exp = expenseAccount(t);
    return draft("outstanding-expense", `${money(amount)} of ${name(exp.code).toLowerCase()} owed but not yet paid`, "journal", [
      { account: exp.code, debit: amount }, { account: "2050", credit: amount }
    ], { notes: exp.code === "6900" ? ["Put in Other expenses. Name the cost, such as rent or salary, to put it in its own account."] : [] });
  }
  if (has(t, /\b(accrued|receivable|earned but not (yet )?received|due to us|not yet received)\b/)) {
    const account = has(t, /\binterest\b/) ? "4200" : "4100";
    return draft("accrued-income", `${money(amount)} of ${name(account).toLowerCase()} earned but not yet received`, "journal", [
      { account: "1210", debit: amount }, { account, credit: amount }
    ], { notes: [] });
  }
  // Year end: money already invoiced and in the books this year, for work done next year.
  if (has(t, /\badvance\b/) && has(t, /\b(next year|next year's|unearned|already (billed|invoiced))\b/)) {
    const account = has(t, /\b(rent|interest|commission)\b/) ? "4100" : "4000";
    return draft("income-in-advance", `${money(amount)} of this year's ${name(account).toLowerCase()} belongs to next year`, "journal", [
      { account, debit: amount }, { account: "2210", credit: amount }
    ], { notes: ["This takes it out of this year's income. It is for money already invoiced or received this year. If it has only just come in, say \"Received 20,000 advance from <customer>\" instead."] });
  }
  if (has(t, /\b(received in advance|advance received|advance from|received advance|advance mila|token amount|booking amount)\b/)) {
    const who = partyIn(text, /\bfrom\b/i) ?? partyBefore(text, "se");
    const account = who ? "2200" : "2210";
    notes.push("When you make the invoice for this work, take the advance off what they owe.");
    return draft("advance-received", `Advance of ${money(amount)} received${who ? ` from ${who}` : ""}`, "receipt", [
      { account: acct.code, debit: amount }, { account, credit: amount, memo: who }
    ], { party: who });
  }

  /* customers who will not or did not pay */
  if (has(t, /\b(bad debts?|won'?t pay|will not pay|never pay|written off|write off|doob gaya|dooba|doob gaye)\b/)) {
    const who = partyIn(text, /\b(from|of|by)\b/i) ?? partyBefore(text, "se");
    notes.push("If this is for an invoice, write it off from Owed to you instead, so the invoice closes too.");
    return draft("bad-debt", `${money(amount)}${who ? ` from ${who}` : ""} written off as a bad debt`, "journal", [
      { account: "6120", debit: amount, memo: who }, { account: "1200", credit: amount, memo: who }
    ], { party: who, notes: notes.filter((n) => !n.startsWith("Taken as")) });
  }
  if (has(t, /\b(bounced|bounce|dishonou?red|returned unpaid|cheque return\w*)\b/)) {
    const who = partyIn(text, /\b(from|of|by)\b/i) ?? partyBefore(text, "ka");
    notes.push("If the cheque was for an invoice, mark it on the invoice in Owed to you instead, so the invoice opens again.");
    return draft("cheque-bounced", `Cheque of ${money(amount)}${who ? ` from ${who}` : ""} came back unpaid`, "journal", [
      { account: "1200", debit: amount, memo: who }, { account: "1020", credit: amount }
    ], { party: who, notes: notes.filter((n) => !n.startsWith("Taken as")) });
  }

  /* suppliers */
  if (has(t, /\b(returned|purchase return|wapas (kiya|bheja)|sent back)\b/) && has(t, /\b(to|supplier|vendor)\b/)) {
    const who = partyIn(text, /\bto\b/i) ?? partyBefore(text, "ko");
    const rate = Number(text.match(/(\d+(?:\.\d+)?)\s*%\s*(gst|igst)?/i)?.[1] ?? NaN);
    if (Number.isFinite(rate) && rate > 0 && rate <= 28) {
      const inclusive = has(t, /\b(incl\w*|with gst)\b/);
      const net = inclusive ? Math.round(amount / (1 + rate / 100)) : amount;
      const tax = inclusive ? amount - net : Math.round((amount * rate) / 100);
      return draft("purchase-return", `Goods worth ${money(net)} plus ${money(tax)} GST sent back${who ? ` to ${who}` : ""}`, "journal", [
        { account: "2010", debit: net + tax, memo: who }, { account: "5000", credit: net }, { account: "1400", credit: tax }
      ], { party: who, amountMinor: net + tax, notes: notes.filter((n) => !n.startsWith("Taken as")) });
    }
    notes.push("No GST was named. If the goods carried GST, add it, such as \"with 18% GST\", so the tax credit is reversed too.");
    return draft("purchase-return", `Goods worth ${money(amount)} sent back${who ? ` to ${who}` : ""}`, "journal", [
      { account: "2010", debit: amount, memo: who }, { account: "5000", credit: amount }
    ], { party: who, notes: notes.filter((n) => !n.startsWith("Taken as")) });
  }
  if (has(t, /\b(discount (received|mila|given by)|settled .* for less|full and final|full settlement)\b/) && has(t, /\b(supplier|vendor|paid|to)\b/)) {
    const second = amounts[1]?.minor;
    const who = partyIn(text, /\b(to|from|with)\b/i);
    if (second && second !== amount) {
      const paid = Math.min(amount, second);
      const owed = Math.max(amount, second);
      return draft("supplier-settlement", `${money(owed)} owed${who ? ` to ${who}` : ""} settled with ${money(paid)}, ${money(owed - paid)} discount`, "payment", [
        { account: "2010", debit: owed, memo: who }, { account: acct.code, credit: paid }, { account: "4910", credit: owed - paid }
      ], { party: who, amountMinor: owed });
    }
    return draft("discount-received", `Discount of ${money(amount)} received${who ? ` from ${who}` : ""}`, "journal", [
      { account: "2010", debit: amount, memo: who }, { account: "4910", credit: amount }
    ], { party: who, notes: notes.filter((n) => !n.startsWith("Taken as")) });
  }

  /* plain income and costs not on an invoice or a bill */
  if (has(t, /\b(interest|byaj|byaaj)\b/) && has(t, /\b(received|credited|earned|got|mila|aaya)\b/)) {
    return draft("interest-received", `Interest of ${money(amount)} received`, "receipt", [
      { account: acct.code, debit: amount }, { account: "4200", credit: amount }
    ]);
  }
  if (has(t, /\b(received|got|mila|mile|aaya|aaye|credited)\b/) && has(t, /\b(commission|rent received|incentive|cashback|refund|subsidy|scrap|dividend)\b/)) {
    return draft("other-income", `${money(amount)} of other income received`, "receipt", [
      { account: acct.code, debit: amount }, { account: "4100", credit: amount }
    ]);
  }
  if (has(t, /\b(paid|pay|diya|diye|bhara|spent|kharch\w*)\b/)) {
    const exp = expenseAccount(t);
    notes.push("For a bill with GST on it, record it in Money out instead, so the tax credit is claimed.");
    if (exp.code === "6900") notes.push("Put in Other expenses. Name the cost, such as rent or salary, to put it in its own account.");
    return draft("expense-paid", `${money(amount)} paid for ${exp.word ?? "a cost"}`, "payment", [
      { account: exp.code, debit: amount }, { account: acct.code, credit: amount }
    ]);
  }

  return {
    ok: false,
    says: "That one is not clear enough to turn into an entry. Try naming what happened, such as \"Paid GST 42,300\", \"Took 50k for home\" or \"Loan of 5 lakh from HDFC\"."
  };
}

/** Several lines at once, one sentence per line, as typed. */
export function parseLines(text: string, ctx: ParseContext): Array<{ sentence: string; result: Parsed }> {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 50).map((sentence) => ({ sentence, result: parseSentence(sentence, ctx) }));
}

/** The kinds of sentences it understands, as examples for the screen. */
export const EXAMPLES = [
  "Started the business with 5 lakh in the bank",
  "Took 25k cash for home",
  "Loan of 10 lakh from HDFC Bank credited",
  "Paid EMI 32,000 to HDFC, interest 9,500",
  "Deposited 40,000 cash in bank",
  "Paid GST 42,300 for October",
  "Paid TDS 6,200",
  "Made an FD of 2 lakh",
  "Bank charges 590",
  "Rent of 30,000 for March is outstanding",
  "Insurance 12,000 is prepaid for next year",
  "Sharma ji ka cheque 15,000 bounced",
  "Ghar ke liye 10 hazaar cash nikale"
];
