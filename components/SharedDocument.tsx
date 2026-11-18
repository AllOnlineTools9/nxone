"use client";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { API_URL, syncAvailable } from "@/lib/sync/api";
import { formatMoney, fromMinor } from "@/lib/money";

/**
 * What a customer sees when they open a shared link.
 *
 * Nothing to sign into and nothing of the business beyond this one document. The token is read
 * from the address rather than from a route parameter, because the site is exported statically
 * and one page serves every link.
 */
interface Shared {
  number: string;
  kind: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  seller: { name: string; address?: string; email?: string; phone?: string; taxId?: string };
  buyer: { name: string; address?: string; taxId?: string };
  lines: Array<{ description: string; quantity: number; rate: number; amountMinor: number }>;
  taxLines: Array<{ label: string; amountMinor: number }>;
  notes?: string;
  terms?: string;
  payment?: { upiId?: string; link?: string; details?: string };
}

export default function SharedDocument() {
  const [doc, setDoc] = useState<Shared | undefined>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState("");

  useEffect(() => {
    // The address is /view/<token>/, served by the one shared page; anything else has no token.
    const parts = window.location.pathname.split("/").filter(Boolean);
    const token = parts[0] === "view" ? parts[1] ?? "" : "";
    if (!token) { setError("There is nothing at this link."); setLoading(false); return; }
    if (!syncAvailable()) { setError("Shared links are not switched on yet."); setLoading(false); return; }

    (async () => {
      try {
        const res = await fetch(`${API_URL}/portal/view/${encodeURIComponent(token)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string; detail?: string; title?: string };
          setError(body.error ?? body.detail ?? body.title ?? "This link no longer works.");
        } else {
          const body = await res.json() as { document: Shared; hasPdf?: boolean };
          setDoc(body.document);
          if (body.hasPdf) setPdfUrl(`${API_URL}/portal/pdf/${encodeURIComponent(token)}`);
        }
      } catch {
        setError("That could not be loaded just now. Try again in a moment.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-16"><div className="h-64 animate-pulse rounded-xl bg-white/60" /></div>;

  if (error || !doc) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-display text-2xl">{error || "There is nothing at this link."}</h1>
        <p className="mt-2 text-ink-soft">If you were expecting a document, ask whoever sent it for a new link.</p>
      </div>
    );
  }

  const money = (minor: number) => formatMoney(fromMinor(minor, doc.currency));
  const outstanding = doc.totalMinor - doc.paidMinor;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {pdfUrl ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">{doc.kind} {doc.number} from {doc.seller.name}</p>
          {/* The API answers with the file as a download, so a plain link is enough on every phone. */}
          <a className="btn-primary" href={pdfUrl} rel="noopener"><Download size={16} />Download PDF</a>
        </div>
      ) : null}
      <article className="card p-6 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-display text-xl">{doc.seller.name}</p>
            {doc.seller.address ? <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{doc.seller.address}</p> : null}
            {doc.seller.taxId ? <p className="mt-1 text-xs text-ink-faint">{doc.seller.taxId}</p> : null}
          </div>
          <div className="sm:text-right">
            <p className="font-display text-2xl">{doc.kind}</p>
            <p className="mt-1 text-sm">{doc.number}</p>
            <p className="text-xs text-ink-faint">{doc.issueDate}{doc.dueDate ? ` · due ${doc.dueDate}` : ""}</p>
          </div>
        </header>

        <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-faint">For</p>
        <p className="font-medium">{doc.buyer.name}</p>
        {doc.buyer.address ? <p className="whitespace-pre-line text-sm text-ink-soft">{doc.buyer.address}</p> : null}

        <table className="mt-8 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
            <tr><th className="py-2">Description</th><th className="hidden py-2 text-right sm:table-cell">Qty</th><th className="hidden py-2 text-right sm:table-cell">Rate</th><th className="py-2 text-right">Amount</th></tr>
          </thead>
          <tbody>
            {doc.lines.map((line, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-2 pr-4">
                  {line.description}
                  {/* On a phone the quantity and rate sit under the description, not in columns. */}
                  <span className="block text-xs text-ink-faint tabular sm:hidden">{line.quantity} × {money(Math.round(line.rate * 100))}</span>
                </td>
                <td className="hidden py-2 text-right tabular sm:table-cell">{line.quantity}</td>
                <td className="hidden py-2 text-right tabular sm:table-cell">{money(Math.round(line.rate * 100))}</td>
                <td className="py-2 text-right tabular align-top">{money(line.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-6 ml-auto max-w-xs space-y-1 text-sm">
          {doc.taxLines.map((t) => (
            <div key={t.label} className="flex justify-between gap-6">
              <dt className="text-ink-soft">{t.label}</dt>
              <dd className="tabular">{money(t.amountMinor)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-6 border-t border-line pt-1 font-semibold">
            <dt>Total</dt><dd className="tabular">{money(doc.totalMinor)}</dd>
          </div>
          {doc.paidMinor > 0 ? (
            <>
              <div className="flex justify-between gap-6"><dt className="text-ink-soft">Paid</dt><dd className="tabular">{money(doc.paidMinor)}</dd></div>
              <div className="flex justify-between gap-6 font-semibold"><dt>Outstanding</dt><dd className="tabular">{money(outstanding)}</dd></div>
            </>
          ) : null}
        </dl>

        {doc.payment?.link ? (
          <a className="btn-primary mt-8 inline-flex" href={doc.payment.link} target="_blank" rel="noopener noreferrer">Pay this now</a>
        ) : null}
        {doc.payment?.upiId ? <p className="mt-4 text-sm">UPI: <span className="font-medium">{doc.payment.upiId}</span></p> : null}
        {doc.payment?.details ? <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{doc.payment.details}</p> : null}

        {doc.terms ? <p className="mt-8 whitespace-pre-line text-xs text-ink-soft">{doc.terms}</p> : null}
        {doc.notes ? <p className="mt-2 whitespace-pre-line text-xs text-ink-soft">{doc.notes}</p> : null}
      </article>

      <p className="mt-4 text-center text-xs text-ink-faint">
        Sent by {doc.seller.name}
        {doc.seller.email ? <> · <a className="underline" href={`mailto:${doc.seller.email}`}>{doc.seller.email}</a></> : null}
      </p>
    </div>
  );
}
