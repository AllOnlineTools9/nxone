import { formatMoney, fromMinor, toMajor } from "../money";
import { formatDate, mailtoLink, whatsappLink } from "../format";
import type { SavedDocument } from "../store/types";

/**
 * Everything one customer owes, on one page.
 *
 * The chase list says who to chase. It does not give you anything to send them, and "you owe me
 * money" is a weaker message than a list of six invoices with dates, what was paid against each
 * and what is left. Customers dispute a total; they rarely dispute a list.
 *
 * Every line is derived from the documents already recorded. Nothing here is a stored balance,
 * so a statement cannot drift away from the invoices it is made of.
 */

export interface StatementLine {
  id: string;
  date: string;
  dueDate?: string;
  number: string;
  kind: SavedDocument["kind"];
  /** What the document added to the balance: an invoice adds, a credit note takes away. */
  chargedMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  daysLate: number;
}

export interface Statement {
  customer: string;
  currency: string;
  asOf: string;
  lines: StatementLine[];
  totalChargedMinor: number;
  totalPaidMinor: number;
  outstandingMinor: number;
  /** Outstanding split by how late it is, which is the part an accountant reads first. */
  ageing: Array<{ label: string; minor: number }>;
  oldest?: StatementLine;
}

const daysBetween = (from: string, to: string): number =>
  Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** A credit note reduces what is owed, so it counts against the balance rather than towards it. */
const sign = (kind: SavedDocument["kind"]): number => (kind === "credit-note" ? -1 : 1);

/** Which documents are a claim for money at all. A quotation is not; a delivery note is not. */
const CHARGES = new Set<SavedDocument["kind"]>(["invoice", "credit-note"]);

export function statementFor(
  documents: SavedDocument[],
  customer: string,
  options: { asOf: string; currency: string }
): Statement {
  const { asOf, currency } = options;

  const lines = documents
    .filter((d) =>
      d.clientName === customer &&
      CHARGES.has(d.kind) &&
      d.status !== "cancelled" &&
      d.currency === currency &&
      d.issueDate <= asOf
    )
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number))
    .map<StatementLine>((d) => {
      const charged = d.totalMinor * sign(d.kind);
      const paid = d.paidMinor * sign(d.kind);
      const outstanding = charged - paid;
      const late = d.dueDate && outstanding > 0 ? Math.max(0, daysBetween(d.dueDate, asOf)) : 0;
      return {
        id: d.id, date: d.issueDate, dueDate: d.dueDate, number: d.number, kind: d.kind,
        chargedMinor: charged, paidMinor: paid, outstandingMinor: outstanding, daysLate: late
      };
    });

  const totalChargedMinor = lines.reduce((sum, l) => sum + l.chargedMinor, 0);
  const totalPaidMinor = lines.reduce((sum, l) => sum + l.paidMinor, 0);
  const outstandingMinor = totalChargedMinor - totalPaidMinor;

  const buckets: Array<{ label: string; upTo: number }> = [
    { label: "Not due yet", upTo: 0 },
    { label: "1 to 30 days", upTo: 30 },
    { label: "31 to 60 days", upTo: 60 },
    { label: "61 to 90 days", upTo: 90 },
    { label: "Over 90 days", upTo: Infinity }
  ];
  const ageing = buckets.map((b) => ({ label: b.label, minor: 0 }));
  for (const line of lines) {
    if (line.outstandingMinor <= 0) continue;
    const at = buckets.findIndex((b) => line.daysLate <= b.upTo);
    ageing[at === -1 ? ageing.length - 1 : at].minor += line.outstandingMinor;
  }

  const unpaid = lines.filter((l) => l.outstandingMinor > 0);
  return {
    customer, currency, asOf, lines,
    totalChargedMinor, totalPaidMinor, outstandingMinor,
    ageing: ageing.filter((a) => a.minor !== 0),
    oldest: unpaid[0]
  };
}

/* ------------------------------------------------------------ sending it */

export interface StatementMessage { subject: string; body: string; short: string }

/**
 * The statement as words. The lines go in the body rather than an attachment: a statement is
 * short enough to read in the message, and an email somebody has to open a file to understand
 * is an email that waits until later.
 */
export function statementMessage(
  statement: Statement,
  from: { businessName: string; signatoryName?: string; country?: string },
  locale = "en-IN"
): StatementMessage {
  const money = (minor: number) => formatMoney(fromMinor(minor, statement.currency), locale);
  const date = (iso: string) => formatDate(iso, from.country ?? "IN");
  const firstName = statement.customer.trim().split(/\s+/)[0] || statement.customer;

  const unpaid = statement.lines.filter((l) => l.outstandingMinor > 0);
  const rows = unpaid.map((l) => {
    const late = l.daysLate > 0 ? `, ${l.daysLate} day${l.daysLate === 1 ? "" : "s"} overdue` : "";
    const part = l.paidMinor > 0 ? ` (${money(l.paidMinor)} paid)` : "";
    return `  ${l.number}  ${date(l.date)}  ${money(l.outstandingMinor)}${part}${late}`;
  });

  const body = [
    `Hello ${firstName},`,
    ``,
    unpaid.length === 0
      ? `Here is your account with ${from.businessName} as at ${date(statement.asOf)}. Everything is settled - nothing is outstanding. Thank you.`
      : `Here is your account with ${from.businessName} as at ${date(statement.asOf)}.`,
    ...(unpaid.length === 0 ? [] : [
      ``,
      ...rows,
      ``,
      `Total outstanding: ${money(statement.outstandingMinor)}`,
      ``,
      unpaid.some((l) => l.daysLate > 0)
        ? `Could you let me know when these will be paid? If any of them is in dispute, tell me which and I will look into it.`
        : `No action needed yet - this is for your records.`
    ]),
    ``,
    `Thanks,`,
    from.signatoryName || from.businessName
  ].join("\n");

  return {
    subject: `Statement of account - ${from.businessName}`,
    body,
    short: unpaid.length === 0
      ? `Your account with ${from.businessName} is fully settled as at ${date(statement.asOf)}. Thank you.`
      : `${unpaid.length} invoice${unpaid.length === 1 ? "" : "s"} outstanding with ${from.businessName}, ${money(statement.outstandingMinor)} in total. Sending the details now.`
  };
}

export interface StatementLinks { mail?: string; whatsapp?: string; text: StatementMessage }

export function statementLinks(
  statement: Statement,
  from: { businessName: string; signatoryName?: string; country?: string },
  contact: { email?: string; phone?: string },
  locale = "en-IN"
): StatementLinks {
  const text = statementMessage(statement, from, locale);
  return {
    mail: contact.email ? mailtoLink(contact.email, text.subject, text.body) : undefined,
    whatsapp: contact.phone ? whatsappLink(contact.phone, text.short) : undefined,
    text
  };
}

/** The statement as a spreadsheet, for a customer whose accounts person wants to reconcile it. */
export function statementCsv(statement: Statement): string {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const amount = (minor: number) => toMajor(fromMinor(minor, statement.currency)).toFixed(2);
  const rows: Array<Array<string | number>> = [["Date", "Due", "Number", "Charged", "Paid", "Outstanding", "Days overdue"]];
  for (const l of statement.lines) {
    rows.push([l.date, l.dueDate ?? "", l.number, amount(l.chargedMinor), amount(l.paidMinor), amount(l.outstandingMinor), l.daysLate || ""]);
  }
  rows.push(["", "", "Total", amount(statement.totalChargedMinor), amount(statement.totalPaidMinor), amount(statement.outstandingMinor), ""]);
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
