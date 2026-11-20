"use client";
import { owedOn } from "@/lib/documents/owed";
import { ArrowRight, Copy, FileText, Pencil, Quote, Receipt, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatDate } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import type { DocumentStatus, SavedDocument } from "@/lib/store/types";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";
import { conversionsFor } from "@/lib/documents/convert";

const ROUTES: Record<string, string> = {
  invoice: "/invoice-generator", proforma: "/invoice-generator", quote: "/quotation-generator",
  "purchase-order": "/purchase-order-generator", receipt: "/receipt-generator",
  "credit-note": "/invoice-generator", "delivery-note": "/invoice-generator"
};
const ICONS: Record<string, typeof FileText> = {
  invoice: FileText, proforma: FileText, quote: Quote, "purchase-order": ShoppingCart, receipt: Receipt,
  "credit-note": FileText, "delivery-note": FileText
};

const STATUS: Record<DocumentStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-canvas text-ink-soft" },
  sent: { label: "Sent", className: "bg-forest-pale text-forest" },
  "partly-paid": { label: "Part paid", className: "bg-lime-pale text-ink" },
  paid: { label: "Paid", className: "bg-ok/10 text-ok" },
  cancelled: { label: "Cancelled", className: "bg-canvas text-ink-faint line-through" }
};

export default function DocumentList({ limit, title }: { limit?: number; title?: string }) {
  const [, db] = useWorkspace();
  const ready = useHydrated();
  const [filter, setFilter] = useState<"all" | DocumentStatus>("all");
  const [query, setQuery] = useState("");
  /** What the books refused, and why, when a closed period is touched. */
  const [refused, setRefused] = useState("");

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const all = db.documents();
  const rows = all
    .filter((d) => filter === "all" || d.status === filter)
    .filter((d) => !query.trim() || `${d.number} ${d.clientName}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, limit);

  const money = (d: SavedDocument, minor: number) => formatMoney(fromMinor(minor, d.currency), "en-IN");

  if (all.length === 0) {
    return (
      <div className="card p-8 text-center">
        <h2 className="font-display text-lg">Nothing saved yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">Press Save while you are making a document and it appears here, so you can reopen it, send it again or mark it paid.</p>
        <Link href="/invoice-generator?new=1" className="btn-primary mt-4">Make an invoice</Link>
      </div>
    );
  }

  return (
    <div>
      {title ? <h2 className="mb-3 font-display text-lg">{title}</h2> : null}

      {!limit ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="field max-w-xs" placeholder="Search by number or customer" aria-label="Search documents" />
          <div className="flex flex-wrap gap-1.5">
            {(["all", "draft", "sent", "partly-paid", "paid"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${filter === f ? "border-forest bg-forest text-white" : "border-line bg-white text-ink-soft hover:border-ink"}`}>
                {f === "all" ? "Everything" : STATUS[f].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {refused ? (
          <p role="alert" className="mb-4 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
            {refused} <button type="button" className="underline" onClick={() => setRefused("")}>Dismiss</button>
          </p>
        ) : null}

        <table className="table-cards w-full border-collapse text-sm">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Document</th>
              <th className="px-4 py-2.5 font-semibold">Customer</th>
              <th className="px-4 py-2.5 font-semibold">Date</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const Icon = ICONS[d.kind] ?? FileText;
              const owed = owedOn(d);
              return (
                <tr key={d.id} className="border-t border-line align-middle">
                  <td className="cell-full px-4 py-2.5">
                    <Link href={`${ROUTES[d.kind]}?doc=${d.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <Icon size={15} className="shrink-0 text-ink-faint" aria-hidden="true" />{d.number}
                    </Link>
                    {d.madeInto ? (
                      <span className="mt-0.5 block text-xs text-ink-faint">became {d.madeInto.number}</span>
                    ) : d.madeFrom ? (
                      <span className="mt-0.5 block text-xs text-ink-faint">from {d.madeFrom.number}</span>
                    ) : null}
                  </td>
                  <td className="cell-full px-4 py-2.5">{d.clientName}</td>
                  <td className="cell-grow px-4 py-2.5 tabular text-ink-soft">
                    {formatDate(d.issueDate, d.doc.country)}
                    {d.dueDate && d.status !== "paid" ? <span className="block text-xs text-ink-faint">due {formatDate(d.dueDate, d.doc.country)}</span> : null}
                  </td>
                  <td className="cell-strong px-4 py-2.5 text-right tabular">
                    {money(d, d.totalMinor)}
                    {owed > 0 && d.paidMinor > 0 ? <span className="block text-xs text-ink-faint">{money(d, owed)} left</span> : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      aria-label={`Status of ${d.number}`}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${STATUS[d.status].className}`}
                      value={d.status}
                      onChange={(e) => { try { store.setStatus(d.id, e.target.value as DocumentStatus); } catch (err) { setRefused(err instanceof Error ? err.message : "That could not be changed."); } }}
                    >
                      {(Object.keys(STATUS) as DocumentStatus[]).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
                    </select>
                  </td>
                  <td className="cell-end px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`${ROUTES[d.kind]}?doc=${d.id}`} className="rounded p-2.5 text-ink-faint hover:bg-canvas sm:p-1.5 hover:text-ink" aria-label={`Open ${d.number}`}><Pencil size={15} /></Link>
                      <Link href={`${ROUTES[d.kind]}?copy=${d.id}`} className="rounded p-2.5 text-ink-faint hover:bg-canvas sm:p-1.5 hover:text-ink" aria-label={`Duplicate ${d.number}`}><Copy size={15} /></Link>
                      {conversionsFor(d.kind).length && !d.madeInto ? (
                        <Link
                          href={`${ROUTES[conversionsFor(d.kind)[0].to]}?from=${d.id}&as=${conversionsFor(d.kind)[0].to}`}
                          className="rounded p-2.5 text-ink-faint hover:bg-canvas sm:p-1.5 hover:text-ink"
                          title={conversionsFor(d.kind)[0].describes}
                          aria-label={`${conversionsFor(d.kind)[0].label} from ${d.number}`}
                        ><ArrowRight size={15} /></Link>
                      ) : null}
                      <button type="button" onClick={() => { if (confirm(`Delete ${d.number}? This cannot be undone.`)) { try { store.deleteDocument(d.id); } catch (err) { setRefused(err instanceof Error ? err.message : "That could not be deleted."); } } }}
                        className="rounded p-2.5 text-ink-faint hover:bg-canvas sm:p-1.5 hover:text-bad" aria-label={`Delete ${d.number}`}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-faint">Nothing matches that.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {limit && all.length > limit ? (
        <p className="mt-3 text-sm"><Link href="/documents" className="font-medium underline">See all {all.length} documents</Link></p>
      ) : null}
    </div>
  );
}
