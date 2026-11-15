import { describe, expect, it } from "vitest";
import { canConvert, conversionsFor, convertTo, describeConversion } from "@/lib/documents/convert";
import { sendLinks, sendMessage, fileNameFor } from "@/lib/documents/send";
import { calculate } from "@/lib/documents/totals";
import { kindConfig } from "@/lib/documents/kinds";
import type { DocumentData } from "@/lib/documents/types";

const quote = (over: Partial<DocumentData> = {}): DocumentData => ({
  kind: "quote", country: "IN", currency: "INR", issueDate: "2026-10-01", number: "QUO-0003",
  dueDate: "2026-10-31",
  seller: { name: "Brightline Studio", region: "KA", taxId: "29AAGCB7383J1Z4", email: "hello@brightline.example" },
  buyer: { name: "Anita Rao", region: "KA", email: "anita@globex.example", phone: "9845011111" },
  placeOfSupply: "KA",
  items: [{ id: "l1", description: "Brand identity", quantity: 1, rate: 50000, taxRuleId: "in-gst-18" }],
  taxInclusive: false,
  terms: kindConfig("quote").defaultTerms,
  notes: "",
  signatoryName: "Ronak",
  ...over
} as DocumentData);

const TODAY = "2026-11-15";

/* ------------------------------------------------------------ what follows what */

describe("what a document can become", () => {
  it("offers an invoice from an accepted quotation", () => {
    expect(conversionsFor("quote").map((c) => c.to)).toEqual(["invoice", "proforma"]);
    expect(canConvert("quote", "invoice")).toBe(true);
  });

  it("offers a receipt or a credit note from an invoice", () => {
    expect(conversionsFor("invoice").map((c) => c.to)).toEqual(["receipt", "credit-note"]);
  });

  it("offers nothing from a receipt, which is the end of the line", () => {
    expect(conversionsFor("receipt")).toEqual([]);
    expect(canConvert("receipt", "invoice")).toBe(false);
  });

  it("offers nothing from a purchase order, which goes to a supplier rather than a customer", () => {
    expect(conversionsFor("purchase-order")).toEqual([]);
  });

  it("says why you would, not just what it is called", () => {
    expect(conversionsFor("quote")[0].describes).toContain("accepted");
  });
});

/* --------------------------------------------------------- quotation to invoice */

describe("a quotation becoming an invoice", () => {
  const invoice = convertTo(quote(), "invoice", {
    today: TODAY, number: "INV-0012",
    profile: { paymentDetails: "HDFC Bank\n50100123456789\nHDFC0001234", upiId: "brightline@okaxis" }
  });

  it("keeps who it is for and what it is for", () => {
    expect(invoice.buyer.name).toBe("Anita Rao");
    expect(invoice.items).toEqual(quote().items);
    expect(invoice.placeOfSupply).toBe("KA");
  });

  it("comes to the same money, which is the point of not retyping it", () => {
    expect(calculate(invoice).total.minor).toBe(calculate(quote()).total.minor);
  });

  it("takes the next number from your invoice series, not the quotation's", () => {
    expect(invoice.number).toBe("INV-0012");
  });

  it("is dated today and due by the invoice terms, not the quotation's validity", () => {
    expect(invoice.issueDate).toBe(TODAY);
    expect(invoice.dueDate).toBe("2026-11-29");
  });

  it("points back at the quotation, so the two can be read together", () => {
    expect(invoice.reference).toBe("QUO-0003");
    expect(describeConversion(quote(), "invoice")).toContain("QUO-0003");
  });

  it("gains the bank details an invoice needs and a quotation never carried", () => {
    expect(invoice.paymentDetails).toContain("HDFC");
    expect(invoice.payment?.upiId).toBe("brightline@okaxis");
  });

  it("drops the quotation's wording about accepting it in writing", () => {
    expect(invoice.terms).not.toContain("accepted in writing");
  });

  it("keeps wording the person wrote themselves", () => {
    const mine = convertTo(quote({ terms: "Half up front, half on delivery." }), "invoice", { today: TODAY });
    expect(mine.terms).toBe("Half up front, half on delivery.");
  });

  it("steps the old number on when no series is set, rather than reusing it", () => {
    expect(convertTo(quote(), "invoice", { today: TODAY }).number).toBe("QUO-0004");
  });
});

/* ------------------------------------------------------------ the other routes */

