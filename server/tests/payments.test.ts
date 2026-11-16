import { describe, expect, it } from "vitest";
import { NoLinks, RazorpayLinks, linkProvider } from "../src/payments/links";

const KEY = "rzp_test_key";
const SECRET = "a_secret";
const WEBHOOK_SECRET = "a_webhook_secret";

const sign = async (body: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const paidBody = (over: Record<string, unknown> = {}) => JSON.stringify({
  event: "payment_link.paid",
  payload: {
    payment_link: { entity: { id: "plink_ABC123", amount_paid: 5900000, status: "paid" } },
    payment: { entity: { id: "pay_XYZ789", method: "upi", created_at: 1793577600, amount: 5900000 } }
  },
  ...over
});

/* --------------------------------------------------------------- not connected */

describe("before a provider is connected", () => {
  it("offers no link and says why, rather than failing", async () => {
    const made = await new NoLinks().create();
    expect(made.url).toBeNull();
    expect(made.note).toContain("UPI code on the invoice still works");
  });

  it("is what you get when the keys are missing", () => {
    expect(linkProvider({}).live).toBe(false);
    expect(linkProvider({ PAYMENT_PROVIDER: "razorpay" }).live).toBe(false);
    expect(linkProvider({ PAYMENT_PROVIDER: "razorpay", RAZORPAY_KEY_ID: "x" }).live).toBe(false);
  });

  it("becomes live only when both keys are there", () => {
    expect(linkProvider({ PAYMENT_PROVIDER: "razorpay", RAZORPAY_KEY_ID: KEY, RAZORPAY_KEY_SECRET: SECRET }).live).toBe(true);
  });

  it("never treats an unconnected webhook as signed", async () => {
    expect(await new NoLinks().verifyWebhook()).toBe(false);
  });
});

/* ------------------------------------------------------------------ the signature */

describe("checking the provider really sent it", () => {
  const links = new RazorpayLinks(KEY, SECRET, WEBHOOK_SECRET);

  it("accepts a body signed with the webhook secret", async () => {
    const body = paidBody();
    expect(await links.verifyWebhook(body, await sign(body, WEBHOOK_SECRET))).toBe(true);
  });

  it("refuses one signed with the API key instead, which is a different secret", async () => {
    const body = paidBody();
    expect(await links.verifyWebhook(body, await sign(body, SECRET))).toBe(false);
  });

  it("refuses a body that has been changed after signing", async () => {
    const signature = await sign(paidBody(), WEBHOOK_SECRET);
    const tampered = paidBody({ payload: { payment_link: { entity: { id: "plink_ABC123", amount_paid: 99900000 } } } });
    expect(await links.verifyWebhook(tampered, signature)).toBe(false);
  });

  it("refuses a missing signature, which is somebody simply claiming an invoice was paid", async () => {
    expect(await links.verifyWebhook(paidBody(), null)).toBe(false);
    expect(await links.verifyWebhook(paidBody(), "")).toBe(false);
  });

  it("falls back to the API key only when no webhook secret is configured", async () => {
    const noWebhookSecret = new RazorpayLinks(KEY, SECRET);
    const body = paidBody();
    expect(await noWebhookSecret.verifyWebhook(body, await sign(body, SECRET))).toBe(true);
  });
});

/* --------------------------------------------------------------- reading the event */

describe("what counts as paid", () => {
  const links = new RazorpayLinks(KEY, SECRET, WEBHOOK_SECRET);

  it("reads the amount, the day and how they paid", () => {
    const paid = links.readPaid(paidBody())!;
    expect(paid.reference).toBe("plink_ABC123");
    expect(paid.amountMinor).toBe(5900000);
    expect(paid.paidOn).toBe("2026-11-02");
    expect(paid.method).toBe("upi");
    expect(paid.paymentReference).toBe("pay_XYZ789");
  });

  it("ignores every event except the one that means money arrived", () => {
    for (const event of ["payment_link.created", "payment_link.expired", "payment_link.partially_paid", "payment.failed"]) {
      expect(links.readPaid(paidBody({ event }))).toBeUndefined();
    }
  });

  it("ignores a paid event carrying no money", () => {
    expect(links.readPaid(JSON.stringify({
      event: "payment_link.paid",
      payload: { payment_link: { entity: { id: "plink_ABC123", amount_paid: 0 } } }
    }))).toBeUndefined();
  });

  it("ignores an event with no link to match it to", () => {
    expect(links.readPaid(JSON.stringify({ event: "payment_link.paid", payload: {} }))).toBeUndefined();
  });

  it("does not fall over on a body that is not JSON at all", () => {
    expect(links.readPaid("<html>maintenance</html>")).toBeUndefined();
  });

  it("falls back to the payment's own amount when the link does not carry one", () => {
    const paid = links.readPaid(JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: { entity: { id: "plink_ABC123" } },
        payment: { entity: { id: "pay_1", amount: 100000, created_at: 1793577600 } }
      }
    }))!;
    expect(paid.amountMinor).toBe(100000);
  });
});

