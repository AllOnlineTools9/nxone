import { calculate } from "./totals";
import { kindConfig } from "./kinds";
import type { DocumentData } from "./types";

/**
 * What a customer is allowed to see of a document.
 *
 * Built field by field rather than by copying the document and deleting what should not go.
 * The difference matters: a field added to DocumentData later would find its own way into a
 * stranger's browser under the second approach, and nobody would notice until it had.
 */
export function snapshotFor(doc: DocumentData): Record<string, unknown> {
  const totals = calculate(doc);

  return {
    number: doc.number,
    kind: kindConfig(doc.kind).title,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    currency: doc.currency,
    totalMinor: totals.total.minor,
    paidMinor: doc.amountPaid ? Math.round(doc.amountPaid * 100) : 0,
    seller: {
      name: doc.seller.name,
      address: doc.seller.address,
      email: doc.seller.email,
      phone: doc.seller.phone,
      taxId: doc.seller.taxId
    },
    buyer: {
      name: doc.buyer.name,
      address: doc.buyer.address,
      taxId: doc.buyer.taxId
    },
    lines: doc.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      rate: item.rate,
      amountMinor: Math.round(item.quantity * item.rate * 100)
    })),
    taxLines: totals.taxRows.map((t) => ({ label: t.label, amountMinor: t.tax.minor })),
    notes: doc.notes || undefined,
    terms: doc.terms || undefined,
    payment: doc.payment?.upiId || doc.payment?.paymentLink || doc.paymentDetails
      ? {
          upiId: doc.payment?.upiId,
          link: doc.payment?.paymentLink,
          details: doc.paymentDetails
        }
      : undefined
  };
}
