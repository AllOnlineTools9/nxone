import Link from "next/link";

export const metadata = {
  title: "NXOne API and Webhooks - Developer Guide",
  description: "Create GST invoices and customers from your own software, and get a signed webhook when an invoice is paid. Endpoints, examples and signature checks.",
  alternates: { canonical: "/developers/" }
};

const Code = ({ children }: { children: string }) => (
  <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-[#0f1a14] p-4 text-[13px] leading-relaxed text-[#e6efe9]"><code>{children}</code></pre>
);

const ENDPOINTS: Array<[string, string, string]> = [
  ["GET", "/v1/me", "The business the key belongs to."],
  ["GET", "/v1/documents", "Documents, newest change first. Filter with kind, status and updated_since; page with limit and offset."],
  ["GET", "/v1/documents/{id}", "One document, with its lines."],
  ["POST", "/v1/invoices", "Make an invoice. Tax, totals and the next number in the series are worked out for you."],
  ["POST", "/v1/documents/{id}/payments", "Record money received against an invoice."],
  ["GET", "/v1/customers", "Customers, most recently changed first."],
  ["POST", "/v1/customers", "Add a customer."]
];

export default function Page() {
  return (
    <article className="wrap max-w-4xl py-12">
      <h1 className="text-4xl font-semibold">API and webhooks</h1>
      <p className="mt-4 text-lg text-ink-soft">
        Make invoices from your website, shop or CRM, and be told when they are paid. Invoices made through the API are
        built by the same code as the app, so GST, numbering and totals come out exactly as if they had been typed in,
        and they appear on every device the business uses.
      </p>
      <p className="mt-3 text-ink-soft">The API is part of the Business plan and the free trial. Make keys and webhooks under <Link href="/integrations/" className="underline">API and webhooks</Link> in the app.</p>

      <h2 className="mt-10 font-display text-2xl">Signing in</h2>
      <p className="mt-2">Send the key in the Authorization header. Keys act for one business; keep them on your server.</p>
      <Code>{`curl https://api.nxone.io/v1/me \\
  -H "Authorization: Bearer nx_live_..."`}</Code>
      <p className="mt-3 text-sm text-ink-soft">Up to 120 requests a minute per key. Errors come back as <code>{`{"error": {"status": 400, "message": "...", "field": "items[0].rate"}}`}</code>.</p>

      <h2 className="mt-10 font-display text-2xl">Endpoints</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {ENDPOINTS.map(([m, p, d]) => (
              <tr key={m + p} className="border-t border-line">
                <td className="py-2 pr-3 font-mono font-semibold">{m}</td>
                <td className="py-2 pr-3 font-mono">{p}</td>
                <td className="py-2 text-ink-soft">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 font-display text-2xl">Making an invoice</h2>
      <p className="mt-2">
        Give the customer and the lines. Each line can name its tax as <code>taxRate</code> (18) or as a <code>taxRuleId</code>;
        leave both out for the standard rate. Between states, IGST is used automatically. Send an <code>Idempotency-Key</code>
        so a retried request never makes a second invoice.
      </p>
      <Code>{`curl https://api.nxone.io/v1/invoices \\
  -H "Authorization: Bearer nx_live_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-10482" \\
  -d '{
    "customer": { "name": "Globex Pvt Ltd", "email": "accounts@globex.in",
                  "taxId": "27AAPFU0939F1ZV", "region": "MH",
                  "address": "12 Nariman Point\\nMumbai 400021" },
    "items": [
      { "description": "Steel rods", "quantity": 100, "unit": "kg",
        "rate": 800, "code": "7214", "taxRate": 18 }
    ],
    "dueInDays": 15,
    "notes": "Order 10482"
  }'`}</Code>
      <p className="mt-3 text-sm text-ink-soft">
        Optional: <code>number</code> (otherwise the next in the series), <code>issueDate</code> and <code>dueDate</code> (YYYY-MM-DD),
        <code> currency</code>, <code>taxInclusive</code>, <code>terms</code>, and <code>status</code> as &quot;draft&quot;. The answer is the invoice,
        with <code>total</code>, <code>paid</code> and <code>balance</code> in rupees.
      </p>

      <h2 className="mt-10 font-display text-2xl">Recording a payment</h2>
      <Code>{`curl https://api.nxone.io/v1/documents/dc_8f2.../payments \\
  -H "Authorization: Bearer nx_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": 94400, "date": "2026-11-20" }'`}</Code>

      <h2 className="mt-10 font-display text-2xl">Webhooks</h2>
      <p className="mt-2">
        NXOne sends a POST with a JSON body to your address when something happens: <code>document.created</code>,
        <code> document.updated</code>, <code>document.paid</code>, <code>customer.created</code> and <code>expense.created</code>.
        A delivery that fails is tried twice more within seconds, and every delivery shows in the app, where it can be sent again.
      </p>
      <Code>{`{
  "id": "wd_3b1c...",
  "event": "document.paid",
  "createdAt": "2026-11-20T09:14:03.000Z",
  "data": { "id": "dc_8f2...", "number": "INV-0043", "status": "paid",
            "total": 94400, "paid": 94400, "balance": 0, ... }
}`}</Code>

      <h3 className="mt-6 text-lg font-semibold">Checking it came from NXOne</h3>
      <p className="mt-2">
        Each request carries <code>NXOne-Signature: t=1763630043,v1=5f2b...</code>: an HMAC-SHA256, with your webhook&apos;s
        secret, of the timestamp, a full stop and the raw body. Reject anything that does not match or is more than five minutes old.
      </p>
      <Code>{`// Node.js
import crypto from "node:crypto";

export function fromNXOne(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}`}</Code>
      <Code>{`# Python
import hashlib, hmac, time

def from_nxone(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300:
        return False
    expected = hmac.new(secret.encode(), f'{parts["t"]}.'.encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])`}</Code>
      <p className="mt-3 text-sm text-ink-soft">Answer with any 2xx within 10 seconds. Do slow work after answering. The <code>id</code> is the same when a delivery is sent again, so you can ignore one you have already handled.</p>
    </article>
  );
}
