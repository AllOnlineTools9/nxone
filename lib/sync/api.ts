import type { RecordKind, WireRecord } from "./records";

/**
 * Talking to the API. The session lives in an httpOnly cookie, so requests carry credentials and
 * the browser handles the rest. Every call returns a plain result rather than throwing, because a
 * sync failure must never break the page someone is working on.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");
export const syncAvailable = () => API_URL.length > 0;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  if (!syncAvailable()) return { ok: false, status: 0, error: "Syncing is not switched on in this build." };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: (body as { error?: string }).error ?? `Request failed (${res.status}).` };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Your work is saved on this device." };
  }
}

export interface PlanLimits { users: number; devices: number | null; records: number | null; sync: boolean }

export interface Account {
  user: { email: string };
  orgId?: string;
  organisations: Array<{ id: string; name: string; plan: string; role: string }>;
  plan?: { id: string; name: string; trialing: boolean; trialEndsAt: number | null; limits: PlanLimits } | null;
}

export interface PlanOffer {
  id: string;
  name: string;
  summary: string;
  features: string[];
  limits: PlanLimits;
  price: { currency: string; monthlyMinor: number; yearlyMinor: number; extraUserMonthlyMinor?: number };
}

export const requestLink = (email: string) => call<{ ok: boolean; sent: boolean }>("/auth/request", { method: "POST", body: JSON.stringify({ email }) });
export const verifyLink = (token: string) => call<{ ok: boolean; user: { email: string }; orgId: string }>("/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
export const whoAmI = () => call<Account>("/auth/me");
export const signOut = () => call<{ ok: boolean }>("/auth/sign-out", { method: "POST" });

export const plans = (country?: string) => call<{ country: string; provider: string; checkoutConnected: boolean; plans: PlanOffer[] }>(`/billing/plans${country ? `?country=${country}` : ""}`);

export const checkout = (plan: string, period: "monthly" | "yearly") =>
  call<{ url: string | null; reference: string; note?: string; provider: string; connected: boolean }>("/billing/checkout", { method: "POST", body: JSON.stringify({ plan, period }) });

export interface NotificationPrefs { weeklyDigest: boolean; overdueAlerts: boolean; lastSentAt?: number | null }

export const notificationPrefs = () => call<NotificationPrefs>("/notifications/preferences");
export const saveNotificationPrefs = (prefs: NotificationPrefs) =>
  call<NotificationPrefs>("/notifications/preferences", { method: "POST", body: JSON.stringify(prefs) });
export const previewDigest = () => call<{ worthSending: boolean; subject: string; lines: string[] }>("/notifications/preview");

export const pull = (since: number) => call<{ records: WireRecord[]; cursor: number; more: boolean }>(`/sync/pull?since=${since}`);

export const push = (records: WireRecord[]) =>
  call<{
    applied: Array<{ kind: RecordKind; localId: string; version: number }>;
    rejected: Array<{ record: WireRecord; reason: string; current: WireRecord }>;
    cursor: number;
  }>("/sync/push", { method: "POST", body: JSON.stringify({ records }) });

/* ------------------------------------------------------------------- team */

export type TeamRole = "owner" | "admin" | "accountant" | "member" | "readonly";

export interface Capabilities { write: boolean; manageTeam: boolean; billing: boolean; exportBooks: boolean }

export interface TeamMember {
  userId: string;
  email: string;
  name: string | null;
  role: TeamRole;
  joinedAt: number;
  lastSeenAt: number | null;
  isYou: boolean;
}

export interface PendingInvite { id: string; email: string; role: TeamRole; invitedAt: number; expiresAt: number }

export interface SeatDecision {
  allowed: boolean;
  seats: { members: number; pending: number; used: number; included: number; extra: number };
  monthlyCostMinor: number;
  currency: string;
  addsMonthlyMinor: number;
  message: string;
}

export interface TeamView {
  organisation: { id: string; name: string; country: string };
  plan: { id: string; name: string; trialing: boolean };
  you: { userId: string; role: TeamRole; can: Capabilities };
  roles: Array<{ id: TeamRole; name: string; describes: string }>;
  members: TeamMember[];
  pending: PendingInvite[];
  counts: { members: number; pending: number; used: number; included: number; extra: number };
  seats: SeatDecision;
}

export const team = () => call<TeamView>("/team");

export const invitePerson = (email: string, role: TeamRole) =>
  call<{ ok: boolean; sent: boolean; team: TeamView }>("/team/invite", { method: "POST", body: JSON.stringify({ email, role }) });

export const revokeInvite = (id: string) =>
  call<{ ok: boolean; team: TeamView }>("/team/invite/revoke", { method: "POST", body: JSON.stringify({ id }) });

export const acceptInvite = (token: string) =>
  call<{ ok: boolean; user: { email: string }; orgId: string; organisation: { name: string }; role: TeamRole; can: Capabilities }>(
    "/team/accept", { method: "POST", body: JSON.stringify({ token }) });

export const setMemberRole = (userId: string, role: TeamRole) =>
  call<{ ok: boolean; team: TeamView }>("/team/role", { method: "POST", body: JSON.stringify({ userId, role }) });

export const removeMember = (userId: string) =>
  call<{ ok: boolean; note: string; team: TeamView }>("/team/remove", { method: "POST", body: JSON.stringify({ userId }) });

/* ------------------------------------------------------- paying an invoice */

export interface PaymentLinkResult {
  url: string | null;
  reference?: string;
  expiresAt?: string;
  reused?: boolean;
  connected?: boolean;
  note?: string;
}

export interface ArrivedPayment {
  documentId: string;
  amountMinor: number;
  paidOn: string;
  method?: string;
  reference?: string;
}

/** Ask for a link the customer can pay through. The provider's secret never reaches the device. */
export const paymentLink = (input: {
  documentId: string; number: string; amountMinor: number; currency: string;
  description?: string; customer?: { name?: string; email?: string; phone?: string };
  dueDate?: string; returnTo?: string;
}) => call<PaymentLinkResult>("/payments/link", { method: "POST", body: JSON.stringify(input) });

/** Payments that have arrived and that this device has not applied yet. */
export const paymentsArrived = () => call<{ payments: ArrivedPayment[] }>("/payments/arrived");

/** Tell the server they have been applied, so the same payment is never recorded twice. */
export const paymentsApplied = (documentIds: string[]) =>
  call<{ ok: boolean; marked: number }>("/payments/applied", { method: "POST", body: JSON.stringify({ documentIds }) });

/* ------------------------------------------------- sharing a document */

/** Share a document with its customer by link, or refresh what an existing link shows. */
export const shareDocument = (input: { documentId: string; number: string; snapshot: unknown; expiresInDays?: number }) =>
  call<{ token: string; reused?: boolean }>("/portal/share", { method: "POST", body: JSON.stringify(input) });

/** Withdraw the link, so it stops working. */
export const revokeShare = (documentId: string) =>
  call<{ ok: boolean }>("/portal/revoke", { method: "POST", body: JSON.stringify({ documentId }) });

export interface SharedSummary {
  documentId: string;
  number: string;
  token: string;
  viewCount: number;
  lastViewedAt?: string;
  revoked: boolean;
  expiresAt?: string;
}

/** Which documents are shared, and whether the customer has looked. */
export const sharedDocuments = () => call<{ shared: SharedSummary[] }>("/portal/shared");