/* ------------------------------------------------------------------- making one */

describe("asking the provider for a link", () => {
  const request = {
    orgId: "org_1", documentId: "dc_1", number: "INV-0012", amountMinor: 5900000, currency: "INR",
    description: "Invoice INV-0012 from Brightline Studio",
    customer: { name: "Anita Rao", email: "anita@globex.example", phone: "9845011111" },
    dueDate: "2026-11-29"
  };

  const withFetch = async (handler: (url: string, init: RequestInit) => Response) => {
    const original = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch;
    try {
      const made = await new RazorpayLinks(KEY, SECRET).create(request);
      return { made, calls };
    } finally {
      globalThis.fetch = original;
    }
  };

  it("sends the amount in the smallest unit, as the provider expects", async () => {
    const { calls } = await withFetch(() => new Response(JSON.stringify({ id: "plink_1", short_url: "https://rzp.io/i/abc" }), { status: 200 }));
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.amount).toBe(5900000);
    expect(sent.currency).toBe("INR");
  });

  it("ties the link to the invoice it is for, both ways", async () => {
    const { calls } = await withFetch(() => new Response(JSON.stringify({ id: "plink_1", short_url: "https://rzp.io/i/abc" }), { status: 200 }));
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.reference_id).toBe("org_1:dc_1");
    expect(sent.notes.invoice).toBe("INV-0012");
  });

  it("lets the link expire with the invoice rather than living forever", async () => {
    const { calls } = await withFetch(() => new Response(JSON.stringify({ id: "plink_1", short_url: "https://rzp.io/i/abc" }), { status: 200 }));
    const sent = JSON.parse(String(calls[0].init.body));
    expect(new Date(sent.expire_by * 1000).toISOString().slice(0, 10)).toBe("2026-11-29");
  });

  it("returns the short link the customer will actually open", async () => {
    const { made } = await withFetch(() => new Response(JSON.stringify({ id: "plink_1", short_url: "https://rzp.io/i/abc" }), { status: 200 }));
    expect(made.url).toBe("https://rzp.io/i/abc");
    expect(made.reference).toBe("plink_1");
  });

  it("explains a refusal instead of leaving a dead button", async () => {
    const { made } = await withFetch(() => new Response('{"error":{"description":"contact is invalid"}}', { status: 400 }));
    expect(made.url).toBeNull();
    expect(made.note).toContain("email or phone number");
  });

  it("says to try again when the provider is simply down", async () => {
    const { made } = await withFetch(() => new Response("upstream error", { status: 502 }));
    expect(made.url).toBeNull();
    expect(made.note).toContain("try the link again");
  });

  it("never puts the secret anywhere but the authorization header", async () => {
    const { calls } = await withFetch(() => new Response(JSON.stringify({ id: "p", short_url: "https://rzp.io/i/a" }), { status: 200 }));
    expect(String(calls[0].init.body)).not.toContain(SECRET);
    expect(String((calls[0].init.headers as Record<string, string>).Authorization)).toContain(btoa(`${KEY}:${SECRET}`));
  });
});
