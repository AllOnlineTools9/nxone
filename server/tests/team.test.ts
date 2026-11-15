import { describe, expect, it } from "vitest";
import { planById } from "../src/billing/plans";
import { can, canAddSeat, refuseInvite, refuseRemoval, refuseRoleChange, seatCount, type Member } from "../src/team/seats";

const free = planById("free");
const pro = planById("pro");
const business = planById("business");

describe("what each role may do", () => {
  it("lets an owner do everything", () => {
    expect(can("owner")).toEqual({ write: true, manageTeam: true, billing: true, exportBooks: true });
  });

  it("keeps the bill away from a manager", () => {
    expect(can("admin").manageTeam).toBe(true);
    expect(can("admin").billing).toBe(false);
  });

  it("gives the accountant the books but not the pen, which is what the plan sells", () => {
    expect(can("accountant").write).toBe(false);
    expect(can("accountant").exportBooks).toBe(true);
  });

  it("lets a view-only seat look and nothing else", () => {
    expect(can("readonly")).toEqual({ write: false, manageTeam: false, billing: false, exportBooks: false });
  });

  it("treats anything it does not recognise as the least access, not the most", () => {
    expect(can("wizard").write).toBe(false);
    expect(can("").manageTeam).toBe(false);
  });
});

describe("counting seats", () => {
  it("counts an invitation nobody has taken up yet, so two people cannot take one seat", () => {
    const seats = seatCount(business, 2, 1);
    expect(seats.used).toBe(3);
    expect(seats.included).toBe(2);
    expect(seats.extra).toBe(1);
  });

  it("has no extra seats while the team fits the plan", () => {
    expect(seatCount(business, 1, 0).extra).toBe(0);
  });
});

describe("adding somebody", () => {
  it("says a seat is included and how many are left", () => {
    const d = canAddSeat(business, "IN", 0, 0);
    expect(d.allowed).toBe(true);
    expect(d.addsMonthlyMinor).toBe(0);
    expect(d.message).toContain("1 more seat after this one");
  });

  it("warns that the last included seat is the last one", () => {
    expect(canAddSeat(business, "IN", 1, 0).message).toContain("last seat at this price");
  });

  it("says what the next person costs before the invitation goes out", () => {
    const d = canAddSeat(business, "IN", 2, 0);
    expect(d.allowed).toBe(true);
    expect(d.addsMonthlyMinor).toBe(39900);
    expect(d.monthlyCostMinor).toBe(99900 + 39900);
    expect(d.currency).toBe("INR");
  });

  it("prices the extra person in dollars outside India", () => {
    const d = canAddSeat(business, "US", 2, 0);
    expect(d.addsMonthlyMinor).toBe(900);
    expect(d.monthlyCostMinor).toBe(1999 + 900);
    expect(d.currency).toBe("USD");
  });

  it("counts pending invitations towards the bill", () => {
    expect(canAddSeat(business, "IN", 2, 1).monthlyCostMinor).toBe(99900 + 2 * 39900);
  });

  it("refuses on a plan that cannot grow, and names the one that can", () => {
    for (const plan of [free, pro]) {
      const d = canAddSeat(plan, "IN", 1, 0);
      expect(d.allowed).toBe(false);
      expect(d.message).toContain("Business");
    }
  });
});

describe("never leaving a business without an owner", () => {
  const team: Member[] = [{ userId: "u1", role: "owner" }, { userId: "u2", role: "member" }];

  it("refuses to remove the only owner", () => {
    expect(refuseRemoval(team, "u1")).toContain("only owner");
  });

  it("refuses to demote the only owner", () => {
    expect(refuseRoleChange(team, "u1", "member")).toContain("only owner");
  });

  it("allows both once there are two owners", () => {
    const two: Member[] = [...team, { userId: "u3", role: "owner" }];
    expect(refuseRemoval(two, "u1")).toBeNull();
    expect(refuseRoleChange(two, "u1", "member")).toBeNull();
  });

  it("allows anybody else to be removed or changed", () => {
    expect(refuseRemoval(team, "u2")).toBeNull();
    expect(refuseRoleChange(team, "u2", "accountant")).toBeNull();
  });

  it("says plainly when the person is not on the team", () => {
    expect(refuseRemoval(team, "nobody")).toContain("not on this team");
    expect(refuseRoleChange(team, "nobody", "member")).toContain("not on this team");
  });

  it("does not object to setting somebody to the role they already have", () => {
    expect(refuseRoleChange(team, "u1", "owner")).toBeNull();
  });
});

describe("inviting somebody twice", () => {
  const members = [{ email: "anita@example.com" }];
  const pending = [{ email: "raj@example.com" }];

  it("says when they are already here", () => {
    expect(refuseInvite(members, pending, "ANITA@example.com")).toContain("already on this team");
  });

  it("says when they have already been asked", () => {
    expect(refuseInvite(members, pending, "raj@example.com")).toContain("already been invited");
  });

  it("allows a new address", () => {
    expect(refuseInvite(members, pending, "new@example.com")).toBeNull();
  });
});