describe("an invoice becoming something else", () => {
  const invoice = quote({ kind: "invoice", number: "INV-0012", amountPaid: 59000, terms: "" });

  it("becomes a receipt that is not asking for money again", () => {
    const receipt = convertTo(invoice, "receipt", { today: TODAY, number: "RCP-0004" });
    expect(receipt.kind).toBe("receipt");
    expect(receipt.dueDate).toBeUndefined();
    expect(receipt.paymentDetails).toBeUndefined();
    expect(receipt.payment).toBeUndefined();
    expect(receipt.notes).toContain("with thanks");
  });

  it("becomes a credit note that says what it is cancelling", () => {
    const note = convertTo(invoice, "credit-note", { today: TODAY, number: "CN-0001" });
    expect(note.kind).toBe("credit-note");
    expect(note.reference).toBe("INV-0012");
    expect(note.notes).toContain("adjusts the invoice");
  });

  it("starts the new document owing the full amount again", () => {
    expect(convertTo(invoice, "credit-note", { today: TODAY }).amountPaid).toBeUndefined();
  });

  it("keeps the payment reference on a receipt, where it belongs, and nowhere else", () => {
    const paid = quote({ kind: "invoice", paymentReference: "UPI 4411", terms: "" });
    expect(convertTo(paid, "receipt", { today: TODAY }).paymentReference).toBe("UPI 4411");
    expect(convertTo(paid, "credit-note", { today: TODAY }).paymentReference).toBeUndefined();
  });
});

/* -------------------------------------------------------------- sending it out */

describe("the message that goes with a document", () => {
  const doc = quote({
    kind: "invoice", number: "INV-0012", dueDate: "2026-11-29", terms: "",
    paymentDetails: "HDFC Bank\n50100123456789",
    payment: { upiId: "brightline@okaxis", includeAmount: true }
  });
  const message = sendMessage(doc, calculate(doc));

  it("says what it is in the subject, so an inbox is searchable", () => {
    expect(message.subject).toBe("Invoice INV-0012 from Brightline Studio");
  });

  it("opens with the customer's first name rather than Dear Sir or Madam", () => {
    expect(message.body.startsWith("Hello Anita,")).toBe(true);
  });

  it("gives the amount and the date without making them hunt for it", () => {
    expect(message.body).toContain("₹59,000.00");
    expect(message.body).toContain("due on");
  });

  it("says what it is for, from the lines themselves", () => {
    expect(message.body).toContain("Brand identity");
  });

  it("lists only the ways to pay that are actually set up", () => {
    expect(message.body).toContain("UPI to brightline@okaxis");
    expect(message.body).toContain("50100123456789");
  });

  it("invents no payment method when none is set", () => {
    const bare = quote({ kind: "invoice", terms: "", paymentDetails: undefined, payment: undefined });
    const plain = sendMessage(bare, calculate(bare));
    expect(plain.body).not.toContain("You can pay by");
    expect(plain.body).toContain("Let me know if you need any other details");
  });

  it("signs off with the person, not the software", () => {
    expect(message.body.trim().endsWith("Ronak")).toBe(true);
    expect(message.body).not.toContain("NXOne");
  });

  it("asks a different question of a quotation than of an invoice", () => {
    const q = quote();
    expect(sendMessage(q, calculate(q)).body).toContain("would like to go ahead");
  });

  it("thanks somebody for a receipt instead of asking them for anything", () => {
    const r = quote({ kind: "receipt", number: "RCP-0004", dueDate: undefined, terms: "" });
    const said = sendMessage(r, calculate(r));
    expect(said.body).toContain("with thanks");
    expect(said.body).not.toContain("You can pay by");
  });

  it("keeps the WhatsApp version to something somebody would actually read", () => {
    expect(message.short.length).toBeLessThan(160);
    expect(message.short).toContain("INV-0012");
    expect(message.short).toContain("Sending the PDF now");
  });
});

describe("where the message goes", () => {
  const doc = quote({ kind: "invoice", terms: "" });

  it("writes a mail draft to the address on the document", () => {
    const links = sendLinks(doc, calculate(doc));
    expect(links.mail?.startsWith("mailto:anita@globex.example?subject=")).toBe(true);
    expect(links.noContact).toBe(false);
  });

  it("writes a WhatsApp link, adding the country code to a ten-digit number", () => {
    expect(sendLinks(doc, calculate(doc)).whatsapp).toContain("wa.me/919845011111");
  });

  it("offers no link it cannot honour, and says there is nobody to send to", () => {
    const anonymous = quote({ kind: "invoice", buyer: { name: "A customer", region: "KA" }, terms: "" });
    const links = sendLinks(anonymous, calculate(anonymous));
    expect(links.mail).toBeUndefined();
    expect(links.whatsapp).toBeUndefined();
    expect(links.noContact).toBe(true);
    // the words are still there to copy
    expect(links.text.body).toContain("Hello A,");
  });

  it("names the file so an inbox full of them stays readable", () => {
    expect(fileNameFor(doc)).toBe("QUO-0003-Anita-Rao.pdf");
    expect(fileNameFor(quote({ number: "INV/2026/12", buyer: { name: "Globex & Co" } }))).toBe("INV-2026-12-Globex-Co.pdf");
  });
});
