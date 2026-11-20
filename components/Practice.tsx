"use client";
import { AlertTriangle, Check, Download, Loader2, Mail, RefreshCw, Search, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { makeZip } from "@/lib/files/zip";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { booksFrom, summarise, type ClientBooks, type ClientSummary } from "@/lib/practice/summary";
import { tallyExport, tallyFiles } from "@/lib/reports/tally";
import { financialYear, monthPeriod, quarterPeriod } from "@/lib/store/reports";
import {
  askForAccess, cancelAccessRequest, leaveClient, practiceClients, practiceRecords, practiceRequests, syncAvailable,
  type PracticeClient, type PracticeRequest
} from "@/lib/sync/api";

/**
 * The practice: every business an accountant looks after, on one screen.
 *
 * Each client's books are read from the server copy into memory here, and never into the
 * accountant's own business on this device. They load a few at a time, so forty clients do not
 * all arrive at once.
 */

type Loaded = { books: ClientBooks; summary: ClientSummary } | { error: string };
type Span = "month" | "quarter" | "year";

const PARALLEL = 3;

async function loadBooks(orgId: string): Promise<ClientBooks> {
  const all: Array<{ kind: string; body: unknown }> = [];
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    const r = await practiceRecords(orgId, offset);
    if (!r.ok) throw new Error(r.error);
    all.push(...r.data.records);
    if (!r.data.more) break;
    offset = r.data.next;
  }
  return booksFrom(all);
}

