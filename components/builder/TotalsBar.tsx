"use client";
import { packFor } from "@/lib/countries/packs";
import type { DocumentData, DocumentTotals } from "@/lib/documents/types";
import { formatMoney } from "@/lib/money";

/** A running read-out of the document while you type, the way a finance tool shows its numbers. */
export default function TotalsBar({ doc, totals }: { doc: DocumentData; totals: DocumentTotals }) {
  const pack = packFor(doc.country);
  const m = (v: { minor: number; currency: string }) => formatMoney(v, pack.locale);
  // [label, value, the total, shown on phones]
  const cells: Array<[string, string, boolean?, boolean?]> = [
    ["Items", String(doc.items.length)],
    ["Taxable value", m(totals.taxableTotal)],
    [`${pack.taxLabel}${totals.taxRows.length > 1 ? ` (${totals.taxRows.length} rates)` : ""}`, m(totals.taxTotal), false, true],
    [totals.paid.minor > 0 ? "Balance due" : "Total", m(totals.paid.minor > 0 ? totals.balanceDue : totals.total), true, true]
  ];

  return (
    <dl className="flex flex-wrap items-stretch divide-x divide-line overflow-hidden rounded-xl border border-line bg-white">
      {/* On a phone this stays on screen while you type, so it keeps to the two numbers that matter. */}
      {cells.map(([label, value, strong, onPhone]) => (
        <div key={label} className={`min-w-[8rem] flex-1 px-3 py-1.5 sm:px-4 sm:py-2.5 ${strong ? "bg-forest-pale" : ""} ${onPhone ? "" : "hidden sm:block"}`}>
          <dt className="text-[0.68rem] font-semibold uppercase tracking-wider text-ink-faint">{label}</dt>
          <dd className={`tabular ${strong ? "font-display text-lg font-semibold sm:text-xl" : "text-base font-medium"}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
