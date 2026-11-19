import type { Baseline, Change } from "../analysis/scenario";
import type { Attachment } from "../files/vault";
import type { Employee as PayrollEmployee } from "../payroll/run";
import type { Registration } from "../compliance/rules";
import type { RecurringTemplate } from "../recurring/schedule";
import type { DocumentData, DocumentKind } from "../documents/types";

/** Your own business, filled into every document so you type it once. */
export interface Profile extends Syncable {
  name: string;
  address?: string;
  email?: string;
  phone?: string;
  website?: string;
  taxId?: string;
  region?: string;
  country: string;
  currency: string;
  logoDataUrl?: string;
  signatureDataUrl?: string;
  signatoryName?: string;
  paymentDetails?: string;
  /** What was in the bank when you started using NXOne, so cash is right from day one. */
  openingCashMinor?: number;
  openingCashDate?: string;
  /**
   * The books are closed on and before this date: nothing dated inside it can be changed.
   * Set when a return is filed, so what was filed and what the books say cannot drift apart.
   */
  lockedUpTo?: string;
  /** Advance tax instalments already paid, so the year's dates can be checked against them. */
  advanceTaxPaid?: Array<{ date: string; amountMinor: number }>;
  /**
   * Which GST scheme the business is on. Almost everything in the GST screens assumes regular
   * registration, so a business on composition has to be known about rather than guessed at.
   */
  gstScheme?: "regular" | "composition" | "unregistered";
  /** What the business meant to spend this year, per account. */
  budgets?: Array<{ code: string; yearMinor: number; monthly?: Record<string, number> }>;
  /** Expense claims owed to the people who work here. */
  claims?: Claim[];
  /** Which composition rate applies, when on that scheme. */
  compositionRate?: string;
  /** What the business is registered for, which decides the filing calendar. */
  registrations?: Registration[];
  /** Indian businesses on the QRMP scheme file GST quarterly rather than monthly. */
  quarterlyGst?: boolean;
  /** Your UPI id, used to put a scannable QR on Indian invoices. */
  upiId?: string;
  /** A hosted payment page, for cards and overseas customers. */
  paymentLink?: string;
  defaultTerms?: string;
  /** Next number for each kind, so a new invoice carries on from the last one. */
  nextNumbers?: Partial<Record<DocumentKind, string>>;
  accentColor?: string;
  template?: DocumentData["template"];
  updatedAt?: string;
}

/**
 * What every record that syncs carries. Version only ever increases, and a delete is a tombstone
 * rather than a removal, because a deletion has to reach your other devices too.
 */
export interface Syncable {
  version?: number;
  deletedAt?: string;
  /** When the server last accepted this exact copy. */
  syncedAt?: string;
}

