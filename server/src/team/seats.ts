import { monthlyCostFor, priceFor, type Plan } from "../billing/plans";

/**
 * Who is on a team, what each of them may do, and what the next person costs.
 *
 * Two rules sit behind all of it. A person can only lose access deliberately — an organisation
 * can never end up with nobody who can run it, so the last owner cannot be removed or demoted.
 * And a seat is never added quietly: adding somebody beyond the included seats changes the bill,
 * so the amount is said before the invitation goes out, not after it arrives.
 */

export type Role = "owner" | "admin" | "accountant" | "member" | "readonly";

export const ROLES: Array<{ id: Role; name: string; describes: string }> = [
  { id: "owner", name: "Owner", describes: "Everything, including the plan and who else is here." },
  { id: "admin", name: "Manager", describes: "Everything except the plan and the bill." },
  { id: "member", name: "Team member", describes: "Can make and change invoices, bills and customers." },
  { id: "accountant", name: "Accountant", describes: "Sees the books and can export them, but cannot change anything." },
  { id: "readonly", name: "View only", describes: "Can look, and nothing else." }
];

export interface Capabilities {
  /** May change records: invoices, expenses, customers. */
  write: boolean;
  /** May invite, remove and change what others can do. */
  manageTeam: boolean;
  /** May change the plan and see the bill. */
  billing: boolean;
  /** May take the books out: CSV, the returns, a backup. */
  exportBooks: boolean;
}

const CAPABILITIES: Record<Role, Capabilities> = {
  owner: { write: true, manageTeam: true, billing: true, exportBooks: true },
  admin: { write: true, manageTeam: true, billing: false, exportBooks: true },
  member: { write: true, manageTeam: false, billing: false, exportBooks: true },
  // The accountant seat is sold as one that sees the books but cannot change your invoices, so
  // that is exactly what it does.
  accountant: { write: false, manageTeam: false, billing: false, exportBooks: true },
  readonly: { write: false, manageTeam: false, billing: false, exportBooks: false }
};

export const isRole = (value: unknown): value is Role => ROLES.some((r) => r.id === value);

export const can = (role: string): Capabilities => CAPABILITIES[(isRole(role) ? role : "readonly")];

/* ------------------------------------------------------------------- seats */

export interface SeatCount {
  /** People who have accepted. */
  members: number;
  /** Invitations sent and not yet taken up. They hold a seat, or two people could take the last one. */
  pending: number;
  used: number;
  /** Seats in the base price. */
  included: number;
  /** Seats being paid for beyond the included ones. */
  extra: number;
}

export function seatCount(plan: Plan, members: number, pending: number): SeatCount {
  const used = members + pending;
  return { members, pending, used, included: plan.limits.users, extra: Math.max(0, used - plan.limits.users) };
}

export interface SeatDecision {
  allowed: boolean;
  seats: SeatCount;
  /** What the organisation would pay a month once this person is added. */
  monthlyCostMinor: number;
  currency: string;
  /** What this one person adds to the monthly bill, if anything. */
  addsMonthlyMinor: number;
  /** Said to the person doing the inviting, before the invitation goes out. */
  message: string;
}

/**
 * Whether one more person can be added, and what it would cost. A plan with no price for extra
 * people cannot grow by paying more, so it is refused with the plan that can.
 */
export function canAddSeat(plan: Plan, country: string, members: number, pending: number): SeatDecision {
  const seats = seatCount(plan, members, pending);
  const price = priceFor(plan, country);
  const next = seats.used + 1;
  const withinIncluded = next <= plan.limits.users;
  const perExtra = price.extraUserMonthlyMinor ?? 0;
  const canGrow = perExtra > 0;

  const monthlyCostMinor = monthlyCostFor(plan, country, Math.max(next, plan.limits.users));
  const addsMonthlyMinor = withinIncluded ? 0 : perExtra;

  if (withinIncluded) {
    const left = plan.limits.users - next;
    return {
      allowed: true, seats, monthlyCostMinor, currency: price.currency, addsMonthlyMinor,
      message: left > 0
        ? `Included in your plan. ${left} more seat${left === 1 ? "" : "s"} after this one.`
        : "Included in your plan. This is the last seat at this price."
    };
  }

  if (!canGrow) {
    return {
      allowed: false, seats, monthlyCostMinor: price.monthlyMinor, currency: price.currency, addsMonthlyMinor: 0,
      message: `Your plan is for ${plan.limits.users} ${plan.limits.users === 1 ? "person" : "people"}. Business includes two and lets you add more, each at a price you can see before you add them.`
    };
  }

  return {
    allowed: true, seats, monthlyCostMinor, currency: price.currency, addsMonthlyMinor,
    message: `Beyond the ${plan.limits.users} your plan includes, so this person adds to your monthly bill.`
  };
}

/* ------------------------------------------------------- changing a team */

export interface Member { userId: string; role: Role }

const owners = (members: Member[]) => members.filter((m) => m.role === "owner");

/** Why a change to somebody's access is not allowed, or nothing when it is. */
export function refuseRemoval(members: Member[], userId: string): string | null {
  const target = members.find((m) => m.userId === userId);
  if (!target) return "That person is not on this team.";
  if (target.role === "owner" && owners(members).length === 1) {
    return "This is the only owner. Make somebody else an owner first, so the business is never left without one.";
  }
  return null;
}

export function refuseRoleChange(members: Member[], userId: string, role: Role): string | null {
  const target = members.find((m) => m.userId === userId);
  if (!target) return "That person is not on this team.";
  if (target.role === role) return null;
  if (target.role === "owner" && role !== "owner" && owners(members).length === 1) {
    return "This is the only owner. Make somebody else an owner first, so the business is never left without one.";
  }
  return null;
}

/** An invitation is worth sending only if it could be taken up. */
export function refuseInvite(members: Array<{ email: string }>, pending: Array<{ email: string }>, email: string): string | null {
  const address = email.trim().toLowerCase();
  if (members.some((m) => m.email.toLowerCase() === address)) return "That person is already on this team.";
  if (pending.some((p) => p.email.toLowerCase() === address)) return "They have already been invited. You can send it again if it did not arrive.";
  return null;
}
