import { describe, expect, it } from "vitest";
import { leaks, newToken, refusalFor, sameToken, snapshotOf, stateOf, type ShareRecord } from "../src/portal/share";

const record = (over: Partial<ShareRecord> = {}): ShareRecord => ({
  token: "a".repeat(20), orgId: "org1", documentId: "d1", number: "INV-1",
  snapshot: "{}", createdAt: new Date("2026-11-01"), viewCount: 0, ...over
});

describe("the token", () => {
  it("is long enough that guessing is not a route in", () => {
    expect(newToken()).toHaveLength(20);
  });

  it("is different every time", () => {
    const made = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(made.size).toBe(200);
  });

  it("leaves out the characters people misread aloud", () => {
    const all = Array.from({ length: 100 }, () => newToken()).join("");
    for (const confusing of ["l", "1", "0", "o", "i"]) expect(all).not.toContain(confusing);
  });

  it("is compared without failing fast on the first wrong character", () => {
    expect(sameToken("abc", "abc")).toBe(true);
    expect(sameToken("abc", "abd")).toBe(false);
    expect(sameToken("abc", "ab")).toBe(false);
  });
});

describe("whether a link still works", () => {
  it("works while it is live", () => {
    expect(stateOf(record())).toBe("live");
  });

  it("stops once it is withdrawn", () => {
    expect(stateOf(record({ revokedAt: new Date("2026-11-10") }))).toBe("revoked");
  });

  it("stops once it has expired", () => {
    expect(stateOf(record({ expiresAt: new Date("2026-11-10") }), new Date("2026-11-16"))).toBe("expired");
    expect(stateOf(record({ expiresAt: new Date("2026-12-10") }), new Date("2026-11-16"))).toBe("live");
  });

  it("says nothing is there when there is nothing", () => {
    expect(stateOf(undefined)).toBe("missing");
  });

  it("tells a customer what to do, without saying why it stopped working", () => {
    expect(refusalFor("revoked").says).toContain("Ask whoever sent it");
    expect(refusalFor("revoked").status).toBe(410);
    expect(refusalFor("missing").status).toBe(404);
    expect(refusalFor("missing").says).not.toContain("withdrawn");
  });
});

describe("what a customer is shown", () => {
  const full = {
    number: "INV-0012", kind: "invoice", issueDate: "2026-11-01", dueDate: "2026-11-15",
    currency: "INR", totalMinor: 5900000, paidMinor: 0,
    seller: { name: "Brightline", address: "Bengaluru", email: "hi@b.example", taxId: "29AAG" },
    buyer: { name: "Globex", address: "Mumbai", taxId: "27AAF" },
    lines: [{ description: "Work", quantity: 1, rate: 50000, amountMinor: 5000000 }],
    taxLines: [{ label: "GST 18%", amountMinor: 900000 }],
    notes: "Thanks", terms: "14 days",
    payment: { upiId: "b@okaxis" }
  };

  it("carries what the document says", () => {
    const out = snapshotOf(full);
    expect(out.number).toBe("INV-0012");
    expect(out.lines).toHaveLength(1);
    expect(out.taxLines[0].label).toBe("GST 18%");
    expect(out.payment?.upiId).toBe("b@okaxis");
  });

  it("is built field by field, so nothing extra rides along", () => {
    const withSecrets = { ...full, projectId: "pj1", costMinor: 99, internalNotes: "undercharged" };
    const out = snapshotOf(withSecrets as never) as unknown as Record<string, unknown>;
    expect(out.projectId).toBeUndefined();
    expect(out.costMinor).toBeUndefined();
    expect(out.internalNotes).toBeUndefined();
  });

  it("names any private field that found its way in, rather than letting it through", () => {
    expect(leaks({ number: "INV-1", projectId: "pj1" })).toEqual(["projectId"]);
    expect(leaks({ number: "INV-1", costMinor: 1, supplier: "x" })).toEqual(["costMinor", "supplier"]);
    expect(leaks(snapshotOf(full))).toEqual([]);
  });

  it("copes with something that is not an object at all", () => {
    expect(leaks("nonsense")).toEqual([]);
    expect(leaks(null)).toEqual([]);
  });

  it("leaves out a payment block entirely when there is nothing to pay with", () => {
    expect(snapshotOf({ ...full, payment: undefined }).payment).toBeUndefined();
  });
});
