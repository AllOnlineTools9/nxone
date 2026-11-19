import { describe, expect, it } from "vitest";
import { alertText, fingerprint, fromBrowser, fromServer, isNoise, safePath, scrub } from "../src/telemetry/errors";

describe("what an error report keeps", () => {
  it("takes out emails, GSTINs, long numbers, tokens and keys", () => {
    const out = scrub("Failed for owner@brightline.in GSTIN 29AAPFU0939F1ZV phone 9876543210 key AIzaSyA1b2c3d4e5f6g7h8 token rzp_live_abcdefgh123");
    expect(out).not.toMatch(/brightline|29AAPFU|9876543210|AIzaSy|rzp_live/);
    expect(out).toContain("<email>");
    expect(out).toContain("<gstin>");
  });

  it("drops query strings, where sign-in links and share tokens would be", () => {
    expect(scrub("at https://nxone.io/sign-in/?token=abc123def456 (x)")).toBe("at https://nxone.io/sign-in/ (x)");
    expect(safePath("/view/abcdefghjkmnpqrstuvw/?x=1")).toBe("/view/<token>/");
    expect(safePath("/documents/?q=Globex")).toBe("/documents/");
  });

  it("ignores errors that are not ours", () => {
    expect(isNoise({ message: "ResizeObserver loop completed with undelivered notifications." })).toBe(true);
    expect(isNoise({ message: "Script error." })).toBe(true);
    expect(isNoise({ message: "x is undefined", stack: "at foo (chrome-extension://abc/content.js:1:1)" })).toBe(true);
    expect(isNoise({ message: "Cannot read properties of undefined (reading 'items')" })).toBe(false);
    expect(fromBrowser({ message: "Script error." }, null)).toBeNull();
  });

  it("refuses empty reports", () => {
    expect(fromBrowser({}, null)).toBeNull();
    expect(fromBrowser({ message: "   " }, null)).toBeNull();
  });
});

describe("telling one error from another", () => {
  const stack = (file: string, line: number) =>
    `TypeError: x\n    at render (https://nxone.io/_next/static/chunks/app/page-${file}.js:${line}:12)`;

  it("treats the same crash in a new build as the same error", async () => {
    const a = await fingerprint({ source: "site", message: "Cannot read 'items' of undefined", stack: stack("1a2b3c4d5e6f7a8b", 10) });
    const b = await fingerprint({ source: "site", message: "Cannot read 'items' of undefined", stack: stack("9f8e7d6c5b4a3f2e", 99) });
    expect(a).toBe(b);
  });

  it("treats the same message with different values as one error", async () => {
    const a = await fingerprint({ source: "site", message: 'No document "INV-0012" (3 tries)' });
    const b = await fingerprint({ source: "site", message: 'No document "QUO-0400" (7 tries)' });
    expect(a).toBe(b);
  });

  it("keeps different causes apart", async () => {
    const a = await fingerprint({ source: "site", message: "Cannot read 'items' of undefined" });
    const b = await fingerprint({ source: "site", message: "Maximum call stack size exceeded" });
    const c = await fingerprint({ source: "api", message: "Cannot read 'items' of undefined" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("errors from the API", () => {
  it("names the route without its query", () => {
    const r = fromServer(new Error("D1_ERROR: no such table"), new Request("https://api.nxone.io/portal/share?x=1", { method: "POST" }));
    expect(r.message).toBe("POST /portal/share: D1_ERROR: no such table");
    expect(r.source).toBe("api");
  });

  it("emails what broke, without any customer data, and how to look further", () => {
    const mail = alertText({ source: "api", message: "POST /portal/share: boom", path: "/portal/share" }, "abc123");
    expect(mail.subject).toContain("API");
    expect(mail.text).toContain("abc123");
    expect(mail.text).not.toMatch(/\n\n\n/);
  });
});
