"use client";
import { Download, Info, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import {
  COMPOSITION_CAVEAT, COMPOSITION_EXCLUSIONS, COMPOSITION_RATES,
  cmp08, compositionQuarter, compositionRate, outgrown
} from "@/lib/returns/composition";
import { rcmSummary } from "@/lib/returns/rcm";
import { financialYearOf } from "@/lib/tds/sections";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * The composition scheme.
 *
 * Two jobs: let a business say it is on the scheme, which changes what its invoices are allowed
 * to do, and produce the quarterly return once it has. The scheme is a smaller bargain — a
 * percentage of turnover instead of tax on each sale — and the things it gives up are listed
 * plainly rather than left to be discovered by a customer asking for credit they cannot have.
 */
export default function Composition() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [quarterAt, setQuarterAt] = useState(() => todayIso().slice(0, 7));

  const documents = useMemo(() => db.documents(), [db]);

  if (!ready || !ws.profile) return null;

  const currency = ws.profile.currency ?? "INR";
  const country = ws.profile.country ?? "IN";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const date = (iso: string) => formatDate(iso, country);
  const scheme = ws.profile.gstScheme ?? "regular";
  const on = scheme === "composition";

  const quarter = compositionQuarter(`${quarterAt}-15`);
  const reverse = rcmSummary(
    db.expenses().map((e) => ({ id: e.id, date: e.date, supplier: e.supplier, netMinor: e.netMinor, rcmCategory: e.rcmCategory, rcmRate: e.rcmRate })),
    quarter.from, quarter.to
  );

  const ret = cmp08({
    documents: documents.map((d) => ({ issueDate: d.issueDate, totalMinor: d.totalMinor, status: d.status, kind: d.kind, deletedAt: d.deletedAt })),
    reverseChargeMinor: reverse.owedMinor,
    rateId: ws.profile.compositionRate,
    from: quarter.from, to: quarter.to, quarter: quarter.label
  });

  const fy = financialYearOf(todayIso());
  const yearTurnover = documents
    .filter((d) => !d.deletedAt && d.status !== "cancelled" && d.status !== "draft" && (d.kind === "invoice" || d.kind === "receipt") && d.issueDate >= fy.from && d.issueDate <= fy.to)
    .reduce((sum, d) => sum + d.totalMinor, 0);
  const rate = compositionRate(ws.profile.compositionRate);
  const headroom = outgrown(yearTurnover, rate.id === "services" ? "services" : "goods");

  const setScheme = (next: "regular" | "composition" | "unregistered") =>
    store.saveProfile({ ...ws.profile!, gstScheme: next });

  const saveCsv = () => {
    const rows = [
      ["Quarter", ret.quarter], ["From", ret.from], ["To", ret.to],
      ["Turnover", (ret.turnoverMinor / 100).toFixed(2)],
      ["Rate", `${(ret.rate * 100).toFixed(1)}%`],
      ["CGST", (ret.cgstMinor / 100).toFixed(2)],
      ["SGST", (ret.sgstMinor / 100).toFixed(2)],
      ["Reverse charge", (ret.reverseChargeMinor / 100).toFixed(2)],
      ["Total payable", (ret.totalMinor / 100).toFixed(2)]
    ];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n") + "\n"], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `CMP-08-${ret.quarter.replace(/\s/g, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="font-display text-lg">Which GST scheme you are on</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Everything else in the GST screens assumes ordinary registration. If you are on the
          composition scheme, say so here — it changes what your invoices are allowed to do.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ["regular", "Ordinary registration"],
            ["composition", "Composition scheme"],
            ["unregistered", "Not registered for GST"]
          ] as const).map(([value, label]) => (
            <button
              key={value} type="button"
              className={scheme === value ? "btn-primary" : "btn-ghost"}
              onClick={() => setScheme(value)}
            >{label}</button>
          ))}
        </div>

        {on ? (
          <div className="mt-4">
            <label className="label" htmlFor="comp-rate">What the business does</label>
            <select
              id="comp-rate" className="field max-w-sm" value={ws.profile.compositionRate ?? "trader"}
              onChange={(e) => store.saveProfile({ ...ws.profile!, compositionRate: e.target.value })}
            >
              {COMPOSITION_RATES.map((r) => (
                <option key={r.id} value={r.id}>{r.label} — {(r.rate * 100).toFixed(0)}% of turnover</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-faint">{rate.describes}</p>
          </div>
        ) : null}
      </section>

      {!on ? (
        <p className="rounded-lg border border-line bg-canvas p-4 text-sm text-ink-soft">
          You are on {scheme === "regular" ? "ordinary registration" : "no GST registration"}, so the
          quarterly return below does not apply. It appears once the scheme is set to composition.
        </p>
      ) : (
        <>
          {headroom.says ? (
            <p className={`flex gap-2 rounded-lg border p-3 text-sm ${headroom.over ? "border-bad/30 bg-bad/5 text-bad" : "border-warn/30 bg-warn/5 text-warn"}`}>
              <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {headroom.says} Turnover this year is {money(yearTurnover)} against a limit of {money(headroom.limitMinor)}.
              </span>
            </p>
          ) : null}

          <section className="card p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-lg">CMP-08 for {ret.quarter}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {date(ret.from)} to {date(ret.to)}, due {date(quarter.dueOn)}.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">A month in the quarter</span>
                  <input type="month" className="field mt-1" value={quarterAt} onChange={(e) => setQuarterAt(e.target.value)} />
                </label>
                <button type="button" className="btn-ghost" onClick={saveCsv}><Download size={16} /> CSV</button>
              </div>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-4">
              <Figure label="Turnover" value={money(ret.turnoverMinor)} />
              <Figure label={`Tax at ${(ret.rate * 100).toFixed(0)}%`} value={money(ret.cgstMinor + ret.sgstMinor)} />
              <Figure label="Reverse charge" value={money(ret.reverseChargeMinor)} />
              <Figure label="To pay" value={money(ret.totalMinor)} />
            </dl>

            <p className="mt-3 text-xs text-ink-faint">
              CGST {money(ret.cgstMinor)} and SGST {money(ret.sgstMinor)}, which is how it is actually paid.
            </p>

            <ul className="mt-4 space-y-1 text-sm text-ink-soft">
              {ret.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </section>

          <section className="card p-5">
            <h2 className="font-display text-lg">What this scheme gives up</h2>
            <ul className="mt-3 divide-y divide-line">
              {COMPOSITION_EXCLUSIONS.map((e) => (
                <li key={e.what} className="py-2.5">
                  <span className="font-medium">{e.what}</span>
                  <span className="block text-sm text-ink-soft">{e.why}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <p className="flex gap-2 rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{COMPOSITION_CAVEAT}
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-1 font-display text-2xl tabular">{value}</dd>
    </div>
  );
}