export interface Client extends Syncable {
  id: string;
  name: string;
  address?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  region?: string;
  /** Country code, for clients you bill abroad. */
  country?: string;
  notes?: string;
  /** Default payment terms in days for this client. */
  termsDays?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogueItem extends Syncable {
  id: string;
  description: string;
  unit?: string;
  rate: number;
  /** HSN or SAC code, so the tax rate follows automatically. */
  code?: string;
  taxRuleId?: string;
  /** Kept on the shelf and counted: see lib/stock. Services are never tracked. */
  tracked?: boolean;
  openingQty?: number;
  openingCostMinor?: number;
  reorderLevel?: number;
  createdAt: string;
  updatedAt: string;
}

export type DocumentStatus = "draft" | "sent" | "partly-paid" | "paid" | "cancelled";

/** A document you saved, with just enough summary to list and total without recalculating. */
export interface SavedDocument extends Syncable {
  id: string;
  kind: DocumentKind;
  number: string;
  clientName: string;
  clientId?: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  /** Minor units, as everywhere else. */
  totalMinor: number;
  paidMinor: number;
  /**
   * The day the money arrived, which is not the day somebody got round to ticking it off.
   * Without this the ledger has to guess from updatedAt, and an edit months later would move
   * the cash into another month. Older records have none, and the guess is kept for those.
   */
  paidOn?: string;
  /**
   * The rate when the money actually arrived, where it differs from the rate on the document.
   * The gap between the two is a real gain or loss, and the ledger records it as one.
   */
  paymentFxRate?: number;
  status: DocumentStatus;
  /** Paperwork kept with the document. The files themselves stay on the device they were added on. */
  attachments?: Attachment[];
  /**
   * What the registration portal gave back, once somebody has registered this invoice there.
   * Kept because the number belongs on the document and on the return, and because an invoice
   * that has one must not be registered twice.
   */
  einvoice?: { irn: string; ackNumber?: string; ackDate?: string; signedQr?: string; registeredAt: string };
  /** How the goods travel, and the e-way bill number once the portal has given one. */
  ewaybill?: import("../ewaybill/ewaybill").EwayRecord;
  /**
    * The document this one was made from, and the one made from it: a quotation and the invoice
    * it became. Named for documents rather than currencies, which convert too.
    */
  /** The job this document belongs to, when the business works in jobs. */
  projectId?: string;
  madeFrom?: { id: string; number: string };
  madeInto?: { id: string; kind: DocumentKind; number: string };
  doc: DocumentData;
  createdAt: string;
  updatedAt: string;
}

/** Something you bought. Posts to the ledger the moment it is saved. */
export interface Expense extends Syncable {
  id: string;
  date: string;
  supplier: string;
  description?: string;
  /** Expense account code from the chart of accounts. */
  category: string;
  currency: string;
  /** What one unit of this bill's currency was worth in the books' currency on the day. */
  fxRate?: number;
  netMinor: number;
  taxMinor: number;
  /** The cash account it was paid from, or empty when it is still owed. */
  paidFrom?: string;
  /** Bill or receipt number, for matching later. */
  reference?: string;
  /** The purchase order this bill is against, so the two can be compared. */
  orderId?: string;
  /** The job this cost belongs to, when the business works in jobs. */
  projectId?: string;
  /**
   * The reverse charge category, when the tax on this bill is owed by you rather than charged
   * by the supplier. The bill itself carries no GST in that case.
   */
  rcmCategory?: string;
  /** The rate that would have applied had the supplier charged it. */
  rcmRate?: number;
  /**
   * The supplier's GSTIN. Without it a purchase cannot be matched against GSTR-2B, which is
   * what decides whether the tax on it can actually be claimed.
   */
  supplierGstin?: string;
  /** The supplier's PAN. Without it, tax is deducted at a fifth rather than the usual rate. */
  supplierPan?: string;
  /** Individuals and HUFs attract a lower rate under some sections. */
  supplierType?: "individual" | "other";
  /** Which section of the income tax act this payment falls under, when tax has to be held back. */
  tdsSection?: string;
  /** What was actually held back from the supplier and is owed to the government. */
  tdsMinor?: number;
  /** The photographed bill, kept with the expense so the paperwork is where the money is. */
  receiptDataUrl?: string;
  receiptFileName?: string;
  /** Anything else kept with it: the supplier's PDF, a contract, a delivery note. */
  attachments?: Attachment[];
  /** How many arrived, when this bill is a purchase of stock rather than a cost of the month. */
  stockQuantity?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A question you asked of your own figures and kept: "what if I hire someone". The changes are
 * saved rather than the answer, so reopening it runs against the books as they are now.
 */
export interface SavedScenario extends Syncable {
  id: string;
  name: string;
  changes: Change[];
  horizonMonths?: number;
  /** Only present when you corrected the figures the books suggested. */
  baseline?: Baseline;
  createdAt: string;
  updatedAt: string;
}

/** Somebody on the payroll. The arithmetic lives in lib/payroll; this is the record of them. */
export interface SavedEmployee extends Syncable, PayrollEmployee {
  createdAt: string;
  updatedAt: string;
}

/** A month that has been run, kept so a payslip can be reprinted exactly as it was paid. */
export interface SavedPayRun extends Syncable {
  id: string;
  /** YYYY-MM. */
  month: string;
  /** The run as it was computed, frozen. Rules change; a payslip already paid must not. */
  snapshot: unknown;
  postedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type { RecurringTemplate };

/**
 * Something the business owns and uses for years rather than consumes: a laptop, a van, the
 * fit-out of a shop. Kept apart from expenses because its cost belongs to several years, not to
 * the month the money left.
 */
export interface SavedAsset {
  id: string;
  name: string;
  classId: string;
  purchasedOn: string;
  costMinor: number;
  currency: string;
  salvageMinor?: number;
  method?: "straight-line" | "written-down";
  usefulLifeYears?: number;
  disposedOn?: string;
  disposalMinor?: number;
  /** The bill it was bought on, when it started life as an expense. */
  expenseId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt?: string;
  /** Set once this has reached the server, which decides whether a deletion needs a tombstone. */
  syncedAt?: string;
}

/** A job: a piece of work with its own income and costs. */
export interface SavedProject {
  id: string;
  name: string;
  client?: string;
  startedOn?: string;
  quotedMinor?: number;
  status: "open" | "done" | "abandoned";
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt?: string;
  syncedAt?: string;
}

import type { AuditEntry } from "./audit";
import type { Claim } from "../payroll/claims";

export interface Workspace {
  version: 1;
  /** How far this device has caught up with the server, in milliseconds. */
  syncCursor?: number;
  /** Who is signed in, so the app can say whose data it is syncing. */
  account?: { email: string; orgId?: string };
  profile?: Profile;
  clients: Client[];
  items: CatalogueItem[];
  documents: SavedDocument[];
  expenses: Expense[];
  recurring: RecurringTemplate[];
  scenarios: SavedScenario[];
  employees: SavedEmployee[];
  assets?: SavedAsset[];
  projects?: SavedProject[];
  /** What changed and when, so a figure queried months later can be traced. */
  audit?: AuditEntry[];
  payruns: SavedPayRun[];
}

export const emptyWorkspace = (): Workspace => ({ version: 1, clients: [], items: [], documents: [], expenses: [], recurring: [], scenarios: [], employees: [], payruns: [], assets: [], projects: [] });
