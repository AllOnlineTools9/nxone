import { describe, expect, it } from "vitest";
import { NotATwoB, chaseMessage, invoiceKey, numberKey, portalDate, portalPeriod, readTwoB, reconcile, type PurchaseRecord } from "@/lib/returns/gstr2b";

/** A statement shaped the way the portal writes one, wrapper and all. */
const file = (over: Record<string, unknown> = {}) => JSON.stringify({
  data: {
    gstin: "29AAGCB7383J1Z4",
    rtnprd: "092026",
    gendt: "14-10-2026",
    docdata: {
      b2b: [
        {
          ctin: "27AAFCI5678K1ZY", trdnm: "Initech LLP",
          inv: [{
            inum: "INI/2026/0042", dt: "14-09-2026", val: 59000, pos: "27", rev: "N", itcavl: "Y",
            items: [{ num: 1, rt: 18, txval: 50000, igst: 9000, cgst: 0, sgst: 0, cess: 0 }],
            igst: 9000, cgst: 0, sgst: 0, cess: 0
          }]
        },
        {
          ctin: "29AACCG1234M1ZJ", trdnm: "Cloud Hosting Co",
          inv: [{
            inum: "CH-881", dt: "02-09-2026", val: 5310, pos: "29", itcavl: "Y",
            igst: 0, cgst: 405, sgst: 405, cess: 0
          }]
        }
      ],
      cdnr: [
        {
          ctin: "27AAFCI5678K1ZY", trdnm: "Initech LLP",
          nt: [{ nt_num: "CN-7", nt_dt: "20-09-2026", val: 5900, itcavl: "Y", igst: 900, cgst: 0, sgst: 0 }]
        }
      ],
      ...(over.docdata as object ?? {})
    },
    ...over
  }
});

const purchase = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: "e1", date: "2026-09-14", supplier: "Initech LLP", supplierGstin: "27AAFCI5678K1ZY",
  reference: "INI/2026/0042", netMinor: 5000000, taxMinor: 900000, ...over
});

/* ------------------------------------------------------------------ reading */

describe("reading the portal's file", () => {
  const read = readTwoB(file());

  it("finds the statement however deeply the file wraps it", () => {
    expect(read.invoices).toHaveLength(3);
    expect(readTwoB(JSON.stringify({ docdata: { b2b: [] } })).invoices).toHaveLength(0);
  });

  it("reads who it is for and what period it covers", () => {
    expect(read.gstin).toBe("29AAGCB7383J1Z4");
    expect(read.period).toBe("2026-09");
    expect(read.generatedOn).toBe("2026-10-14");
  });

  it("turns the portal's dates round", () => {
    expect(portalDate("14-09-2026")).toBe("2026-09-14");
    expect(portalDate("nonsense")).toBe("");
    expect(portalPeriod("092026")).toBe("2026-09");
    expect(portalPeriod("2026-09")).toBeUndefined();
  });

  it("takes the taxable value from the line items, not from the invoice total", () => {
    // val is 59,000 including tax. Treating it as taxable would overstate every claim.
    const inv = read.invoices.find((i) => i.number === "INI/2026/0042")!;
    expect(inv.taxableMinor).toBe(5000000);
    expect(inv.valueMinor).toBe(5900000);
  });

  it("works the taxable value back from the total when there are no line items", () => {
    const inv = read.invoices.find((i) => i.number === "CH-881")!;
    expect(inv.taxableMinor).toBe(450000);
    expect(inv.totalTaxMinor).toBe(81000);
  });

  it("counts a credit note the other way, because it reduces what can be claimed", () => {
    const note = read.invoices.find((i) => i.number === "CN-7")!;
    expect(note.kind).toBe("credit-note");
    expect(note.totalTaxMinor).toBe(-90000);
    expect(note.taxableMinor).toBeLessThan(0);
  });

  it("accepts the other spelling of the tax fields that some exports use", () => {
    const other = readTwoB(JSON.stringify({ docdata: { b2b: [{ ctin: "27AAFCI5678K1ZY", inv: [{ inum: "X1", dt: "01-09-2026", val: 1180, iamt: 180 }] }] } }));
    expect(other.invoices[0].totalTaxMinor).toBe(18000);
    expect(other.invoices[0].taxableMinor).toBe(100000);
  });

  it("names the sections it cannot read instead of looking complete", () => {
    const withImports = readTwoB(JSON.stringify({ docdata: { b2b: [], impg: [{ boe: 1 }, { boe: 2 }] } }));
    expect(withImports.skipped).toEqual([{ section: "IMPG", count: 2, why: "goods imported through customs" }]);
  });

  it("says plainly when the file is the wrong one", () => {
    expect(() => readTwoB("not json at all")).toThrow(NotATwoB);
    expect(() => readTwoB('{"hello":"world"}')).toThrow(/GSTR-2B/);
  });
});

/* ----------------------------------------------------------------- matching */

describe("matching invoice numbers typed by two different people", () => {
  it("ignores punctuation and padding", () => {
    expect(numberKey("INV/2026/0012")).toBe(numberKey("inv-2026-12"));
    expect(numberKey("CH 881")).toBe("CH881");
  });

  it("does not collapse genuinely different numbers", () => {
    expect(numberKey("INV-12")).not.toBe(numberKey("INV-13"));
    expect(invoiceKey("27AAFCI5678K1ZY", "A1")).not.toBe(invoiceKey("29AACCG1234M1ZJ", "A1"));
  });
});

