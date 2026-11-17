import { describe, expect, it } from "vitest";
import { crc32, makeZip } from "@/lib/files/zip";
import { coveringNote, packFileName, packFiles, packMessage, salesCsv, trialBalanceCsv, type PackInput } from "@/lib/reports/pack";
import { statementCsv, statementFor, statementLinks, statementMessage } from "@/lib/analysis/statement";
import { ledgerFor } from "@/lib/ledger/posting";
import type { Expense, SavedDocument } from "@/lib/store/types";

/* ----------------------------------------------------------------- the archive */

describe("writing a zip by hand", () => {
  it("computes the CRC the standard does", () => {
    // The check value every CRC-32 implementation is tested against.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("starts with the local file header signature a reader looks for", () => {
    const zip = makeZip([{ name: "a.csv", text: "x" }]);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("ends with the central directory, which is how a reader finds anything at all", () => {
    const zip = makeZip([{ name: "a.csv", text: "x" }, { name: "b/c.csv", text: "yy" }]);
    const end = zip.length - 22;
    const view = new DataView(zip.buffer, zip.byteOffset);
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2); // two files recorded
  });

  it("stores what it was given, byte for byte, so nothing needs decompressing", () => {
    const text = "Account,Amount\nSales,59000.00\n";
    const zip = makeZip([{ name: "p.csv", text }]);
    expect(new TextDecoder().decode(zip).includes(text)).toBe(true);
  });

  it("marks names as UTF-8, so a rupee sign survives the trip", () => {
    const zip = makeZip([{ name: "books/₹-summary.csv", text: "₹59,000" }]);
    const view = new DataView(zip.buffer, zip.byteOffset);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
  });

  it("writes an empty archive rather than an invalid one", () => {
    expect(makeZip([]).length).toBe(22);
  });
});

/* -------------------------------------------------------------- the books pack */

const docs: SavedDocument[] = [
  {
    id: "d1", kind: "invoice", number: "INV-0010", clientName: "Globex", issueDate: "2026-09-04",
    dueDate: "2026-09-18", currency: "INR", totalMinor: 5900000, paidMinor: 5900000, status: "paid",
    createdAt: "2026-09-04T00:00:00Z", updatedAt: "2026-09-04T00:00:00Z", version: 1,
    doc: {
      kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-04", number: "INV-0010",
      seller: { name: "Brightline Studio", region: "KA" }, buyer: { name: "Globex", region: "KA", email: "ap@globex.example", phone: "9845022222" },
      placeOfSupply: "KA", taxInclusive: false,
      items: [{ id: "l", description: "Design", quantity: 1, rate: 50000, taxRuleId: "in-gst-18" }]
    }
  } as SavedDocument,
  {
    id: "d2", kind: "invoice", number: "INV-0011", clientName: "Globex", issueDate: "2026-09-20",
    dueDate: "2026-10-04", currency: "INR", totalMinor: 2360000, paidMinor: 1000000, status: "partly-paid",
    createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", version: 1,
    doc: {
      kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-09-20", number: "INV-0011",
      seller: { name: "Brightline Studio", region: "KA" }, buyer: { name: "Globex", region: "KA", email: "ap@globex.example", phone: "9845022222" },
      placeOfSupply: "KA", taxInclusive: false,
      items: [{ id: "l", description: "Retainer", quantity: 1, rate: 20000, taxRuleId: "in-gst-18" }]
    }
  } as SavedDocument
];

const expenses: Expense[] = [{
  id: "e1", date: "2026-09-10", supplier: "Cloud Hosting Co", description: "September servers",
  category: "6040", currency: "INR", netMinor: 450000, taxMinor: 81000, paidFrom: "1020",
  createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z", version: 1
} as Expense];

const input = (): PackInput => ({
  businessName: "Brightline Studio", taxId: "29AAGCB7383J1Z4", country: "IN", currency: "INR",
  period: { from: "2026-09-01", to: "2026-09-30", label: "September 2026" },
  entries: ledgerFor(docs, expenses, "INR"),
  documents: docs, expenses, preparedOn: "2026-10-02"
});

describe("the folder an accountant receives", () => {
  const files = packFiles(input());
  const named = (end: string) => files.find((f) => f.name.endsWith(end))!;

  it("holds the statements, the workings and the documents behind them", () => {
    expect(files.map((f) => f.name.split("/")[1])).toEqual([
      "README.txt", "profit-and-loss.csv", "balance-sheet.csv",
      "trial-balance.csv", "journal.csv", "sales.csv", "expenses.csv"
    ]);
  });

  it("puts everything in one named folder, so it does not explode over a desktop", () => {
    expect(files.every((f) => f.name.startsWith("Brightline-Studio-2026-09/"))).toBe(true);
  });

  it("writes money as a number a spreadsheet can add up, not as ₹59,000.00", () => {
    // 70,000 taxable across the two invoices, not the 82,600 billed: the GST on top is
    // collected for the government and never was income.
    expect(named("profit-and-loss.csv").text).toContain("70000.00");
    expect(named("profit-and-loss.csv").text).not.toContain("₹");
  });

  it("quotes a field containing a comma rather than splitting the row", () => {
    const withComma = { ...input(), businessName: "Brightline Studio, Bengaluru" };
    expect(salesCsv({ ...withComma, documents: [{ ...docs[0], clientName: "Globex, Inc" }] as SavedDocument[] }))
      .toContain('"Globex, Inc"');
  });

  it("keeps the trial balance in balance, which is the whole point of double entry", () => {
    const rows = trialBalanceCsv(input().entries, input()).trim().split("\n");
    const total = rows[rows.length - 1].split(",");
    expect(total[3]).toBe(total[4]);
  });

  it("names the file so it can be found in a download folder in March", () => {
    expect(packFileName(input())).toBe("brightline-studio-books-2026-09.zip");
  });
});

describe("the covering note", () => {
  const note = coveringNote(input());

  it("says whose books these are and what they cover", () => {
    expect(note).toContain("Brightline Studio");
    expect(note).toContain("29AAGCB7383J1Z4");
    expect(note).toContain("01/09/2026");
  });

  it("gives the headline figures before any file is opened", () => {
    expect(note).toContain("Net profit");
    expect(note).toContain("Owed to us");
  });

  it("says the books balance, because the first thing an accountant checks is whether they do", () => {
    expect(note).toContain("The balance sheet balances.");
  });

  it("says plainly that no accountant has reviewed this", () => {
    expect(note).toContain("not reviewed by one");
  });

  it("owns up when the sheet does not balance instead of staying quiet", () => {
    // Every entry balances by construction, so the books can only go out by losing a line.
    const entries = input().entries;
    const broken = { ...input(), entries: [{ ...entries[0], lines: entries[0].lines.slice(0, 1) }, ...entries.slice(1)] };
    expect(coveringNote(broken)).toContain("does not balance");
  });
});

describe("the note that goes with the folder", () => {
  const message = packMessage(input());

  it("says what it is and for when", () => {
    expect(message.subject).toBe("Brightline Studio - books for September 2026");
  });

  it("puts the figures in the message, so a phone is enough to spot something wrong", () => {
    expect(message.body).toContain("₹");
    expect(message.body).toContain("net profit");
  });

  it("invites a correction rather than presenting the books as settled", () => {
    expect(message.body).toContain("anything looks wrong");
  });
});

/* ------------------------------------------------------------- the statement */

describe("what one customer owes", () => {
  const statement = statementFor(docs, "Globex", { asOf: "2026-11-15", currency: "INR" });

  it("lists every invoice, paid ones included, which is what makes it a statement", () => {
    expect(statement.lines.map((l) => l.number)).toEqual(["INV-0010", "INV-0011"]);
  });

  it("owes what is left after part payment, not the whole invoice", () => {
    expect(statement.outstandingMinor).toBe(1360000);
  });

  it("counts a credit note against the balance rather than towards it", () => {
    const withCredit = statementFor(
      [...docs, { ...docs[0], id: "d3", kind: "credit-note", number: "CN-0001", totalMinor: 360000, paidMinor: 0, status: "sent" } as SavedDocument],
      "Globex", { asOf: "2026-11-15", currency: "INR" }
    );
    expect(withCredit.outstandingMinor).toBe(1000000);
  });

  it("ignores a quotation, which is not a claim for money", () => {
    const withQuote = statementFor(
      [...docs, { ...docs[0], id: "d4", kind: "quote", number: "QUO-9", totalMinor: 9900000 } as SavedDocument],
      "Globex", { asOf: "2026-11-15", currency: "INR" }
    );
    expect(withQuote.outstandingMinor).toBe(1360000);
  });

  it("ignores a cancelled invoice and anything issued after the date asked for", () => {
    const cancelled = statementFor([{ ...docs[1], status: "cancelled" } as SavedDocument], "Globex", { asOf: "2026-11-15", currency: "INR" });
    expect(cancelled.outstandingMinor).toBe(0);
    const earlier = statementFor(docs, "Globex", { asOf: "2026-09-10", currency: "INR" });
    expect(earlier.lines.map((l) => l.number)).toEqual(["INV-0010"]);
  });

  it("ages what is owed, which is the part read first", () => {
    expect(statement.ageing).toEqual([{ label: "31 to 60 days", minor: 1360000 }]);
  });

  it("counts lateness from the due date, not the invoice date", () => {
    expect(statement.lines[1].daysLate).toBe(42);
  });

  it("does not call something late before it is due", () => {
    const fresh = statementFor(docs, "Globex", { asOf: "2026-09-25", currency: "INR" });
    expect(fresh.lines[1].daysLate).toBe(0);
    expect(fresh.ageing).toEqual([{ label: "Not due yet", minor: 1360000 }]);
  });
});

describe("the statement as a message", () => {
  const statement = statementFor(docs, "Globex", { asOf: "2026-11-15", currency: "INR" });
  const message = statementMessage(statement, { businessName: "Brightline Studio", signatoryName: "Ronak" });

  it("lists what is open rather than only a total, because a list is harder to argue with", () => {
    expect(message.body).toContain("INV-0011");
    expect(message.body).toContain("₹10,000.00 paid");
    expect(message.body).toContain("42 days overdue");
  });

  it("leaves out what is settled, which is not what the message is about", () => {
    expect(message.body).not.toContain("INV-0010");
  });

  it("asks when it will be paid, and offers to look into a dispute", () => {
    expect(message.body).toContain("when these will be paid");
    expect(message.body).toContain("in dispute");
  });

  it("thanks a customer who owes nothing instead of chasing them", () => {
    const settled = statementFor([docs[0]], "Globex", { asOf: "2026-11-15", currency: "INR" });
    const said = statementMessage(settled, { businessName: "Brightline Studio" });
    expect(said.body).toContain("Everything is settled");
    expect(said.body).not.toContain("when these will be paid");
  });

  it("goes to the address and number on the customer's documents", () => {
    const links = statementLinks(statement, { businessName: "Brightline Studio" }, { email: "ap@globex.example", phone: "9845022222" });
    expect(links.mail?.startsWith("mailto:ap@globex.example")).toBe(true);
    expect(links.whatsapp).toContain("wa.me/919845022222");
  });

  it("exports as a spreadsheet that totals to the same figure", () => {
    const rows = statementCsv(statement).trim().split("\n");
    expect(rows[rows.length - 1]).toContain("13600.00");
  });
});

/* ------------------------------------------------- when the money actually arrived */

describe("the day a payment is booked", () => {
  const make = (over: Partial<SavedDocument>): SavedDocument => ({ ...docs[0], ...over } as SavedDocument);

  it("uses the day the money arrived, not the day the record was last touched", () => {
    const paid = make({ paidOn: "2026-09-29", updatedAt: "2026-12-31T00:00:00Z", status: "paid", paidMinor: 5900000 });
    const entries = ledgerFor([paid], [], "INR");
    expect(entries.find((e) => e.source.kind === "payment")?.date).toBe("2026-09-29");
  });

  it("does not move the cash when a paid invoice is edited months later", () => {
    const before = ledgerFor([make({ paidOn: "2026-09-29", updatedAt: "2026-09-29T00:00:00Z", status: "paid", paidMinor: 5900000 })], [], "INR");
    const after = ledgerFor([make({ paidOn: "2026-09-29", updatedAt: "2027-03-14T00:00:00Z", status: "paid", paidMinor: 5900000 })], [], "INR");
    const dateOf = (list: typeof before) => list.find((e) => e.source.kind === "payment")?.date;
    expect(dateOf(after)).toBe(dateOf(before));
  });

  it("falls back to the old guess for a record made before the day was kept", () => {
    const old = make({ paidOn: undefined, updatedAt: "2026-09-29T00:00:00Z", status: "paid", paidMinor: 5900000 });
    expect(ledgerFor([old], [], "INR").find((e) => e.source.kind === "payment")?.date).toBe("2026-09-29");
  });

  it("keeps a part payment out of the month the invoice was raised in, once the day is known", () => {
    const part = make({ paidOn: "2026-10-20", status: "partly-paid", paidMinor: 1000000, issueDate: "2026-09-04" });
    expect(ledgerFor([part], [], "INR").find((e) => e.source.kind === "payment")?.date).toBe("2026-10-20");
  });
});
