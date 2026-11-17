"use client";
import { CheckCircle2, CircleAlert, Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { readyToClose, yearEnd, yearStarting, yearsWithActivity } from "@/lib/books/yearend";
import { ledgerFor, toAssetForBooks } from "@/lib/ledger/posting";
import { openingOf } from "@/lib/ledger/opening";
import type { StockItem } from "@/lib/stock/ledger";
import { financialYearOf } from "@/lib/tds/sections";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Finishing a year.
 *
 * Nothing here is a stored balance, so closing a year is not arithmetic - it is somebody looking
 * at the year, satisfying themselves it is complete, and saying so. The useful part is therefore
 * the list of things that are usually wrong when somebody thinks a year is finished, not the
 * closing figures, which the books could produce at any time.
 */
export default function YearEnd() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [chosen, setChosen] = useState<string | undefined>();
  const [closed, setClosed] = useState(false);

  const years = useMemo(() => yearsWithActivity(db.documents(), db.expenses()), [db]);

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

  // The year just gone by default: the one somebody is most likely closing.
  const thisYear = financialYearOf(todayIso()).label;
  const label = chosen ?? years.find((y) => y !== thisYear) ?? years[0] ?? thisYear;
  const anyDate = `${yearStarting(label).slice(0, 4)}-06-01`;

  const closing = yearEnd(entries, currency, anyDate);
  const verdict = readyToClose({
    documents: db.documents(), expenses: db.expenses(), entries, currency,
    anyDateInYear: anyDate, assets: db.assets(), lockedUpTo: ws.profile.lockedUpTo
  });

  const close = () => {
    store.saveProfile({ ...ws.profile!, lockedUpTo: closing.to });
    setClosed(true);
  };

  const stops = verdict.checks.filter((c) => c.severity === "stop");
  const looks = verdict.checks.filter((c) => c.severity === "look");

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">Finishing {label}</h2>
            <p className="mt-1 text-sm text-ink-soft">{date(closing.from)} to {date(closing.to)}</p>
          </div>
          {years.length > 1 ? (
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">Year</span>
              <select className="field mt-1" value={label} onChange={(e) => { setChosen(e.target.value); setClosed(false); }}>
                {years.map((y) => <option key={y} value={y}>{y}{y === thisYear ? " - still running" : ""}</option>)}
              </select>
            </label>
          ) : null}
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <Figure label={`Made in ${label}`} value={money(closing.profit.minor)} />
          <Figure label="Kept from earlier years" value={money(closing.broughtForward.minor)} />
          <Figure label="Carried into next year" value={money(closing.carriedForward.minor)} />
        </dl>

        {!closing.balanced ? (
          <p className="mt-4 flex gap-2 rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            The balance sheet does not balance at {date(closing.to)}. Closing on that carries the problem into next year.
          </p>
        ) : null}
      </section>

      <section className="card p-5">
        <h2 className="font-display text-lg">Before you close it</h2>
        {verdict.checks.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-ok">
            <CheckCircle2 size={16} aria-hidden="true" /> Nothing looks out of place in {label}.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {[...stops, ...looks].map((check) => (
              <li key={check.id} className={`rounded-lg border p-3 ${check.severity === "stop" ? "border-bad/30 bg-bad/5" : "border-line bg-canvas"}`}>
                <p className={`flex items-center gap-2 font-medium ${check.severity === "stop" ? "text-bad" : ""}`}>
                  {check.severity === "stop" ? <TriangleAlert size={15} aria-hidden="true" /> : <CircleAlert size={15} className="text-ink-faint" aria-hidden="true" />}
                  {check.title}
                </p>
                <p className="mt-1 text-sm text-ink-soft">{check.says}</p>
                {check.fixAt ? <Link href={check.fixAt} className="mt-1 inline-block text-sm underline">Go and look</Link> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-display text-lg">What next year opens on</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Income and expenses start again at nothing. What you own and owe carries over, and this
          year&apos;s profit joins what was kept from earlier years.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
            <tr><th className="py-2 pr-4">Account</th><th className="py-2 pr-4">Kind</th><th className="py-2 text-right">At {date(closing.to)}</th></tr>
          </thead>
          <tbody>
            {closing.opening.map((row) => (
              <tr key={row.code} className="border-t border-line">
                <td className="py-2 pr-4">{row.name}<span className="ml-2 text-xs text-ink-faint">{row.code}</span></td>
                <td className="py-2 pr-4 text-ink-soft">{row.type}</td>
                <td className="py-2 text-right tabular">{money(row.minor)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line font-semibold">
              <td className="py-2 pr-4" colSpan={2}>Profit carried forward</td>
              <td className="py-2 text-right tabular">{money(closing.carriedForward.minor)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <Lock size={17} className="text-ink-faint" aria-hidden="true" />Close it
        </h2>
        {closed ? (
          <p className="mt-2 text-sm text-ok">
            {label} is closed. Everything dated on or before {date(closing.to)} is fixed; corrections
            from here are credit notes and adjustments dated today.
          </p>
        ) : (
          <>
            <p className="mt-1 max-w-3xl text-sm text-ink-soft">
              Closing locks the books to {date(closing.to)}. Nothing dated inside the year can be
              edited, deleted or paid into afterwards - which is what keeps the year you filed on
              and the year in your books the same year.
            </p>
            <button type="button" className="btn-primary mt-3" onClick={close} disabled={!verdict.clear}>
              {verdict.clear ? `Close ${label}` : `Fix ${stops.length} thing${stops.length === 1 ? "" : "s"} first`}
            </button>
            {!verdict.clear ? (
              <p className="mt-2 text-xs text-ink-faint">
                Only the things marked above stop a close. The rest are worth a look but will not hold you up.
              </p>
            ) : null}
          </>
        )}
      </section>
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
