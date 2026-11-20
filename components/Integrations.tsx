"use client";
import { Check, Copy, KeyRound, Loader2, Plus, RotateCcw, Send, Trash2, Webhook, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  addWebhook, createApiKey, integrations, redeliver, removeWebhook, revokeApiKey, syncAvailable, testWebhook, webhookDeliveries,
  type Delivery, type IntegrationsView
} from "@/lib/sync/api";

/**
 * API keys and webhooks for the business. A key or a webhook secret is shown once, when it is
 * made: only a hash of a key is kept, so it cannot be shown again, only replaced.
 */

const EVENT_LABELS: Record<string, string> = {
  "document.created": "A document is made",
  "document.updated": "A document changes",
  "document.paid": "An invoice is paid in full",
  "customer.created": "A new customer is added",
  "expense.created": "A bill or expense is recorded"
};

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never");

function Secret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-warn/40 bg-warn/5 p-3">
      <p className="text-sm font-medium">{label}. Copy it now: it will not be shown again.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-sm">{value}</code>
        <button type="button" className="btn-ghost" onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); }}>
          {copied ? <><Check size={15} className="text-ok" />Copied</> : <><Copy size={15} />Copy</>}
        </button>
        <button type="button" className="btn-quiet" onClick={onClose} aria-label="I have kept it"><X size={15} /></button>
      </div>
    </div>
  );
}

