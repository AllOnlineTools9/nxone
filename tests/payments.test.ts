import { describe, expect, it } from "vitest";
import { applyArrived } from "@/lib/payments/arrived";
import type { SavedDocument } from "@/lib/store/types";

const money = (m: number) => `₹${(m / 100).toFixed(2)}`;

const doc = (over: Partial<SavedDocument> = {}): SavedDocument => ({
  id: "dc_1", kind: "invoice", number: "INV-0012", clientName: "Globex", issueDate: "2026-11-01",
  currency: "INR", totalMinor: 5900000, paidMinor: 0, status: "sent",
  createdAt: "", updatedAt: "", version: 1, doc: {} as SavedDocument["doc"], ...over
} as SavedDocument);

const arrived = (over = {}) => ({ documentId: "dc_1", amountMinor: 5900000, paidOn: "2026-11-14", method: "upi", ...over });

describe("money arriving on its own", () => {
  it("settles the invoice and says what happened", () => {
    const { apply } = applyArrived([arrived()], [doc()], money);
    expect(apply[0].status).toBe("paid");
    expect(apply[0].paidMinor).toBe(5900000);
    expect(apply[0].paidOn).toBe("2026-11-14");
    expect(apply[0].describes).toContain("paid in full");
    expect(apply[0].describes).toContain("by upi");
  });

  it("records a part payment as a part payment, and says what is left", () => {
    const { apply } = applyArrived([arrived({ amountMinor: 2000000 })], [doc()], money);
    expect(apply[0].status).toBe("partly-paid");
    expect(apply[0].describes).toContain("₹39,000.00".replace(/,/g, ""));
  });

  it("adds to what was already paid rather than replacing it", () => {
    const { apply } = applyArrived([arrived({ amountMinor: 3900000 })], [doc({ paidMinor: 2000000 })], money);
    expect(apply[0].paidMinor).toBe(5900000);
    expect(apply[0].status).toBe("paid");
  });

  it("will not record the same payment twice when the invoice is already settled", () => {
    const { apply, refuse } = applyArrived([arrived()], [doc({ paidMinor: 5900000, status: "paid" })], money);
    expect(apply).toHaveLength(0);
    expect(refuse[0].why).toContain("already shown as paid");
  });

  it("refuses anything that would take an invoice past what it was for", () => {
    const { apply, refuse } = applyArrived([arrived({ amountMinor: 1000000 })], [doc({ paidMinor: 5500000 })], money);
    expect(apply).toHaveLength(0);
    expect(refuse[0].why).toContain("past the");
  });

  it("flags money arriving against something cancelled instead of quietly reviving it", () => {
    const { apply, refuse } = applyArrived([arrived()], [doc({ status: "cancelled" })], money);
    expect(apply).toHaveLength(0);
    expect(refuse[0].why).toContain("cancelled");
  });

  it("says so when the invoice is not on this device, rather than inventing one", () => {
    const { refuse } = applyArrived([arrived({ documentId: "dc_other" })], [doc()], money);
    expect(refuse[0].why).toContain("not on this device");
  });

  it("handles several at once, keeping each one's verdict separate", () => {
    const out = applyArrived(
      [arrived(), arrived({ documentId: "dc_2", amountMinor: 1000000 })],
      [doc(), doc({ id: "dc_2", number: "INV-0013", totalMinor: 1000000 })],
      money
    );
    expect(out.apply.map((a) => a.number)).toEqual(["INV-0012", "INV-0013"]);
    expect(out.refuse).toHaveLength(0);
  });
});
