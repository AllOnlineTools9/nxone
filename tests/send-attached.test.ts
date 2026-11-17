import { describe, expect, it } from "vitest";
import { sendMessage } from "@/lib/documents/send";
import { calculate } from "@/lib/documents/totals";
import { blankDocument } from "@/components/builder/state";
import { blobToBase64 } from "@/lib/files/base64";

const doc = () => {
  const d = blankDocument("invoice", "IN");
  d.number = "INV-7"; d.seller.name = "Brightline"; d.buyer.name = "Globex Ltd";
  d.items = [{ ...d.items[0], description: "Design", quantity: 1, rate: 1000 }];
  return d;
};

describe("the message when the PDF goes with it", () => {
  it("says the PDF is attached, and still gives the link", () => {
    const d = doc();
    const m = sendMessage(d, calculate(d), "en-IN", "https://nxone.io/view/abc/", { attached: true });
    expect(m.body).toContain("The PDF is attached.");
    expect(m.body).toContain("https://nxone.io/view/abc/");
    expect(m.short).toContain("PDF attached.");
    expect(m.short).not.toContain("Sending the PDF now");
  });

  it("does not promise a link it does not have", () => {
    const d = doc();
    const m = sendMessage(d, calculate(d), "en-IN", undefined, { attached: true });
    expect(m.body).not.toContain("view and download");
    expect(m.short.endsWith("PDF attached.")).toBe(true);
  });

  it("is unchanged when only a link goes", () => {
    const d = doc();
    const m = sendMessage(d, calculate(d), "en-IN", "https://nxone.io/view/abc/");
    expect(m.body).toContain("You can view and download it here:");
    expect(m.body).not.toContain("attached");
  });
});

describe("a PDF as base64", () => {
  it("round-trips, including files larger than one chunk", async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    const b64 = await blobToBase64(new Blob([bytes]));
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(back).toEqual(bytes);
  });
});
