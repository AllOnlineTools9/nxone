import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, base64Bytes, checkPdf, looksLikePdf, safeFileName } from "../src/portal/outgoing";

const pdf = btoa("%PDF-1.4\nhello\n%%EOF");

describe("the PDF kept behind a shared link", () => {
  it("is accepted when it is a PDF", () => {
    expect(checkPdf(pdf).ok).toBe(true);
  });

  it("is refused when it is anything else", () => {
    expect(checkPdf(btoa("MZ executable")).ok).toBe(false);
    expect(checkPdf("%%%not base64").ok).toBe(false);
    expect(checkPdf(undefined).ok).toBe(false);
  });

  it("is refused when it is larger than an invoice could be", () => {
    const out = checkPdf("A".repeat(Math.ceil((MAX_PDF_BYTES + 10) * 4 / 3)));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.says).toContain("too large");
  });
});

describe("the pieces", () => {
  it("counts base64 bytes without decoding", () => {
    expect(base64Bytes(btoa("abcd"))).toBe(4);
    expect(base64Bytes(btoa("abcde"))).toBe(5);
  });

  it("knows a PDF by how it starts", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html>"))).toBe(false);
  });

  it("makes file names a browser saves as they are", () => {
    expect(safeFileName("INV/2026-27/0012")).toBe("INV-2026-27-0012.pdf");
    expect(safeFileName("")).toBe("document.pdf");
    expect(safeFileName("quote.pdf")).toBe("quote.pdf");
  });
});
