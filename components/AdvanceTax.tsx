"use client";
import { CalendarClock, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { ADVANCE_TAX_CAVEAT, RATES, advanceTaxYear, nextDue, taxOnProfit, type TaxpayerKind } from "@/lib/tax/advance";
import { profitAndLoss } from "@/lib/ledger/statements";
import { ledgerFor, toAssetForBooks } from "@/lib/ledger/posting";
import { openingOf } from "@/lib/ledger/opening";
import type { StockItem } from "@/lib/stock/ledger";
import { financialYearOf } from "@/lib/tds/sections";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Paying the year's tax in four goes, before the year ends.
 *
 * Nobody sends a bill for this, so the dates pass unnoticed and interest runs from each one. The
 * screen exists to say two things on time: roughly what the year will owe, and when the next
 * instalment falls. Both come from figures the books already hold.
 */
export default function AdvanceTax() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [stated, setStated] = useState<string>("");
  const [kind, setKind] = useState<TaxpayerKind>("individual");

  const entries = useMemo(() => ledgerFor(
    db.documents(), db.expenses(), ws.profile?.currency ?? "INR",
    openingOf(ws.profile), { items: db.items() as StockItem[] },
    { list: db.assets().map(toAssetForBooks) }
  ), [db, ws.profile]);

  if (!ready || !ws.profile) return null;

  const currency = ws.profile.currency ?? "INR";
  const country = ws.profile.country ?? "IN";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const date = (iso: string) => formatDate(iso, country);
  const today = todayIso();
  const fy = financialYearOf(today);

  const pl = profitAndLoss(entries, currency, fy.from, today);
  const year = advanceTaxYear({
    profitSoFarMinor: pl.netProfit.minor,
    statedProfitMinor: stated.trim() ? Math.round(Number(stated) * 100) : undefined,
    kind,
    today,
    payments: (ws.profile.advanceTaxPaid ?? []).filter((p) => p.date >= fy.from && p.date <= fy.to)
  });

  const next = nextDue(year, today);
  const short = year.instalments.filter((i) => i.state === "short");
  const breakdown = taxOnProfit(year.estimatedProfitMinor, kind);

  const recordPayment = (amountMinor: number) => {
    const existing = ws.profile?.advanceTaxPaid ?? [];
    store.saveProfile({ ...ws.profile!, advanceTaxPaid: [...existing, { date: today, amountMinor }] });
  };

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-lg">What {fy.label} looks like owing</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">{year.basis}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">You are</span>
              <select className="field mt-1" value={kind} onChange={(e) => setKind(e.target.value as TaxpayerKind)}>
                {RATES.map((r) => <option key={r.kind} value={r.kind}>{r.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">Profit for the year</span>
              <input
                type="number" className="field mt-1 w-44" value={stated}
                onChange={(e) => setStated(e.target.value)}
                placeholder={String(Math.round(year.estimatedProfitMinor / 100))}
              />
            </label>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-4">
          <Figure label="Profit expected" value={money(year.estimatedProfitMinor)} />
          <Figure label="Tax on it" value={money(year.estimatedTaxMinor)} />
          <Figure label="Paid so far" value={money(year.paidMinor)} />
          <Figure
            label={year.interestMinor > 0 ? "Interest running" : "Still to pay"}
            value={money(year.interestMinor > 0 ? year.interestMinor : Math.max(0, year.payableMinor - year.paidMinor))}
            tone={year.interestMinor > 0 ? "bad" : "plain"}
          />
        </dl>

        <p className="mt-3 text-xs text-ink-faint">
          {breakdown.surchargeMinor > 0 ? `Tax ${money(breakdown.taxMinor)}, surcharge ${money(breakdown.surchargeMinor)}, cess ${money(breakdown.cessMinor)}. ` : `Tax ${money(breakdown.taxMinor)} plus cess ${money(breakdown.cessMinor)}. `}
          That is {(breakdown.effectiveRate * 100).toFixed(1)}% of the profit.
        </p>
      </section>

      {!year.required ? (
        <p className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm text-ok">
          <CheckCircle2 size={16} aria-hidden="true" />{year.notes[0]}
        </p>
      ) : (
        <>
          {next ? (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 font-display text-lg">
                <CalendarClock size={17} className="text-ink-faint" aria-hidden="true" />Next, by {date(next.dueOn)}
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                {money(next.shortfallMinor)} to bring you up to {Math.round(next.cumulative * 100)}% of the year&apos;s tax.
              </p>
              <button type="button" className="btn-ghost mt-3" onClick={() => recordPayment(next.shortfallMinor)}>
                I have paid {money(next.shortfallMinor)}
              </button>
            </section>
          ) : null}

          {short.length > 0 ? (
            <section className="rounded-lg border border-bad/30 bg-bad/5 p-4">
              <h2 className="flex items-center gap-2 font-medium text-bad">
                <TriangleAlert size={17} aria-hidden="true" />
                {short.length === 1 ? "An instalment was missed" : `${short.length} instalments were missed`}
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Interest of about {money(year.interestMinor)} is running. Paying the whole year&apos;s tax
                later does not stop it — the interest is for the quarters it should have been paid in.
              </p>
            </section>
          ) : null}

          <section className="card p-5">
            <h2 className="font-display text-lg">The four dates</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="py-2 pr-4">Due</th><th className="py-2 pr-4">By then</th>
                  <th className="py-2 pr-4 text-right">Should have paid</th>
                  <th className="py-2 pr-4 text-right">Paid</th>
                  <th className="py-2 text-right">Short</th>
                </tr>
              </thead>
              <tbody>
                {year.instalments.map((i) => (
                  <tr key={i.dueOn} className="border-t border-line">
                    <td className="py-2 pr-4 tabular">{date(i.dueOn)}</td>
                    <td className="py-2 pr-4 text-ink-soft">{Math.round(i.cumulative * 100)}%</td>
                    <td className="py-2 pr-4 text-right tabular">{money(i.shouldHavePaidMinor)}</td>
                    <td className="py-2 pr-4 text-right tabular text-ink-soft">{money(i.paidByMinor)}</td>
                    <td className={`py-2 text-right tabular ${i.state === "short" ? "font-semibold text-bad" : i.state === "due" ? "text-warn" : "text-ok"}`}>
                      {i.shortfallMinor === 0 ? (i.state === "ahead" ? "ahead" : "settled") : money(i.shortfallMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {year.notes.length > 0 && year.required ? (
        <ul className="space-y-1 text-sm text-ink-soft">
          {year.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      ) : null}

      <p className="flex gap-2 rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{ADVANCE_TAX_CAVEAT}
      </p>
    </div>
  );
}

function Figure({ label, value, tone = "plain" }: { label: string; value: string; tone?: "bad" | "plain" }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className={`mt-1 font-display text-2xl tabular ${tone === "bad" ? "text-bad" : ""}`}>{value}</dd>
    </div>
  );
}
