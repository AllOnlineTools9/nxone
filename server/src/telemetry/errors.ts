/**
 * Errors from the site and the API, kept so someone finds out before a customer has to say.
 *
 * Every report is reduced before it is stored: no query strings, no email addresses, no long
 * numbers (which could be phone numbers, GSTINs or amounts), no tokens. What is left says what
 * broke and where, not whose work it was. Reports with the same cause share a fingerprint, so a
 * crash hitting a thousand people is one row with a count of a thousand and one email.
 */

export type ErrorSource = "site" | "api";

export interface ErrorReport {
  source: ErrorSource;
  message: string;
  stack?: string;
  /** Path only. */
  path?: string;
  userAgent?: string;
}

export const MAX_MESSAGE = 500;
export const MAX_STACK = 4000;

/** Errors that are not ours to fix: browser extensions, cross-origin scripts, a known browser quirk. */
const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /chrome-extension:|moz-extension:|safari-extension:|safari-web-extension:/i,
  /Non-Error promise rejection captured/i,
  /^AbortError/i,
  /The user aborted a request/i,
  /Load failed$/i,
  /^NetworkError when attempting to fetch/i,
  /^Failed to fetch$/i
];

export function isNoise(report: Pick<ErrorReport, "message" | "stack">): boolean {
  const text = `${report.message}\n${report.stack ?? ""}`;
  return NOISE.some((re) => re.test(report.message) || (re.source.includes("extension") && re.test(text)));
}

/** Takes out anything that could identify a person or a business. */
export function scrub(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)'"]+/g, (url) => url.replace(/[?#].*$/, ""))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g, "<gstin>")
    .replace(/\b(?:eyJ|sk_|rzp_|re_|AIza)[A-Za-z0-9._-]{8,}/g, "<secret>")
    .replace(/\/view\/[A-Za-z0-9]{12,}/g, "/view/<token>")
    .replace(/\b[A-Za-z0-9]{32,}\b/g, "<token>")
    .replace(/\d{6,}/g, "<n>");
}

/** A path without its query or fragment, and without share tokens. */
export function safePath(path: unknown): string | undefined {
  if (typeof path !== "string" || !path) return undefined;
  let p = path;
  try { p = new URL(path, "https://x.invalid").pathname; } catch { /* keep as given */ }
  return scrub(p).slice(0, 200);
}

/**
 * What makes two reports the same problem: where they came from, the message with its numbers
 * and quoted values taken out, and the first frame of the stack without line and column, so a
 * new build of the same code does not look like a new error.
 */
export async function fingerprint(report: ErrorReport): Promise<string> {
  const message = report.message
    .replace(/(["'`]).*?\1/g, "<v>")
    .replace(/\d+/g, "<n>")
    .slice(0, 200);
  const frame = (report.stack ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^at |@/.test(l)) ?? "";
  const place = frame
    .replace(/:\d+:\d+\)?$/, "")
    .replace(/\/_next\/static\/chunks\/[^/]+?-[a-f0-9]{8,}\.js/, "/_next/chunk.js")
    .replace(/[a-f0-9]{16,}/g, "<h>");
  const data = new TextEncoder().encode(`${report.source}|${message}|${place}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Takes what a browser sent and keeps only what is safe and useful. Null for nothing worth keeping. */
export function fromBrowser(body: unknown, userAgent: string | null): ErrorReport | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return null;
  const report: ErrorReport = {
    source: "site",
    message: scrub(message).slice(0, MAX_MESSAGE),
    stack: typeof b.stack === "string" ? scrub(b.stack).slice(0, MAX_STACK) : undefined,
    path: safePath(b.path),
    userAgent: userAgent?.slice(0, 200) ?? undefined
  };
  return isNoise(report) ? null : report;
}

/** An error the API threw itself. */
export function fromServer(error: unknown, req: Request): ErrorReport {
  const e = error instanceof Error ? error : new Error(String(error));
  return {
    source: "api",
    message: scrub(`${req.method} ${new URL(req.url).pathname}: ${e.message}`).slice(0, MAX_MESSAGE),
    stack: e.stack ? scrub(e.stack).slice(0, MAX_STACK) : undefined,
    path: safePath(new URL(req.url).pathname)
  };
}

/** The alert email. Plain text, no customer data, and the command to see the rest. */
export function alertText(report: ErrorReport, print: string): { subject: string; text: string } {
  const where = report.source === "api" ? "the API" : "the site";
  return {
    subject: `New error on ${where}: ${report.message.slice(0, 80)}`,
    text: [
      `A new error was reported from ${where}. This is the first time this one has been seen.`,
      "",
      `Message: ${report.message}`,
      report.path ? `Page: ${report.path}` : "",
      report.userAgent ? `Browser: ${report.userAgent}` : "",
      "",
      report.stack ? `Stack:\n${report.stack.split("\n").slice(0, 12).join("\n")}` : "",
      "",
      "You will not be emailed about this one again. To see how often it happens:",
      `npx wrangler d1 execute nxone --remote --command "SELECT count, first_seen, last_seen FROM error_reports WHERE fingerprint = '${print}'"`
    ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n")
  };
}
