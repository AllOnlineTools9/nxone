import { API_URL } from "@/lib/sync/api";

/**
 * Sends an error from this page to the API, so it is seen without a customer having to say.
 *
 * Only the message, the stack and the page's path go: never the query string, never anything
 * typed into a document. The API scrubs again before keeping anything. Each distinct error is
 * sent once per page load and at most ten per page load, so a loop cannot flood anything.
 */

const sent = new Set<string>();
const MAX_PER_PAGE = 10;

export function reportError(error: unknown, extra?: { digest?: string }): void {
  if (!API_URL || typeof window === "undefined") return;
  // Local development shows errors on screen already.
  if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) return;

  const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const message = extra?.digest ? `${e.message} (digest ${extra.digest})` : e.message;
  const key = `${message}|${(e.stack ?? "").split("\n")[1] ?? ""}`;
  if (sent.has(key) || sent.size >= MAX_PER_PAGE) return;
  sent.add(key);

  const body = JSON.stringify({ message, stack: e.stack, path: window.location.pathname });
  try {
    // keepalive lets the report finish even if the page is closing.
    void fetch(`${API_URL}/telemetry/error`, {
      method: "POST", body, keepalive: true,
      headers: { "Content-Type": "application/json" }
    }).catch(() => { /* reporting must never cause a second error */ });
  } catch { /* nothing more to do */ }
}

/** Listens for errors nothing else caught. Returns a function that stops listening. */
export function listenForErrors(): () => void {
  const onError = (event: ErrorEvent) => reportError(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