describe("the reconciliation", () => {
  const portal = readTwoB(file()).invoices.filter((i) => i.kind === "invoice");

  it("agrees when the two sides agree", () => {
    const out = reconcile([portal[0]], [purchase()]);
    expect(out.rows[0].state).toBe("matched");
    expect(out.claimedMinor).toBe(900000);
    expect(out.atRiskMinor).toBe(0);
  });

  it("forgives a rupee of rounding between two systems", () => {
    const out = reconcile([portal[0]], [purchase({ taxMinor: 900090 })]);
    expect(out.rows[0].state).toBe("matched");
  });

  it("flags a purchase the supplier has not filed, which is the whole point", () => {
    const out = reconcile([], [purchase()]);
    expect(out.rows[0].state).toBe("only-in-your-books");
    expect(out.atRiskMinor).toBe(900000);
    expect(out.rows[0].advice).toContain("not available until they do");
  });

  it("flags credit sitting on the portal that you never recorded", () => {
    const out = reconcile([portal[0]], []);
    expect(out.rows[0].state).toBe("only-on-the-portal");
    expect(out.unrecordedMinor).toBe(900000);
  });

  it("warns hardest when your books claim more than the portal allows", () => {
    const out = reconcile([portal[0]], [purchase({ taxMinor: 1200000 })]);
    expect(out.rows[0].state).toBe("different-amount");
    expect(out.rows[0].differenceMinor).toBe(-300000);
    expect(out.rows[0].advice).toContain("triggers a notice");
  });

  it("says the opposite when the portal shows more than you claimed", () => {
    const out = reconcile([portal[0]], [purchase({ taxMinor: 500000 })]);
    expect(out.rows[0].advice).toContain("less than you are entitled to");
  });

  it("keeps credit the portal has blocked out of what is available", () => {
    const blocked = { ...portal[0], itcAvailable: false, itcReason: "Return filed after the cut-off" };
    const out = reconcile([blocked], [purchase()]);
    expect(out.rows[0].state).toBe("cannot-be-claimed");
    expect(out.availableMinor).toBe(0);
    expect(out.rows[0].advice).toContain("after the cut-off");
  });

  it("tells you which purchases cannot be matched at all, and why", () => {
    const out = reconcile([], [purchase({ supplierGstin: undefined })]);
    expect(out.rows[0].state).toBe("no-gstin");
    expect(out.rows[0].advice).toContain("GSTIN");
    expect(out.atRiskMinor).toBe(0);
  });

  it("counts every state, including the ones with nothing in them", () => {
    const out = reconcile([portal[0]], [purchase()]);
    expect(out.counts).toEqual({
      matched: 1, "different-amount": 0, "only-on-the-portal": 0, "credit-note-not-recorded": 0,
      "only-in-your-books": 0, "cannot-be-claimed": 0, "no-gstin": 0
    });
  });

  it("does not tell you to claim a credit note nobody recorded", () => {
    const note = readTwoB(file()).invoices.find((i) => i.kind === "credit-note")!;
    const out = reconcile([note], []);
    expect(out.rows[0].state).toBe("credit-note-not-recorded");
    expect(out.rows[0].advice).toContain("come down");
    expect(out.unrecordedMinor).toBe(0);
    expect(out.creditNotesMinor).toBe(-90000);
  });

  it("still lets a credit note reduce the credit the portal allows", () => {
    const note = readTwoB(file()).invoices.find((i) => i.kind === "credit-note")!;
    expect(reconcile([portal[0], note], [purchase()]).availableMinor).toBe(810000);
  });

  it("says nothing about a cash purchase that carried no tax", () => {
    const out = reconcile([], [purchase({ supplierGstin: undefined, taxMinor: 0 })]);
    expect(out.rows).toHaveLength(0);
  });

  it("gathers the suppliers worth chasing, the costliest first", () => {
    const out = reconcile([], [
      purchase({ id: "a", taxMinor: 100000 }),
      purchase({ id: "b", reference: "INI/2026/0043", taxMinor: 400000 }),
      purchase({ id: "c", supplier: "Cloud Hosting Co", supplierGstin: "29AACCG1234M1ZJ", reference: "CH-881", taxMinor: 81000 })
    ]);
    expect(out.chase[0].supplier).toBe("Initech LLP");
    expect(out.chase[0].missing).toBe(2);
    expect(out.chase[0].taxMinor).toBe(500000);
    expect(out.chase[1].supplier).toBe("Cloud Hosting Co");
  });
});

describe("the message to a supplier who has not filed", () => {
  const out = reconcile([], [purchase(), purchase({ id: "b", reference: "INI/2026/0043", date: "2026-09-20", taxMinor: 400000 })]);
  const message = chaseMessage(out.chase[0], out.rows, "Brightline Studio", "September 2026",
    (m) => `₹${(m / 100).toFixed(2)}`, (d) => d.split("-").reverse().join("/"));

  it("names the invoices rather than asking vaguely about missing credit", () => {
    expect(message.body).toContain("INI/2026/0042");
    expect(message.body).toContain("20/09/2026");
  });

  it("says what it is worth, which is what gets it acted on", () => {
    expect(message.body).toContain("₹13000.00");
  });

  it("allows that they may have filed late rather than accusing them", () => {
    expect(message.body).toContain("may appear next month");
  });

  it("is written in the singular when only one invoice is missing", () => {
    const one = reconcile([], [purchase()]);
    const said = chaseMessage(one.chase[0], one.rows, "Brightline Studio", "September 2026", (m) => `₹${m / 100}`, (d) => d);
    expect(said.body).toContain("An invoice from you is not appearing");
  });
});
