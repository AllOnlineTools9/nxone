/**
 * A link that lets a customer pay an invoice.
 *
 * The UPI code on an Indian invoice already works, but it only works for somebody standing in
 * India with a UPI app, and nothing tells the business when it was paid. A payment link covers
 * cards, net banking and UPI, works from abroad, and — the part that matters — tells us when the
 * money actually arrived, so the invoice marks itself paid instead of waiting for somebody to
 * tick it off a bank statement a week later.
 *
 * The provider's secret can only live here. The device never sees it, which is the whole reason
 * this is a server route rather than something the browser does.
 */

export interface LinkRequest {
  orgId: string;
  documentId: string;
  number: string;
  amountMinor: number;
  currency: string;
  description: string;
  customer: { name?: string; email?: string; phone?: string };
  /** The day the invoice is due, so the link can expire with it. */
  dueDate?: string;
  /** Where the customer lands afterwards. */
  returnTo?: string;
}

export interface PaymentLink {
  /** Where to send the customer, or null when payments are not connected. */
  url: string | null;
  /** The provider's own id, which the webhook will quote back at us. */
  reference: string;
  expiresAt?: string;
  note?: string;
}

export interface PaidEvent {
  reference: string;
  amountMinor: number;
  paidOn: string;
  /** What the customer paid with, for the receipt: upi, card, netbanking. */
  method?: string;
  /** The provider's payment id, which is what a customer quotes when querying. */
  paymentReference?: string;
}

export interface LinkProvider {
  readonly name: string;
  readonly live: boolean;
  create(request: LinkRequest): Promise<PaymentLink>;
  verifyWebhook(body: string, signature: string | null): Promise<boolean>;
  /** The payment inside a webhook body, or undefined when the event is not one we act on. */
  readPaid(body: string): PaidEvent | undefined;
}

/** Until a provider is connected. Says so rather than pretending. */
export class NoLinks implements LinkProvider {
  readonly name = "none";
  readonly live = false;

  async create(): Promise<PaymentLink> {
    return {
      url: null,
      reference: "",
      note: "Card and net banking links are not connected yet. The UPI code on the invoice still works, and you can mark the invoice paid yourself."
    };
  }

  async verifyWebhook(): Promise<boolean> { return false; }
  readPaid(): undefined { return undefined; }
}

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

export class RazorpayLinks implements LinkProvider {
  readonly name = "razorpay";
  readonly live = true;

  constructor(private keyId: string, private keySecret: string, private webhookSecret?: string) {}

  async create(request: LinkRequest): Promise<PaymentLink> {
    // Razorpay takes the amount in the smallest unit, which is what we hold anyway.
    const body = {
      amount: request.amountMinor,
      currency: request.currency,
      description: request.description.slice(0, 2048),
      reference_id: `${request.orgId}:${request.documentId}`,
      customer: {
        name: request.customer.name?.slice(0, 128),
        email: request.customer.email,
        contact: request.customer.phone
      },
      notify: { sms: Boolean(request.customer.phone), email: Boolean(request.customer.email) },
      // We send the invoice ourselves, with the PDF attached. A second message from the payment
      // provider the moment a link is made would reach the customer before the invoice does.
      reminder_enable: true,
      notes: { invoice: request.number },
      ...(request.returnTo ? { callback_url: request.returnTo, callback_method: "get" } : {}),
      ...(request.dueDate ? { expire_by: Math.floor(Date.parse(`${request.dueDate}T23:59:59Z`) / 1000) } : {})
    };

    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${this.keyId}:${this.keySecret}`)}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const said = await res.text().catch(() => "");
      console.error("Razorpay refused the payment link:", res.status, said);
      return {
        url: null,
        reference: "",
        note: res.status === 400
          ? "The payment provider refused that invoice. Check the customer's email or phone number, and that the amount is above the provider's minimum."
          : "The payment provider could not be reached just now. The invoice is saved; try the link again in a moment."
      };
    }

    const made = await res.json() as { id: string; short_url: string; expire_by?: number };
    return {
      url: made.short_url,
      reference: made.id,
      expiresAt: made.expire_by ? new Date(made.expire_by * 1000).toISOString() : undefined
    };
  }

  /**
   * Razorpay signs a webhook with HMAC SHA-256 over the raw body, using the webhook secret —
   * which is a different secret from the API key. Compared in constant time: a comparison that
   * stops at the first wrong character tells an attacker how much of a forgery was right.
   */
  async verifyWebhook(body: string, signature: string | null): Promise<boolean> {
    const secret = this.webhookSecret ?? this.keySecret;
    if (!signature || !secret) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  }

  readPaid(body: string): PaidEvent | undefined {
    let event: {
      event?: string;
      payload?: {
        payment_link?: { entity?: { id?: string; amount_paid?: number; status?: string } };
        payment?: { entity?: { id?: string; method?: string; created_at?: number; amount?: number } };
      };
    };
    try { event = JSON.parse(body); } catch { return undefined; }

    // Only the event that means money arrived. Anything else — created, expired, partially paid —
    // must not mark an invoice paid.
    if (event.event !== "payment_link.paid") return undefined;

    const link = event.payload?.payment_link?.entity;
    const payment = event.payload?.payment?.entity;
    if (!link?.id) return undefined;

    const amount = link.amount_paid ?? payment?.amount ?? 0;
    if (amount <= 0) return undefined;

    return {
      reference: link.id,
      amountMinor: amount,
      paidOn: new Date((payment?.created_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10),
      method: payment?.method,
      paymentReference: payment?.id
    };
  }
}

export function linkProvider(env: {
  PAYMENT_PROVIDER?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
}): LinkProvider {
  if (env.PAYMENT_PROVIDER === "razorpay" && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    return new RazorpayLinks(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET);
  }
  return new NoLinks();
}

/**
 * What the device is told about a payment that has arrived. Deliberately small: the server knows
 * an invoice was paid, not what the invoice says — the books stay on the device.
 */
export interface PaymentNotice {
  documentId: string;
  amountMinor: number;
  paidOn: string;
  method?: string;
  reference?: string;
}
