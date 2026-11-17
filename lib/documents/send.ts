import { formatDate, mailtoLink, whatsappLink } from "../format";
import { formatMoney } from "../money";
import { kindConfig } from "./kinds";
import type { DocumentData, DocumentTotals } from "./types";

/**
 * Getting the document to the person who has to act on it.
 *
 * NXOne has no server of its own to send mail from, and will not pretend otherwise: these
 * open the person's own email or WhatsApp with the message already written, and the document
 * goes as the PDF they have just saved. It is their message, from their address, which is also
 * the version a customer is most likely to reply to.
 *
 * The one thing a draft like this cannot do is attach the file, so every screen that offers it
 * says so plainly rather than letting somebody send an empty-handed email.
 */

export interface SendMessage {
  subject: string;
  /** For email: several short paragraphs. */
  body: string;
  /** For WhatsApp or a text: two lines at most. */
  short: string;
}

const firstName = (name: string) => name.split(/[\s,]+/)[0] || "there";

/** What the document is for, in a few words, when that can be said honestly. */
function about(doc: DocumentData): string {
  const lines = doc.items.filter((i) => i.description.trim());
  if (!lines.length) return "";
  if (lines.length === 1) return lines[0].description.trim();
  return `${lines[0].description.trim()} and ${lines.length - 1} other ${lines.length === 2 ? "item" : "items"}`;
}

/** How they can pay, where that has been set up. Never invented. */
function payBy(doc: DocumentData): string[] {
  const ways: string[] = [];
  if (doc.payment?.upiId) ways.push(`UPI to ${doc.payment.upiId}`);
  if (doc.payment?.paymentLink) ways.push(doc.payment.paymentLink);
  if (doc.paymentDetails?.trim()) ways.push(...doc.paymentDetails.trim().split("\n").map((l) => l.trim()).filter(Boolean));
  return ways;
}

export function sendMessage(doc: DocumentData, totals: DocumentTotals, locale = "en-IN", viewUrl?: string): SendMessage {
  const cfg = kindConfig(doc.kind);
  const business = doc.seller.name || "us";
  const who = firstName(doc.buyer.name);
  const amount = formatMoney(totals.total, locale);
  const when = doc.dueDate ? formatDate(doc.dueDate, doc.country) : "";
  const what = about(doc);
  const ways = payBy(doc);

  const title = cfg.title.toLowerCase();
  const subject = `${cfg.title} ${doc.number} from ${business}`;

  const opening: Record<string, string> = {
    invoice: `Here is invoice ${doc.number} for ${amount}${when ? `, due on ${when}` : ""}.`,
    proforma: `Here is proforma invoice ${doc.number} for ${amount}${when ? `, valid until ${when}` : ""}.`,
    quote: `Here is quotation ${doc.number} for ${amount}${when ? `, valid until ${when}` : ""}.`,
    receipt: `Here is your receipt ${doc.number} for ${amount}, with thanks.`,
    "credit-note": `Here is credit note ${doc.number} for ${amount}${doc.reference ? `, against invoice ${doc.reference}` : ""}.`,
    "purchase-order": `Here is purchase order ${doc.number} for ${amount}${when ? `, required by ${when}` : ""}.`,
    "delivery-note": `Here is delivery note ${doc.number}.`
  };

  const closing: Record<string, string> = {
    invoice: ways.length ? "" : "Let me know if you need any other details to pay it.",
    quote: "Let me know if you would like to go ahead and I will raise the invoice.",
    proforma: "Let me know once this is approved and I will send the invoice.",
    receipt: "",
    "credit-note": "",
    "purchase-order": "Please confirm you can supply this and when it will arrive.",
    "delivery-note": "Please check everything has arrived as listed."
  };

  const paragraphs = [
    `Hello ${who},`,
    "",
    opening[doc.kind] ?? `Here is ${title} ${doc.number} for ${amount}.`,
    // A link they can open on a phone, instead of an attachment neither WhatsApp nor an email
    // draft can carry. Without one, the PDF goes as an attachment the sender adds.
    ...(viewUrl ? ["", "You can view and download it here:", viewUrl] : []),
    ...(what ? [`It is for ${what}.`] : []),
    ...(ways.length ? ["", "You can pay by:", ...ways.map((w) => `  ${w}`)] : []),
    ...(closing[doc.kind] ? ["", closing[doc.kind]] : []),
    "",
    "Thanks,",
    doc.signatoryName || business
  ];

  const shortWays = doc.payment?.upiId ? ` Pay by UPI to ${doc.payment.upiId}.` : "";
  const tail = viewUrl ? ` View or download it here: ${viewUrl}` : " Sending the PDF now.";
  const short = doc.kind === "invoice"
    ? `${cfg.title} ${doc.number} for ${amount}${when ? `, due ${when}` : ""}.${shortWays}${tail}`
    : `${cfg.title} ${doc.number} for ${amount}.${tail}`;

  return { subject, body: paragraphs.join("\n"), short };
}

export interface SendLinks {
  /** Opens their email client with the message written, addressed when the document has an email. */
  mail: string;
  /** Opens WhatsApp with the short version, to the customer's number when the document has one. */
  whatsapp: string;
  /** Always available, for anything else. */
  text: SendMessage;
  /** True when there is nobody to send to, so a screen can ask for an address instead. */
  noContact: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
}

export function sendLinks(doc: DocumentData, totals: DocumentTotals, locale = "en-IN", viewUrl?: string): SendLinks {
  const text = sendMessage(doc, totals, locale, viewUrl);
  const email = doc.buyer.email?.trim() ?? "";
  const phone = doc.buyer.phone?.trim() ?? "";

  // Both always work. With no number, WhatsApp opens on the contact list to choose from; with no
  // address, the email opens with the To line empty. A button that vanishes because one detail
  // is missing is a worse answer than one that asks for it in the app you already use.
  return {
    mail: mailtoLink(email, text.subject, text.body),
    whatsapp: whatsappLink(phone, text.short),
    text,
    noContact: !email && !phone,
    hasEmail: Boolean(email),
    hasPhone: Boolean(phone)
  };
}

/** What the file should be called when it is saved, so an inbox full of them stays readable. */
export function fileNameFor(doc: DocumentData): string {
  // A slash in a number becomes a dash rather than disappearing: INV/2026/12 is three parts,
  // and running them together as INV202612 loses the shape somebody recognises.
  const tidy = (value: string) => value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [tidy(doc.number), tidy(doc.buyer.name || "")].filter(Boolean).join("-") + ".pdf";
}
