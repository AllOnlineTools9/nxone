"use client";
import { owedOn } from "@/lib/documents/owed";
import { ChevronDown, ChevronRight, FilePlus2, Pencil, Search, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  TERMS_CHOICES, describeTerms, summarise, unsavedFromDocuments, type CustomerSummary
} from "@/lib/customers/customers";
import { GST_STATES, checkGstin } from "@/lib/returns/states";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import type { Client } from "@/lib/store/types";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * The people you bill.
 *
 * Customers are saved as you work, so this is where they are looked after: corrected when a
 * detail is wrong, given payment terms, and billed again in one click. A wrong GSTIN saved once
 * would otherwise come back on every invoice with nowhere to fix it.
 */

const ROUTES: Record<string, string> = {
  invoice: "/invoice-generator", proforma: "/invoice-generator", "credit-note": "/invoice-generator",
  "delivery-note": "/invoice-generator", quote: "/quotation-generator", receipt: "/receipt-generator"
};

type Draft = Pick<Client, "name" | "address" | "email" | "phone" | "taxId" | "region" | "termsDays" | "notes">;

export default function Customers() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "" });
  const [message, setMessage] = useState("");

  const today = todayIso();
  const summaries = useMemo<CustomerSummary[]>(
    () => db.clients().map((c) => summarise(c, db.documents(), today)),
    // keyed on the workspace, which is replaced on every save, so an edit or an import shows
    // straight away; the store itself never changes identity
    [ws, today]
  );
  const unsaved = useMemo(() => unsavedFromDocuments(db.clients(), db.documents()), [ws]);

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const currency = ws.profile?.currency ?? "INR";
  const country = ws.profile?.country ?? "IN";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const date = (iso: string) => formatDate(iso, country);

  const q = query.trim().toLowerCase();
  const shown = summaries
    .filter((s) => !q || `${s.client.name} ${s.client.email ?? ""} ${s.client.taxId ?? ""} ${s.client.phone ?? ""}`.toLowerCase().includes(q))
    // Who owes the most first: that is who somebody opens this page to look at.
    .sort((a, b) => b.owedMinor - a.owedMinor || a.client.name.localeCompare(b.client.name));

  const totalOwed = summaries.reduce((sum, s) => sum + Math.max(0, s.owedMinor), 0);

  const startEdit = (c: Client) => {
    setEditing(c.id);
    setOpen(c.id);
    setDraft({ name: c.name, address: c.address, email: c.email, phone: c.phone, taxId: c.taxId, region: c.region, termsDays: c.termsDays, notes: c.notes });
  };

  const saveEdit = (c: Client) => {
    if (!draft.name.trim()) return;
    store.saveClient({ ...c, ...draft, id: c.id, name: draft.name.trim(), taxId: draft.taxId?.trim().toUpperCase() || undefined });
    setEditing(null);
    setMessage(`${draft.name.trim()} is updated. Documents already issued keep the details they were sent with.`);
  };

  const remove = (s: CustomerSummary) => {
    const said = s.documents.length > 0
      ? `Remove ${s.client.name}? Their ${s.documents.length} ${s.documents.length === 1 ? "document stays" : "documents stay"} exactly as issued; only the saved customer goes.`
      : `Remove ${s.client.name}?`;
    if (!confirm(said)) return;
    store.deleteClient(s.client.id);
    setMessage(`${s.client.name} is removed from your customers.`);
  };

  const importAll = () => {
    for (const u of unsaved) {
      const buyer = u.doc.doc?.buyer;
      store.saveClient({
        name: u.name, address: buyer?.address, email: buyer?.email, phone: buyer?.phone,
        taxId: buyer?.taxId, region: u.doc.doc?.placeOfSupply || buyer?.region, version: 1
      } as never);
    }
    setMessage(`${unsaved.length} ${unsaved.length === 1 ? "customer" : "customers"} added from your past documents.`);
  };

  const gstinVerdict = draft.taxId?.trim() ? checkGstin(draft.taxId.trim()) : undefined;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label="Customers" value={String(summaries.length)} />
        <Figure label="Owed to you" value={money(totalOwed)} />
        <Figure label="With something overdue" value={String(summaries.filter((s) => s.overdue > 0).length)} />
      </section>

      {unsaved.length > 0 ? (
        <section className="rounded-lg border border-line bg-canvas p-4">
          <p className="text-sm">
            <span className="font-medium">{unsaved.length} {unsaved.length === 1 ? "person you have billed is" : "people you have billed are"} not saved yet</span>
            <span className="text-ink-soft"> - from before customers were remembered automatically.</span>
          </p>
          <button type="button" className="btn-ghost mt-3" onClick={importAll}>
            <UserPlus size={16} /> Add them from your past documents
          </button>
        </section>
      ) : null}

      {message ? <p className="rounded-lg border border-line bg-canvas p-3 text-sm">{message}</p> : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">Everyone you bill</h2>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-2 focus-within:border-forest">
            <Search size={15} className="text-ink-faint" aria-hidden="true" />
            <input
              className="w-56 bg-transparent py-2 text-sm outline-none" value={query}
              onChange={(e) => setQuery(e.target.value)} placeholder="Name, GSTIN, email or phone"
              aria-label="Find a customer"
            />
          </div>
        </div>

        {summaries.length === 0 ? (
          <p className="mt-4 max-w-2xl text-sm text-ink-soft">
            Nobody yet. Customers are added on their own the first time you save or download a
            document for them, so this fills up as you work.
          </p>
        ) : shown.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">Nobody matches &ldquo;{query}&rdquo;.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {shown.map((s) => {
              const c = s.client;
              const isOpen = open === c.id;
              return (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button type="button" className="flex min-w-0 items-start gap-2 text-left" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
                      {isOpen ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-ink-faint" /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-faint" />}
                      <span className="min-w-0">
                        <span className="block font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-ink-faint">
                          {[c.taxId, c.email, c.phone].filter(Boolean).join(" · ") || "No contact details saved"}
                          {s.lastOn ? ` · last billed ${date(s.lastOn)}` : ""}
                          {c.termsDays !== undefined ? ` · ${describeTerms(c.termsDays).toLowerCase()}` : ""}
                        </span>
                      </span>
                    </button>
                    <span className="flex w-full items-center justify-between gap-3 sm:w-auto sm:shrink-0 sm:justify-start">
                      {s.owedMinor > 0 ? (
                        <span className={`text-sm tabular ${s.overdue > 0 ? "font-semibold text-bad" : ""}`}>
                          {money(s.owedMinor)} owed{s.overdue > 0 ? `, ${s.overdue} overdue` : ""}
                        </span>
                      ) : null}
                      <Link href={`/invoice-generator/?customer=${c.id}`} className="btn-ghost shrink-0 whitespace-nowrap text-sm">
                        <FilePlus2 size={15} /> New invoice
                      </Link>
                    </span>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 ml-6 space-y-4">
                      {editing === c.id ? (
                        <div className="grid gap-3 rounded-lg border border-line bg-canvas p-4 sm:grid-cols-2">
                          <Field label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
                          <div>
                            <Field label="GSTIN" value={draft.taxId ?? ""} onChange={(v) => setDraft({ ...draft, taxId: v })} />
                            {gstinVerdict && !gstinVerdict.valid ? <p className="mt-1 text-xs text-warn">{gstinVerdict.says}</p> : null}
                          </div>
                          <Field label="Email" value={draft.email ?? ""} onChange={(v) => setDraft({ ...draft, email: v })} />
                          <Field label="Phone" value={draft.phone ?? ""} onChange={(v) => setDraft({ ...draft, phone: v })} />
                          <div className="sm:col-span-2">
                            <label className="label" htmlFor={`addr-${c.id}`}>Address</label>
                            <textarea id={`addr-${c.id}`} className="field" rows={2} value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                          </div>
                          {country === "IN" ? (
                            <div>
                              <label className="label" htmlFor={`state-${c.id}`}>State</label>
                              <select id={`state-${c.id}`} className="field" value={draft.region ?? ""} onChange={(e) => setDraft({ ...draft, region: e.target.value || undefined })}>
                                <option value="">Not set</option>
                                {GST_STATES.map((st) => <option key={st.region} value={st.region}>{st.name}</option>)}
                              </select>
                            </div>
                          ) : null}
                          <div>
                            <label className="label" htmlFor={`terms-${c.id}`}>Payment terms</label>
                            <select
                              id={`terms-${c.id}`} className="field"
                              value={draft.termsDays === undefined ? "" : String(draft.termsDays)}
                              onChange={(e) => setDraft({ ...draft, termsDays: e.target.value === "" ? undefined : Number(e.target.value) })}
                            >
                              <option value="">Not set</option>
                              {TERMS_CHOICES.map((d) => <option key={d} value={d}>{describeTerms(d)}</option>)}
                            </select>
                            <p className="mt-1 text-xs text-ink-faint">Sets the due date when you pick them on an invoice.</p>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="label" htmlFor={`notes-${c.id}`}>Notes for yourself</label>
                            <input id={`notes-${c.id}`} className="field" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Accounts contact, purchase order needed, anything worth remembering" />
                          </div>
                          <div className="sm:col-span-2">
                            <button type="button" className="btn-primary" onClick={() => saveEdit(c)} disabled={!draft.name.trim()}>Save</button>
                            <button type="button" className="btn-quiet ml-2" onClick={() => setEditing(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="text-sm text-ink-soft">
                            {c.address ? <p className="whitespace-pre-line">{c.address}</p> : null}
                            <p className="mt-1">Payment terms: {describeTerms(c.termsDays)}</p>
                            {c.notes ? <p className="mt-1">{c.notes}</p> : null}
                          </div>
                          <span className="flex gap-1">
                            <button type="button" className="btn-quiet text-sm" onClick={() => startEdit(c)}><Pencil size={14} /> Edit</button>
                            <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-bad" aria-label={`Remove ${c.name}`} onClick={() => remove(s)}>
                              <Trash2 size={15} />
                            </button>
                          </span>
                        </div>
                      )}

                      {s.documents.length > 0 ? (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                            {s.documents.length} {s.documents.length === 1 ? "document" : "documents"} · {money(s.billedMinor)} billed in all
                          </p>
                          <ul className="mt-2 space-y-1 text-sm">
                            {s.documents.slice(0, 12).map((d) => (
                              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                                <Link href={`${ROUTES[d.kind] ?? "/invoice-generator"}/?doc=${d.id}`} className="hover:underline">
                                  {d.number} <span className="text-ink-faint">· {date(d.issueDate)}</span>
                                </Link>
                                <span className="tabular text-ink-soft">
                                  {money(d.totalMinor)}
                                  {d.kind === "invoice" && owedOn(d) > 0 && d.status !== "cancelled" ? ` · ${money(owedOn(d))} owed` : ` · ${d.status}`}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {s.documents.length > 12 ? <p className="mt-1 text-xs text-ink-faint">and {s.documents.length - 12} older ones in Your documents.</p> : null}
                        </div>
                      ) : (
                        <p className="text-sm text-ink-soft">Nothing billed to them yet.</p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-2xl tabular">{value}</p>
    </div>
  );
}
