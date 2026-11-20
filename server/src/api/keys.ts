/**
 * API keys: shown once, stored only as a hash. The prefix is kept so a person can tell keys
 * apart in a list ("nx_live_a1b2...") without the list being enough to use one.
 */

const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newApiKey(): { key: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const body = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  const key = `nx_live_${body}`;
  return { key, prefix: key.slice(0, 12) };
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The key from "Authorization: Bearer nx_live_...", or null. */
export function keyFrom(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  const m = auth.match(/^Bearer\s+(nx_live_[A-Za-z0-9]{20,64})$/);
  return m ? m[1] : null;
}
