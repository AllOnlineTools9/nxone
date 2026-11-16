"use client";
import { Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import { looksLikeUpiId } from "@/lib/documents/payment";
import type { DocumentData, DocumentTotals } from "@/lib/documents/types";
import { paymentLink, syncAvailable } from "@/lib/sync/api";

/** How the customer pays, printed on the document so they do not have to ask. */
export default function PaymentBox({ doc, update, totals, documentId }: {
  doc: DocumentData;
  update: (patch: Partial<DocumentData>) => void;
  totals?: DocumentTotals;
  /** Set once the document is saved: a link has to point at something that exists. */
  documentId?: string;
}) {
  const pay = doc.payment ?? {};
  const set = (patch: Partial<NonNullable<DocumentData["payment"]>>) => update({ payment: { ...pay, ...patch } });
  const upiOk = !pay.upiId || looksLikeUpiId(pay.upiId);
  const [making, setMaking] = useState(false);
  const [note, setNote] = useState("");

  /**
   * A link the customer can pay through, which also tells us when they have. Only for a saved
   * invoice: the link has to name a document that will still be here when the money arrives.
   */
  const makeLink = async () => {
    if (!documentId || !totals) return;
    setMaking(true); setNote("");
    const result = await paymentLink({
      documentId, number: doc.number, amountMinor: totals.total.minor, currency: doc.currency,
      description: `Invoice ${doc.number} from ${doc.seller.name || "us"}`,
      customer: { name: doc.buyer.name, email: doc.buyer.email, phone: doc.buyer.phone },
      dueDate: doc.dueDate
    });
    setMaking(false);

    if (!result.ok) { setNote(result.error); return; }
    if (!result.data.url) { setNote(result.data.note ?? "No link could be made."); return; }
    set({ paymentLink: result.data.url });
    setNote(result.data.reused
      ? "That invoice already had a live link, so this is the same one — two links for one bill is how a customer pays twice."
      : "Done. It is on the invoice, and the invoice will mark itself paid when the money arrives.");
  };

  return (
    <section className="card p-5">
      <h2 className="font-display text-lg">Getting paid</h2>
      <p className="mt-1 text-sm text-ink-soft">A code they can scan beats bank details they have to retype.</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {doc.country === "IN" ? (
          <div>
            <label className="label" htmlFor="upi">UPI id</label>
            <input id="upi" className="field" value={pay.upiId || ""} onChange={(e) => set({ upiId: e.target.value })} placeholder="acme@hdfcbank" />
            {!upiOk ? <p className="mt-1 text-xs text-warn">That does not look like a UPI id. They look like name@bank.</p> : null}
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="paylink">Payment link</label>
          <input id="paylink" className="field" value={pay.paymentLink || ""} onChange={(e) => set({ paymentLink: e.target.value })} placeholder="https://rzp.io/l/your-page" />
          {syncAvailable() && doc.kind === "invoice" ? (
            <button
              type="button" className="btn-quiet mt-2 text-sm"
              onClick={makeLink}
              disabled={making || !documentId || !totals?.total.minor}
              title={documentId ? undefined : "Save the invoice first, so the link has something to point at."}
            >
              {making ? <><Loader2 size={14} className="animate-spin" />Asking your provider</> : <><Link2 size={14} />Make one for this invoice</>}
            </button>
          ) : null}
          {note ? <p className="mt-2 text-xs text-ink-soft">{note}</p> : null}
        </div>
      </div>

      {doc.country === "IN" && pay.upiId && upiOk ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={pay.includeAmount !== false} onChange={(e) => set({ includeAmount: e.target.checked })} />
          Put the amount in the code, so they cannot pay the wrong figure
        </label>
      ) : null}
    </section>
  );
}
