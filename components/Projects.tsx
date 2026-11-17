"use client";
import { Plus, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { summarise } from "@/lib/analysis/projects";
import { formatMoney, fromMinor } from "@/lib/money";
import { todayIso } from "@/lib/format";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * What each job actually made.
 *
 * A business can be profitable overall and losing money on half of what it does, and the profit
 * and loss will never say so - it adds the good jobs to the bad ones and reports the difference.
 * The jobs are listed worst first, because the loss-making one is the only entry anybody needs
 * to act on.
 */
export default function Projects() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", client: "", quoted: 0 });

  const projects = useMemo(() => db.projects(), [db]);

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const currency = ws.profile?.currency ?? "INR";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const summary = summarise(projects, db.documents(), db.expenses(), money);

  const add = () => {
    if (!form.name.trim()) return;
    store.saveProject({
      name: form.name.trim(),
      client: form.client.trim() || undefined,
      quotedMinor: form.quoted ? Math.round(form.quoted * 100) : undefined,
      startedOn: todayIso(),
      status: "open",
      version: 1
    });
    setForm({ name: "", client: "", quoted: 0 });
    setAdding(false);
  };

  const clients = [...new Set(db.documents().map((d) => d.clientName).filter(Boolean))];

  return (
    <div className="space-y-6">
      {projects.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <Figure label="Earned on contracts" value={money(summary.revenueMinor)} />
          <Figure label="Spent on them" value={money(summary.costMinor)} />
          <Figure label="Left" value={money(summary.profitMinor)} tone={summary.profitMinor < 0 ? "bad" : "plain"} />
        </section>
      ) : null}

      {summary.losing.length > 0 ? (
        <section className="rounded-lg border border-bad/30 bg-bad/5 p-4">
          <h2 className="flex items-center gap-2 font-medium text-bad">
            <TriangleAlert size={17} aria-hidden="true" />
            {summary.losing.length === 1 ? "A contract is losing money" : `${summary.losing.length} contracts are losing money`}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.losing.map((r) => <li key={r.project.id}>{r.project.name} - {r.says}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">Contracts</h2>
          <button type="button" className="btn-ghost" onClick={() => setAdding(!adding)}>
            <Plus size={16} /> Add a contract
          </button>
        </div>

        {adding ? (
          <div className="mt-4 grid gap-4 rounded-lg border border-line bg-canvas p-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="pj-name">What is it</label>
              <input id="pj-name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Shop rebrand" />
            </div>
            <div>
              <label className="label" htmlFor="pj-client">For whom</label>
              <input id="pj-client" className="field" list="pj-clients" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
              <datalist id="pj-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="label" htmlFor="pj-quoted">Quoted price</label>
              <input id="pj-quoted" type="number" className="field" value={form.quoted || ""} onChange={(e) => setForm({ ...form, quoted: Number(e.target.value) })} placeholder="optional" />
            </div>
            <div className="sm:col-span-3">
              <button type="button" className="btn-primary" onClick={add} disabled={!form.name.trim()}>Add it</button>
              <button type="button" className="btn-quiet ml-2" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : null}

        {projects.length === 0 ? (
          <p className="mt-4 max-w-2xl text-sm text-ink-soft">
            No contracts yet. Add one, then tag invoices and bills to it as they come in - the tagging
            is a dropdown on each. After a few of them this will tell you which kind of work is
            worth doing and which only looks like it is.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="py-2 pr-4">Contract</th>
                  <th className="py-2 pr-4 text-right">Earned</th>
                  <th className="py-2 pr-4 text-right">Cost</th>
                  <th className="py-2 pr-4 text-right">Left</th>
                  <th className="py-2 pr-4 text-right">Margin</th>
                  <th className="py-2">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {summary.results.map((r) => (
                  <tr key={r.project.id} className="border-t border-line">
                    <td className="py-2 pr-4">
                      {r.project.name}
                      <span className="block text-xs text-ink-faint">
                        {r.project.client ?? "no client"} · {r.invoices} invoiced, {r.bills} billed
                        {r.collectedMinor < r.revenueMinor ? ` · ${money(r.revenueMinor - r.collectedMinor)} still owed` : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right tabular">{money(r.revenueMinor)}</td>
                    <td className="py-2 pr-4 text-right tabular text-ink-soft">{money(r.costMinor)}</td>
                    <td className={`py-2 pr-4 text-right tabular font-medium ${r.profitMinor < 0 ? "text-bad" : ""}`}>{money(r.profitMinor)}</td>
                    <td className={`py-2 pr-4 text-right tabular ${r.marginPercent < 10 ? "text-warn" : ""}`}>
                      {r.revenueMinor === 0 ? "-" : `${r.marginPercent.toFixed(0)}%`}
                    </td>
                    <td className="py-2 text-right">
                      <select
                        className="field py-1 text-xs"
                        value={r.project.status}
                        onChange={(e) => { const saved = projects.find((p) => p.id === r.project.id); if (saved) store.saveProject({ ...saved, status: e.target.value as "open" | "done" | "abandoned" }); }}
                        aria-label={`Status of ${r.project.name}`}
                      >
                        <option value="open">Open</option>
                        <option value="done">Done</option>
                        <option value="abandoned">Abandoned</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {projects.length > 0 && (summary.untaggedRevenueMinor > 0 || summary.untaggedCostMinor > 0) ? (
        <p className="rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">
          {money(summary.untaggedRevenueMinor)} earned and {money(summary.untaggedCostMinor)} spent
          are not against any contract. Some of that is overheads, which belong nowhere; the rest is
          tagging that was not kept up, and it makes every margin above look better than it is.
        </p>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone = "plain" }: { label: string; value: string; tone?: "bad" | "plain" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-1 font-display text-2xl tabular ${tone === "bad" ? "text-bad" : ""}`}>{value}</p>
    </div>
  );
}
