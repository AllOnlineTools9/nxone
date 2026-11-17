/**
 * Checks for the PDF kept behind a shared link. It arrives from a browser, so it is not trusted:
 * it must actually be a PDF, of a size an invoice could be, or anyone signed in could use a link
 * to host whatever file they liked on our domain.
 */

/** Large enough for an invoice with a logo and a signature; small enough that links cannot be used to host large files. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/** How many bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** A PDF starts with "%PDF-". Anything else is not what we said we would send. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** Checks the PDF on its own, for the shared link too. */
export function checkPdf(pdf: unknown): { ok: true; bytes: Uint8Array } | { ok: false; says: string } {
  if (typeof pdf !== "string" || !pdf) return { ok: false, says: "The PDF is missing." };
  if (base64Bytes(pdf) > MAX_PDF_BYTES) return { ok: false, says: "That PDF is too large to send. Try a smaller logo." };
  const bytes = decodeBase64(pdf);
  if (!bytes || !looksLikePdf(bytes)) return { ok: false, says: "That attachment is not a PDF." };
  return { ok: true, bytes };
}

/** A file name a mail client will show as it is: letters, digits, dash, dot and underscore. */
export function safeFileName(name: unknown): string {
  const base = String(name ?? "").replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "document"}.pdf`;
}
