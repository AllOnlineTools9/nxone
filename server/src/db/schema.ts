import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The shape of the database.
 *
 * Two principles run through it. A person's data belongs to an organisation and every row carries
 * that organisation, so one tenant can never see another's. And the device remains the source of
 * truth for its own records: the server stores them with a version and a timestamp and resolves
 * conflicts, rather than owning the business logic. Tax rules and totals stay on the device.
 */

const id = () => text("id").primaryKey();
const created = () => integer("created_at", { mode: "timestamp_ms" }).notNull();

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: created(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  /** Set when someone asks for deletion, so the job can find them and logins stop working. */
  deletionRequestedAt: integer("deletion_requested_at", { mode: "timestamp_ms" })
}, (t) => ({ emailIdx: uniqueIndex("users_email_idx").on(t.email) }));

/** One organisation per customer. A person can belong to several. */
export const organisations = sqliteTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  country: text("country").notNull().default("IN"),
  currency: text("currency").notNull().default("INR"),
  plan: text("plan", { enum: ["free", "pro", "business"] }).notNull().default("free"),
  /** Everyone gets a fortnight of Pro when they first sign in, without a card. */
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp_ms" }),
  /** Where this organisation's rows are stored, for data residency later. */
  region: text("region").notNull().default("auto"),
  createdAt: created()
});

export const memberships = sqliteTable("memberships", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  orgId: text("org_id").notNull().references(() => organisations.id),
  role: text("role", { enum: ["owner", "admin", "accountant", "member", "readonly"] }).notNull().default("owner"),
  createdAt: created()
}, (t) => ({
  pair: uniqueIndex("memberships_user_org_idx").on(t.userId, t.orgId),
  byOrg: index("memberships_org_idx").on(t.orgId)
}));

/**
 * Everything the app saves lives here as a record with a kind. The server does not need to know
 * what an invoice is in order to store one, and keeping the shape on the client means changing the
 * document model does not need a migration.
 */
export const records = sqliteTable("records", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organisations.id),
  kind: text("kind", { enum: ["profile", "client", "item", "document", "expense", "recurring", "scenario", "employee", "payrun"] }).notNull(),
  /** The client's own id, which is what sync matches on. */
  localId: text("local_id").notNull(),
  body: text("body").notNull(),
  /** Bumped on every write, so a client can tell which copy is newer without trusting clocks. */
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  /** Tombstone. Deletes must sync too, or a deleted invoice returns from another device. */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  updatedBy: text("updated_by").references(() => users.id)
}, (t) => ({
  byOrgKind: index("records_org_kind_idx").on(t.orgId, t.kind),
  byUpdated: index("records_org_updated_idx").on(t.orgId, t.updatedAt),
  localUnique: uniqueIndex("records_org_local_idx").on(t.orgId, t.kind, t.localId)
}));

/** Financial actions are auditable, which the spec asks for and an accountant expects. */
export const auditLog = sqliteTable("audit_log", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organisations.id),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  recordKind: text("record_kind"),
  recordId: text("record_id"),
  summary: text("summary"),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent")
}, (t) => ({ byOrg: index("audit_org_at_idx").on(t.orgId, t.at) }));

/** Single-use login links. Hashed, short-lived, burned on use. */
export const loginTokens = sqliteTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: created(),
  requestIp: text("request_ip")
}, (t) => ({ byEmail: index("login_tokens_email_idx").on(t.email) }));

/** What each person wants to hear about, and when they last heard it. */
export const notificationPrefs = sqliteTable("notification_prefs", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  orgId: text("org_id").notNull().references(() => organisations.id),
  /** Off by default: an email nobody asked for is spam, however useful we think it is. */
  weeklyDigest: integer("weekly_digest", { mode: "boolean" }).notNull().default(false),
  overdueAlerts: integer("overdue_alerts", { mode: "boolean" }).notNull().default(false),
  lastSentAt: integer("last_sent_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
}, (t) => ({ pair: uniqueIndex("notify_user_org_idx").on(t.userId, t.orgId) }));

/** What a plan allows. Stored rather than coded, so pricing can change without a deploy. */
export const entitlements = sqliteTable("entitlements", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organisations.id),
  feature: text("feature").notNull(),
  /** Null means allowed without a limit. */
  limit: integer("limit"),
  used: integer("used").notNull().default(0),
  periodStart: integer("period_start", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
}, (t) => ({ byOrg: uniqueIndex("entitlements_org_feature_idx").on(t.orgId, t.feature) }));

/** Subscriptions as the provider reports them. Razorpay in India, Stripe elsewhere. */
export const subscriptions = sqliteTable("subscriptions", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organisations.id),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref").notNull(),
  plan: text("plan").notNull(),
  status: text("status", { enum: ["trialing", "active", "past_due", "cancelled"] }).notNull(),
  currency: text("currency").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
  createdAt: created(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
}, (t) => ({ byOrg: index("subscriptions_org_idx").on(t.orgId) }));

/**
 * An invitation to join an organisation. The token is hashed, like a login link, so the database
 * never holds anything that would let somebody walk in. One of these holds a seat from the moment
 * it is sent, because two people cannot be given the same last seat.
 */
export const invitations = sqliteTable("invitations", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organisations.id),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "admin", "accountant", "member", "readonly"] }).notNull().default("member"),
  tokenHash: text("token_hash").notNull(),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdAt: created()
}, (t) => ({
  byToken: uniqueIndex("invitations_token_idx").on(t.tokenHash),
  byOrg: index("invitations_org_idx").on(t.orgId),
  byEmail: index("invitations_email_idx").on(t.email)
}));

/**
 * A payment link we asked the provider for, and what came back when it was paid.
 *
 * The books live on the device, so this holds the least it can: which document the link was for,
 * what the provider called it, and whether money arrived. Not what was sold, not to whom.
 */
export const paymentLinks = sqliteTable("payment_links", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organisations.id),
  /** The document's id on the device, which is how the device finds it again. */
  documentId: text("document_id").notNull(),
  number: text("number").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  /** The provider's own id for the link, which its webhook quotes back. */
  reference: text("reference").notNull(),
  url: text("url").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  paidOn: text("paid_on"),
  paidAmountMinor: integer("paid_amount_minor"),
  method: text("method"),
  paymentReference: text("payment_reference"),
  /** Set once the device has been told, so a payment is not applied twice. */
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: created()
}, (t) => ({
  byReference: uniqueIndex("payment_links_reference_idx").on(t.reference),
  byOrg: index("payment_links_org_idx").on(t.orgId),
  byDocument: index("payment_links_document_idx").on(t.documentId)
}));
