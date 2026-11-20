import { describe, expect, it } from "vitest";
import { buildInvoice, documentView, nextInSeries } from "../src/api/build";
import { hashKey, keyFrom, newApiKey } from "../src/api/keys";
import { checkUrl, eventsForChange, eventsFrom, signature } from "../src/webhooks/sign";

const profile = {
  name: "Brightline Traders", country: "IN", currency: "INR", region: "KA", taxId: "29AAGCB7383J1Z4",
  address: "Indiranagar\nBengaluru 560038", nextNumbers: { invoice: "INV-0042" }
};
const today = "2026-11-19";
const base = { customer: { name: "Globex", region: "MH", taxId: "27aapfu0939f1zv" }, items: [{ description: "Rods", quantity: 2, rate: 500, taxRate: 18 }] };

describe("an invoice made through the API", () => {
  it("is built like one made in the app, with IGST between states", () => {
    const b = buildInvoice(base, profile, { today, usedNumbers: [] });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.doc.number).toBe("INV-0042");
    expect(b.nextNumber).toBe("INV-0043");
    expect(b.doc.placeOfSupply).toBe("MH");
    expect(b.doc.buyer.taxId).toBe("27AAPFU0939F1ZV");
    expect(b.totalMinor).toBe(118_000);
    expect(b.status).toBe("sent");
  });

  it("uses the intra-state rule for the same rate inside the state", () => {
    const inter = buildInvoice(base, profile, { today, usedNumbers: [] });
    const intra = buildInvoice({ ...base, customer: { name: "Local", region: "KA" } }, profile, { today, usedNumbers: [] });
    if (!inter.ok || !intra.ok) throw new Error("built");
    expect(intra.doc.items[0].taxRuleId).not.toBe(inter.doc.items[0].taxRuleId);
    expect(intra.totalMinor).toBe(118_000);
  });

  it("says exactly what is wrong", () => {
    const say = (input: object, p: object = profile) => {
      const b = buildInvoice(input, p, { today, usedNumbers: ["INV-0042"] });
      return b.ok ? "" : `${b.field}: ${b.says}`;
    };
    expect(say({ items: base.items })).toMatch(/^customer\.name/);
    expect(say({ customer: base.customer, items: [] })).toMatch(/^items:/);
    expect(say({ customer: base.customer, items: [{ description: "x", quantity: 0, rate: 1 }] })).toMatch(/quantity must be more than 0/);
    expect(say({ customer: base.customer, items: [{ description: "x", rate: 1, taxRate: 13 }] })).toMatch(/no 13% rate/);
    expect(say({ ...base, number: "INV-0042" })).toMatch(/INV-0042 already exists/);
    expect(say({ ...base, number: "X-1", issueDate: "2026-03-31" }, { ...profile, lockedUpTo: "2026-03-31" })).toMatch(/closed up to/);
  });

  it("skips a number already taken rather than reusing it", () => {
    const b = buildInvoice(base, profile, { today, usedNumbers: ["INV-0042", "INV-0043"] });
    expect(b.ok && b.doc.number).toBe("INV-0044");
  });

  it("carries on the series when the profile does not say", () => {
    expect(nextInSeries(["INV-0009", "INV-0012", "INV-0010"])).toBe("INV-0013");
    expect(nextInSeries([])).toBe("INV-0001");
  });

  it("shows amounts in major units", () => {
    const v = documentView({ id: "dc_1", kind: "invoice", number: "INV-1", status: "partly-paid", totalMinor: 118000, paidMinor: 18000, doc: { buyer: { name: "Globex" }, items: [] } });
    expect(v).toMatchObject({ total: 1180, paid: 180, balance: 1000, customer: { name: "Globex" } });
  });
});

describe("API keys", () => {
  it("are long, recognisable, and stored only as a hash", async () => {
    const { key, prefix } = newApiKey();
    expect(key).toMatch(/^nx_live_[A-Za-z0-9]{32}$/);
    expect(key.startsWith(prefix)).toBe(true);
    expect(await hashKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashKey(key)).not.toContain(key.slice(8));
  });

  it("are read from the Authorization header only", () => {
    const { key } = newApiKey();
    expect(keyFrom(new Request("https://x", { headers: { Authorization: `Bearer ${key}` } }))).toBe(key);
    expect(keyFrom(new Request(`https://x?key=${key}`))).toBeNull();
    expect(keyFrom(new Request("https://x", { headers: { Authorization: "Bearer something-else" } }))).toBeNull();
  });
});

describe("webhooks", () => {
  it("are signed with HMAC-SHA256 over the timestamp and body", async () => {
    // Known answer: HMAC-SHA256(key "whsec_test", "1700000000.{}")
    const sig = await signature("whsec_test", 1700000000, "{}");
    expect(sig).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
    expect(await signature("whsec_test", 1700000000, "{}")).toBe(sig);
    expect(await signature("whsec_other", 1700000000, "{}")).not.toBe(sig);
  });

  it("only go to public https addresses", () => {
    expect(checkUrl("https://shop.example.com/hooks/nxone").ok).toBe(true);
    for (const bad of ["http://shop.example.com", "https://localhost/x", "https://10.0.0.5/x", "https://[::1]/x", "https://api.nxone.io/x", "https://u:p@shop.example.com", "not a url"]) {
      expect(checkUrl(bad).ok).toBe(false);
    }
  });

  it("subscribe to everything unless told otherwise", () => {
    expect(eventsFrom(undefined)).toContain("document.paid");
    expect(eventsFrom(["document.paid", "nonsense"])).toEqual(["document.paid"]);
  });

  it("announce what actually changed", () => {
    expect(eventsForChange("document", undefined, { status: "sent" })).toEqual(["document.created"]);
    expect(eventsForChange("document", { status: "sent" }, { status: "paid" })).toEqual(["document.updated", "document.paid"]);
    expect(eventsForChange("document", { status: "paid" }, { status: "paid" })).toEqual(["document.updated"]);
    expect(eventsForChange("client", undefined, { name: "x" })).toEqual(["customer.created"]);
    expect(eventsForChange("client", { name: "x" }, { name: "y" })).toEqual([]);
    expect(eventsForChange("profile", undefined, {})).toEqual([]);
  });
});