export default function Integrations() {
  const [view, setView] = useState<IntegrationsView | null>(null);
  const [error, setError] = useState("");
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Record<string, Delivery[]>>({});
  const [tested, setTested] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!syncAvailable()) return;
    integrations().then((r) => (r.ok ? setView(r.data) : setError(r.status === 401 ? "Sign in to manage the API and webhooks." : r.error)));
  }, []);

  const run = async <T extends IntegrationsView>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>, after?: (d: T) => void) => {
    setBusy(true); setError("");
    const r = await p;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setView(r.data); after?.(r.data);
  };

  const showLog = async (id: string) => {
    const r = await webhookDeliveries(id);
    if (r.ok) setLog((l) => ({ ...l, [id]: r.data.deliveries }));
  };

  if (!syncAvailable()) return <p className="card p-6 text-ink-soft">The API needs accounts, which are not switched on for this copy of NXOne.</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl">API and webhooks</h1>
        <p className="mt-1 max-w-2xl text-ink-soft">
          Let your website, shop or CRM make invoices and add customers in NXOne, and be told the moment an invoice is
          paid. <Link href="/developers/" className="underline">Read the developer guide</Link>.
        </p>
      </header>

      {error ? <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</p> : null}
      {!view && !error ? <p className="flex items-center gap-2 text-ink-soft"><Loader2 size={16} className="animate-spin" />Loading</p> : null}

      {view && !view.allowed ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Part of the Business plan</h2>
          <p className="mt-1 text-sm text-ink-soft">You are on {view.plan}. The API and webhooks come with the Business plan, and with the free trial.</p>
          <Link href="/pricing/" className="btn-primary mt-3">See the plans</Link>
        </section>
      ) : null}

      {view?.allowed ? (
        <>
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg"><KeyRound size={18} />API keys</h2>
            <p className="mt-1 text-sm text-ink-soft">A key lets a program act for this business. Keep it on your server, never in a web page or an app people download.</p>
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
              {view.keys.length === 0 ? <li className="p-3 text-ink-soft">No keys yet.</li> : null}
              {view.keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span><strong>{k.name}</strong> <code className="text-ink-soft">{k.prefix}…</code></span>
                  <span className="flex items-center gap-3 text-ink-soft">
                    Last used {when(k.lastUsedAt)}
                    <button type="button" className="btn-quiet text-sm text-bad" disabled={busy}
                      onClick={() => { if (confirm(`Revoke "${k.name}"? Anything using it stops working at once.`)) void run(revokeApiKey(k.id)); }}>
                      <Trash2 size={14} />Revoke
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <input className="field max-w-xs" placeholder="What will use it, e.g. Website" value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={60} />
              <button type="button" className="btn-primary" disabled={busy || !keyName.trim()} onClick={() => void run(createApiKey(keyName), (d) => { setNewKey((d as IntegrationsView & { key: string }).key); setKeyName(""); })}>
                <Plus size={16} />Make a key
              </button>
            </div>
            {newKey ? <Secret label="Your new API key" value={newKey} onClose={() => setNewKey("")} /> : null}
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-display text-lg"><Webhook size={18} />Webhooks</h2>
            <p className="mt-1 text-sm text-ink-soft">
              NXOne sends a signed POST to your address when something happens, whether it was done in the app, on another device
              or through the API.
            </p>

            <ul className="mt-3 space-y-3">
              {view.webhooks.map((h) => (
                <li key={h.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all">{h.url}</code>
                    <span className="flex flex-wrap gap-2">
                      <button type="button" className="btn-ghost text-sm" onClick={async () => {
                        setTested((t) => ({ ...t, [h.id]: "Sending…" }));
                        const r = await testWebhook(h.id);
                        setTested((t) => ({ ...t, [h.id]: r.ok ? (r.data.ok ? `Delivered (${r.data.status})` : `Failed: ${r.data.error ?? r.data.status}`) : r.error }));
                        void showLog(h.id);
                      }}><Send size={14} />Send a test</button>
                      <button type="button" className="btn-quiet text-sm" onClick={() => void showLog(h.id)}>Recent deliveries</button>
                      <button type="button" className="btn-quiet text-sm text-bad" onClick={() => { if (confirm("Remove this webhook?")) void run(removeWebhook(h.id)); }}><Trash2 size={14} />Remove</button>
                    </span>
                  </div>
                  <p className="mt-1 text-ink-soft">{h.events.map((e) => EVENT_LABELS[e] ?? e).join(" · ")} · secret ends …{h.secretEnd}</p>
                  {tested[h.id] ? <p className="mt-1">{tested[h.id]}</p> : null}
                  {log[h.id] ? (
                    <ul className="mt-2 divide-y divide-line rounded border border-line">
                      {log[h.id].length === 0 ? <li className="p-2 text-ink-soft">Nothing sent yet.</li> : null}
                      {log[h.id].map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                          <span>{d.event} <span className="text-ink-faint">{when(d.createdAt)}</span></span>
                          <span className={d.ok ? "text-ok" : "text-bad"}>
                            {d.ok ? `Delivered (${d.status})` : `${d.error ?? "Not delivered"}, ${d.attempts} tr${d.attempts === 1 ? "y" : "ies"}`}
                            {!d.ok ? <button type="button" className="btn-quiet ml-2 text-sm" onClick={async () => { await redeliver(d.id); void showLog(h.id); }}><RotateCcw size={13} />Again</button> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-lg border border-line p-3">
              <label className="block text-sm">
                <span className="label">Address to send to</span>
                <input className="field" placeholder="https://yourshop.com/nxone-webhook" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} inputMode="url" />
              </label>
              <fieldset className="mt-3">
                <legend className="text-sm font-medium">Tell it when</legend>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  {view.events.map((e) => (
                    <label key={e} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={hookEvents.includes(e)} onChange={(ev) => setHookEvents((h) => (ev.target.checked ? [...h, e] : h.filter((x) => x !== e)))} />
                      {EVENT_LABELS[e] ?? e}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-faint">Tick none for all of them.</p>
              </fieldset>
              <button type="button" className="btn-primary mt-3" disabled={busy || !hookUrl.trim()}
                onClick={() => void run(addWebhook(hookUrl, hookEvents), (d) => { setNewSecret((d as IntegrationsView & { secret: string }).secret); setHookUrl(""); setHookEvents([]); })}>
                <Plus size={16} />Add webhook
              </button>
              {newSecret ? <Secret label="The signing secret for this webhook" value={newSecret} onClose={() => setNewSecret("")} /> : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
