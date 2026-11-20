import { describe, expect, it } from "vitest";
import { cleanLine, profileSummary, requestEmail, requestState } from "../src/practice/requests";

const at = (days: number) => new Date(Date.now() + days * 86_400_000);

describe("an accountant's request for access", () => {
  it("is pending until answered or expired", () => {
    expect(requestState({ acceptedAt: null, declinedAt: null, expiresAt: at(3) })).toBe("pending");
    expect(requestState({ acceptedAt: null, declinedAt: null, expiresAt: at(-1) })).toBe("expired");
    expect(requestState({ acceptedAt: at(-1), declinedAt: null, expiresAt: at(-5) })).toBe("accepted");
    expect(requestState({ acceptedAt: null, declinedAt: at(-1), expiresAt: at(5) })).toBe("declined");
  });

  it("keeps what the accountant typed to one short line", () => {
    expect(cleanLine("Brightline\r\nBcc: x@y.z", 120)).toBe("Brightline Bcc: x@y.z");
    expect(cleanLine("a".repeat(400), 300)).toHaveLength(300);
    expect(cleanLine(42, 10)).toBe("");
  });

  it("tells the business exactly what saying yes gives", () => {
    const mail = requestEmail("https://nxone.io/grant-access/?token=t", { from: "ca@firm.in", businessName: "Brightline", days: 14 });
    expect(mail.subject).toBe("ca@firm.in would like to see the books of Brightline on NXOne");
    expect(mail.text).toContain("cannot change or send anything");
    expect(mail.text).toContain("expires in 14 days");
  });

  it("shows only harmless parts of a profile in the client list", () => {
    const p = profileSummary({ name: "Brightline", taxId: "29AAGCB7383J1Z4", paymentDetails: "A/c 1234", logoDataUrl: "data:...", registrations: ["gst", 3] });
    expect(p).toMatchObject({ name: "Brightline", taxId: "29AAGCB7383J1Z4", registrations: ["gst"] });
    expect(JSON.stringify(p)).not.toContain("1234");
    expect(JSON.stringify(p)).not.toContain("data:");
  });
});