export default function Practice() {
  const [clients, setClients] = useState<PracticeClient[] | null>(null);
  const [requests, setRequests] = useState<PracticeRequest[]>([]);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [query, setQuery] = useState("");
  const [attention, setAttention] = useState(false);
  const [span, setSpan] = useState<Span>("month");
  const [when, setWhen] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", businessName: "", note: "" });
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const today = todayIso();

  const refresh = useCallback(async () => {
    setError("");
    const [c, r] = await Promise.all([practiceClients(), practiceRequests()]);
    if (!c.ok) {
      if (c.status === 401) setSignedOut(true); else setError(c.error);
      return;
    }
    setClients(c.data.clients);
    if (r.ok) setRequests(r.data.requests);
  }, []);

  useEffect(() => { if (syncAvailable()) void refresh(); }, [refresh]);

  // Load the books a few at a time once the list is known.
  useEffect(() => {
    if (!clients) return;
    let cancelled = false;
    const queue = clients.filter((c) => !loaded[c.orgId]).map((c) => c.orgId);
    const worker = async () => {
      while (queue.length && !cancelled) {
        const orgId = queue.shift()!;
        try {
          const books = await loadBooks(orgId);
          if (!cancelled) setLoaded((l) => ({ ...l, [orgId]: { books, summary: summarise(books, today) } }));
        } catch (e) {
          if (!cancelled) setLoaded((l) => ({ ...l, [orgId]: { error: e instanceof Error ? e.message : "Could not load." } }));
        }
      }
    };
    void Promise.all(Array.from({ length: PARALLEL }, worker));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  const period = useMemo(() => {
    const anchor = `${when}-15`;
    return span === "month" ? monthPeriod(anchor) : span === "quarter" ? quarterPeriod(anchor) : financialYear(anchor);
  }, [span, when]);

  if (!syncAvailable()) return <p className="card p-6 text-ink-soft">The practice view needs accounts, which are not switched on for this copy of NXOne.</p>;
  if (signedOut) {
    return (
      <div className="card max-w-xl p-6">
        <h1 className="font-display text-2xl">Your clients</h1>
        <p className="mt-2 text-ink-soft">Sign in to see every business that has given you access, and to ask new ones.</p>
        <Link href="/sign-in/" className="btn-primary mt-4">Sign in</Link>
      </div>
    );
  }

  const ask = async () => {
    setAsking(true); setNote("");
    const r = await askForAccess({ email: form.email, businessName: form.businessName || undefined, note: form.note || undefined });
    setAsking(false);
    if (!r.ok) { setNote(r.error); return; }
    setNote(r.data.sent
      ? `${r.data.resent ? "Sent again" : "Sent"} to ${form.email}. They appear here once they say yes.`
      : "The request is saved, but the email could not be sent just now. Try again in a minute.");
    setForm({ email: "", businessName: "", note: "" });
    void refresh();
  };

  const downloadTally = (client: PracticeClient, books: ClientBooks) => {
    if (!books.profile) return;
    const input = { profile: books.profile, documents: books.documents, expenses: books.expenses, entries: books.entries, period };
    const files = tallyFiles(tallyExport(input), input);
    const name = (books.profile.name || client.name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";
    const url = URL.createObjectURL(new Blob([makeZip(files) as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${name}-tally-${period.from}-to-${period.to}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const leave = async (client: PracticeClient) => {
    if (!confirm(`Stop being the accountant for ${client.profile.name || client.name}? They can ask you back at any time.`)) return;
    const r = await leaveClient(client.orgId);
    if (r.ok) void refresh(); else setNote(r.error);
  };

  const money = (minor: number, currency: string) => formatMoney(fromMinor(minor, currency), currency === "INR" ? "en-IN" : "en-US");
  const list = (clients ?? [])
    .filter((c) => {
      const label = `${c.profile.name ?? ""} ${c.name} ${c.profile.taxId ?? ""}`.toLowerCase();
      if (query && !label.includes(query.toLowerCase())) return false;
      if (!attention) return true;
      const l = loaded[c.orgId];
      return Boolean(l && "summary" in l && (l.summary.overdueReturns > 0 || l.summary.overdueInvoices > 0));
    })
    .sort((a, b) => Number(b.role === "accountant") - Number(a.role === "accountant") || (a.profile.name ?? a.name).localeCompare(b.profile.name ?? b.name));

  const pending = requests.filter((r) => r.state === "pending" || r.state === "expired");
  const clientCount = (clients ?? []).filter((c) => c.role === "accountant").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Your clients</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">
            Every business that has given you accountant access: what is due to be filed, what they are owed,
            and their books for Tally, without switching between accounts.
          </p>
        </div>
        <button type="button" className="btn-quiet" onClick={() => { setLoaded({}); void refresh(); }}><RefreshCw size={15} />Refresh</button>
      </header>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-display text-lg"><UserPlus size={18} />Add a client</h2>
        <p className="mt-1 text-sm text-ink-soft">
          They get an email asking them to give you access. If they do not use NXOne yet, it is free for them, and
          your seat costs them nothing on any plan. You can see and export their books, never change them.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="label">Their email</span>
            <input className="field" type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="owner@business.in" />
          </label>
          <label className="block text-sm">
            <span className="label">Business name (optional)</span>
            <input className="field" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="label">A line from you (optional)</span>
            <input className="field" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="For this year's GST returns" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={asking || !form.email.includes("@")} onClick={() => void ask()}>
            {asking ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}Send the request
          </button>
          {note ? <span role="status" className="text-sm">{note}</span> : null}
        </div>

        {pending.length ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-semibold">Waiting for an answer</h3>
            <ul className="mt-2 divide-y divide-line text-sm">
              {pending.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{r.businessName ? `${r.businessName}, ` : ""}{r.email}</span>
                  <span className="flex items-center gap-3 text-ink-soft">
                    {r.state === "expired" ? "Expired" : `Sent ${formatDate(new Date(r.sentAt).toISOString().slice(0, 10), "IN")}`}
                    <button type="button" className="btn-quiet text-sm" onClick={() => setForm({ email: r.email, businessName: r.businessName ?? "", note: "" })}>Send again</button>
                    {r.state === "pending" ? <button type="button" className="btn-quiet text-sm" onClick={() => void cancelAccessRequest(r.id).then(refresh)}>Withdraw</button> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-5">
          <label className="relative block min-w-[12rem] flex-1">
            <span className="sr-only">Find a client</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="field pl-9" placeholder="Find by name or GSTIN" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} />Only those needing attention
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="label">Tally period</span>
              <select className="field" value={span} onChange={(e) => setSpan(e.target.value as Span)}>
                <option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Financial year</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="label">{span === "month" ? "Month" : "Containing"}</span>
              <input type="month" className="field" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
          </div>
        </div>

        {error ? <p className="p-5 text-bad">{error}</p> : null}
        {!clients ? <p className="flex items-center gap-2 p-5 text-ink-soft"><Loader2 size={16} className="animate-spin" />Finding your clients</p> : null}
        {clients && clientCount === 0 ? (
          <p className="p-5 text-ink-soft">No clients yet. Send a request above: each business that says yes appears here.</p>
        ) : null}

        <ul>
          {list.map((c) => {
            const l = loaded[c.orgId];
            const s = l && "summary" in l ? l.summary : null;
            const books = l && "books" in l ? l.books : null;
            const name = c.profile.name || books?.profile?.name || c.name;
            const expanded = open === c.orgId;
            return (
              <li key={c.orgId} className="border-t border-line p-5 first:border-t-0">
                <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                  <div className="min-w-[14rem] flex-1">
                    <p className="font-medium">
                      {name}
                      {c.role !== "accountant" ? <span className="chip ml-2 text-xs">{c.current ? "Your business" : c.role}</span> : null}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {c.profile.taxId ? `GSTIN ${c.profile.taxId}` : "No GSTIN set"}
                      {c.lastActivity ? ` · last change ${formatDate(new Date(c.lastActivity).toISOString().slice(0, 10), "IN")}` : " · nothing synced yet"}
                    </p>
                  </div>

                  {!l ? <span className="flex items-center gap-2 text-sm text-ink-soft"><Loader2 size={14} className="animate-spin" />Loading</span> : null}
                  {l && "error" in l ? <span className="text-sm text-bad">{l.error}</span> : null}

                  {s ? (
                    <>
                      <div className="min-w-[11rem] text-sm">
                        <p className="text-xs uppercase tracking-wider text-ink-faint">Next return</p>
                        {s.next ? (
                          <p className={s.next.daysAway < 0 ? "font-medium text-bad" : s.next.daysAway <= 7 ? "font-medium text-warn" : ""}>
                            {s.next.rule.name} {s.next.period}
                            <span className="block text-ink-soft">
                              {s.next.daysAway < 0 ? `${-s.next.daysAway} days late` : s.next.daysAway === 0 ? "Due today" : `Due ${formatDate(s.next.dueDate, "IN")}`}
                              {s.overdueReturns > 1 ? `, ${s.overdueReturns} late in all` : ""}
                            </span>
                          </p>
                        ) : <p className="text-ink-soft">{c.profile.registrations?.length ? "Nothing due soon" : "Registrations not set"}</p>}
                      </div>
                      <div className="min-w-[9rem] text-sm">
                        <p className="text-xs uppercase tracking-wider text-ink-faint">Owed to them</p>
                        <p className="tabular">{money(s.receivableMinor, s.currency)}</p>
                        <p className={`text-ink-soft ${s.overdueInvoices ? "text-warn" : ""}`}>{s.overdueInvoices ? `${s.overdueInvoices} overdue` : "None overdue"}</p>
                      </div>
                      <div className="min-w-[9rem] text-sm">
                        <p className="text-xs uppercase tracking-wider text-ink-faint">Sales this month</p>
                        <p className="tabular">{money(s.salesThisMonthMinor, s.currency)}</p>
                        <p className="text-ink-soft">{s.invoicesThisMonth} invoice{s.invoicesThisMonth === 1 ? "" : "s"}</p>
                      </div>
                    </>
                  ) : null}
                </div>

                {books ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-ghost text-sm" disabled={!books.profile} onClick={() => downloadTally(c, books)}>
                      <Download size={15} />Tally, {period.label ?? `${period.from} to ${period.to}`}
                    </button>
                    <button type="button" className="btn-quiet text-sm" onClick={() => setOpen(expanded ? null : c.orgId)}>
                      {expanded ? "Hide returns" : "All returns"}
                    </button>
                    {c.role === "accountant" ? <button type="button" className="btn-quiet text-sm text-ink-soft" onClick={() => void leave(c)}><X size={14} />Stop being their accountant</button> : null}
                  </div>
                ) : null}

                {expanded && s ? (
                  <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
                    {s.deadlines.length === 0 ? <li className="p-3 text-ink-soft">No returns in the last 90 days or the next 45. Check their registrations under Filing calendar.</li> : null}
                    {s.deadlines.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <span>{d.rule.name} <span className="text-ink-soft">{d.period}</span></span>
                        <span className={d.done ? "text-ok" : d.daysAway < 0 ? "text-bad" : "text-ink-soft"}>
                          {d.done ? <><Check size={14} className="inline" /> Books closed</> : d.daysAway < 0 ? <><AlertTriangle size={14} className="inline" /> {-d.daysAway} days late</> : `Due ${formatDate(d.dueDate, "IN")}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs text-ink-faint">
        A return shows as done once the business closes its books past that period, which NXOne asks for when a return is filed.
        Every time you open a client&apos;s books it is recorded in their history.
      </p>
    </div>
  );
}
