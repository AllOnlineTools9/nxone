import { owedOn } from "../documents/owed";
import type { Client, SavedDocument } from "../store/types";
import type { DocumentData, DocumentKind } from "../documents/types";

/**
 * The people you bill, remembered without being asked.
 *
 * Saving a customer used to be a link under the customer box, offered once and easy to miss, so
 * most were never saved even though their details sat on the invoice you had just made. Now the
 * act of saving or downloading a document is enough.
 */

/** A purchase order's counterparty is a supplier, not a customer, so it is never remembered. */
const NOT_CUSTOMERS = new Set<DocumentKind>(["purchase-order"]);

export const remembersCustomer = (kind: DocumentKind): boolean => !NOT_CUSTOMERS.has(kind);

const sameName = (a?: string, b?: string) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

const sameTaxId = (a?: string, b?: string) =>
  Boolean(a && b && a.replace(/\s/g, "").toUpperCase() === b.replace(/\s/g, "").toUpperCase());

/**
 * The saved customer a document is for. GSTIN first, because two businesses can share a name
 * but not a GSTIN; then the name, which is all most small customers have.
 */
export function matchCustomer(clients: Client[], buyer: { name?: string; taxId?: string }): Client | undefined {
  const live = clients.filter((c) => !c.deletedAt);
  return (buyer.taxId ? live.find((c) => sameTaxId(c.taxId, buyer.taxId)) : undefined)
    ?? live.find((c) => sameName(c.name, buyer.name));
}

export type RememberAction =
  | { action: "create"; fields: Omit<Client, "id" | "createdAt" | "updatedAt"> }
  | { action: "update"; id: string; fields: Partial<Client>; changed: string[] }
  | { action: "none"; id?: string };

const FIELDS = ["name", "address", "email", "phone", "taxId", "region"] as const;

/**
 * What saving this document should do to the customer list.
 *
 * Fills in and corrects, but never blanks: an invoice where somebody left the address empty is
 * not a request to forget the address. Payment terms and notes are left alone entirely, because
 * those are set on the customer, not inferred from one document.
 */
export function rememberFrom(
  clients: Client[],
  doc: Pick<DocumentData, "kind" | "buyer" | "placeOfSupply">
): RememberAction {
  if (!remembersCustomer(doc.kind)) return { action: "none" };
  // A document with no buyer at all (an old import, a half-built draft) has nobody to remember.
  const buyer = doc.buyer ?? ({} as DocumentData["buyer"]);
  const name = buyer.name?.trim();
  if (!name) return { action: "none" };

  const incoming = {
    name,
    address: buyer.address?.trim() || undefined,
    email: buyer.email?.trim() || undefined,
    phone: buyer.phone?.trim() || undefined,
    taxId: buyer.taxId?.trim().toUpperCase() || undefined,
    region: doc.placeOfSupply || buyer.region || undefined
  };

  const existing = matchCustomer(clients, incoming);
  if (!existing) {
    return { action: "create", fields: { ...incoming, version: 1 } as Omit<Client, "id" | "createdAt" | "updatedAt"> };
  }

  const fields: Partial<Client> = {};
  const changed: string[] = [];
  for (const field of FIELDS) {
    const value = incoming[field];
    if (value && value !== existing[field]) {
      (fields as Record<string, string>)[field] = value;
      changed.push(field);
    }
  }

  return changed.length === 0
    ? { action: "none", id: existing.id }
    : { action: "update", id: existing.id, fields, changed };
}

/* ---------------------------------------------------------------- their history */

/**
 * A customer's documents. Linked by id from now on, so renaming a customer keeps their history;
 * documents from before the link existed are matched the old way, by GSTIN or name.
 */
export function documentsFor(client: Client, documents: SavedDocument[]): SavedDocument[] {
  return documents
    .filter((d) => !d.deletedAt && remembersCustomer(d.kind))
    .filter((d) =>
      d.clientId ? d.clientId === client.id
        : sameTaxId(client.taxId, d.doc?.buyer?.taxId) || sameName(client.name, d.clientName))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
}

export interface CustomerSummary {
  client: Client;
  documents: SavedDocument[];
  /** Invoiced and not yet paid. A credit note counts against it. */
  owedMinor: number;
  /** Everything invoiced to them, ever, net of credit notes. */
  billedMinor: number;
  lastOn?: string;
  /** Unpaid invoices past their due date. */
  overdue: number;
}

const CHARGES = new Set<DocumentKind>(["invoice", "credit-note"]);

export function summarise(client: Client, documents: SavedDocument[], today: string): CustomerSummary {
  const theirs = documentsFor(client, documents);
  const charges = theirs.filter((d) => CHARGES.has(d.kind) && d.status !== "cancelled" && d.status !== "draft");
  const sign = (d: SavedDocument) => (d.kind === "credit-note" ? -1 : 1);

  return {
    client,
    documents: theirs,
    owedMinor: charges.reduce((sum, d) => sum + owedOn(d) * sign(d), 0),
    billedMinor: charges.reduce((sum, d) => sum + d.totalMinor * sign(d), 0),
    lastOn: theirs[0]?.issueDate,
    overdue: charges.filter((d) => d.kind === "invoice" && d.totalMinor > d.paidMinor && d.dueDate && d.dueDate < today).length
  };
}

/**
 * People who appear on past documents but were never saved, because saving used to be opt-in.
 * Offered as a one-off import so the list starts complete rather than filling up slowly.
 */
export function unsavedFromDocuments(clients: Client[], documents: SavedDocument[]): Array<{ name: string; doc: SavedDocument }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; doc: SavedDocument }> = [];
  // Newest first, so the details taken are the most recent ones used.
  for (const d of [...documents].sort((a, b) => b.issueDate.localeCompare(a.issueDate))) {
    if (d.deletedAt || !remembersCustomer(d.kind) || !d.clientName?.trim()) continue;
    const key = d.doc?.buyer?.taxId?.toUpperCase() || d.clientName.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!matchCustomer(clients, { name: d.clientName, taxId: d.doc?.buyer?.taxId })) out.push({ name: d.clientName, doc: d });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* --------------------------------------------------------------- payment terms */

/** Kinds where the second date is when payment is due, as opposed to how long a quote stands. */
const PAYABLE = new Set<DocumentKind>(["invoice", "proforma"]);

export const takesPaymentTerms = (kind: DocumentKind): boolean => PAYABLE.has(kind);

/** The due date for a customer's terms, counted from the issue date. */
export function dueDateFor(issueDate: string, termsDays: number): string {
  const d = new Date(`${issueDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(termsDays)));
  return d.toISOString().slice(0, 10);
}

/** Common terms, offered as a choice rather than a blank number. */
export const TERMS_CHOICES = [0, 7, 15, 30, 45, 60, 90];

export const describeTerms = (days?: number): string =>
  days === undefined ? "Not set" : days === 0 ? "Due on receipt" : `${days} days`;
