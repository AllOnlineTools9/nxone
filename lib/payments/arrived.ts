import type { SavedDocument } from "../store/types";
import type { ArrivedPayment } from "../sync/api";

/**
 * Applying payments that arrived through a payment link.
 *
 * The rule that matters: never record the same payment twice. Money arriving is told to us by a
 * webhook, which can be delivered more than once, read by more than one device, and arrive while
 * somebody is also ticking the invoice off by hand. So this works out what would change before
 * anything is written, and refuses anything that would take an invoice past what it was for.
 */

export interface Application {
  documentId: string;
  number: string;
  /** What the invoice will say has been paid once this is applied. */
  paidMinor: number;
  status: SavedDocument["status"];
  paidOn: string;
  reference?: string;
  /** Said to the person, because money appearing on its own needs explaining. */
  describes: string;
}

export interface Refusal {
  documentId: string;
  why: string;
}

export function applyArrived(
  payments: ArrivedPayment[],
  documents: SavedDocument[],
  money: (minor: number) => string
): { apply: Application[]; refuse: Refusal[] } {
  const apply: Application[] = [];
  const refuse: Refusal[] = [];

  for (const payment of payments) {
    const document = documents.find((d) => d.id === payment.documentId);
    if (!document) {
      refuse.push({ documentId: payment.documentId, why: "That invoice is not on this device." });
      continue;
    }
    if (document.status === "cancelled") {
      refuse.push({ documentId: payment.documentId, why: `${document.number} was cancelled, but a payment arrived against it. Worth looking at before anything is recorded.` });
      continue;
    }

    const already = document.paidMinor;
    const after = already + payment.amountMinor;

    // Already settled, or settled by hand in the meantime: the webhook is telling us something
    // we know. Recording it again would show the customer as having paid twice.
    if (already >= document.totalMinor) {
      refuse.push({ documentId: payment.documentId, why: `${document.number} is already shown as paid in full.` });
      continue;
    }
    if (after > document.totalMinor) {
      refuse.push({
        documentId: payment.documentId,
        why: `${money(payment.amountMinor)} arrived against ${document.number}, which would take it past the ${money(document.totalMinor)} it was for. Record it yourself once you have checked.`
      });
      continue;
    }

    const settled = after >= document.totalMinor;
    apply.push({
      documentId: document.id,
      number: document.number,
      paidMinor: after,
      status: settled ? "paid" : "partly-paid",
      paidOn: payment.paidOn,
      reference: payment.reference,
      describes: settled
        ? `${document.number} was paid in full - ${money(payment.amountMinor)}${payment.method ? ` by ${payment.method}` : ""}.`
        : `${money(payment.amountMinor)} came in against ${document.number}, leaving ${money(document.totalMinor - after)}.`
    });
  }

  return { apply, refuse };
}
