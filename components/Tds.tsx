"use client";
import { AlertTriangle, CalendarClock, Download, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { TDS_CAVEAT, TDS_SECTIONS, financialYearOf, quarterOf, sectionById } from "@/lib/tds/sections";
import { form26q, form26qCsv, reviewYear } from "@/lib/tds/deduct";
import { TCS_CAVEAT, TCS_RULES } from "@/lib/tax/tcs";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Tax you are supposed to hold back from your suppliers.
 *
 * The expensive mistake is not the rate, it is the threshold: nothing is due on a contractor
 * until the year's payments pass ₹1,00,000, and then it is due on all of them, including the
 * ones already paid in full. So the warning about a supplier getting close matters as much as
 * the arithmetic about the ones who went past.
 */
export default function Tds() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [quarter, setQuarter] = useState(() => quarterOf(todayIso()).label);

  const payments = useMemo(() => db.expenses().map((e) => ({
    id: e.id, date: e.date, supplier: e.supplier, supplierPan: e.supplierPan,
    supplierType: e.supplierType, netMinor: e.netMinor, tdsMinor: e.tdsMinor, tdsSection: e.tdsSection
  })), [ws]);

  const review = useMemo(() => reviewYear(payments, todayIso()), [payments]);

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const currency = ws.profile?.currency ?? "INR";
  const country = ws.profile?.country ?? "IN";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const date = (iso: string) => formatDate(iso, country);
  const year = financialYearOf(todayIso());
  const pans = new Map(db.expenses().filter((e) => e.supplierPan).map((e) => [e.supplier, e.supplierPan!]));
  const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q) => `${q} ${year.label}`);
  const rows = form26q(review.deductions, quarter, pans);
  const due = quarterOf(`${year.from.slice(0, 4)}-${quarter.startsWith("Q1") ? "05" : quarter.startsWith("Q2") ? "08" : quarter.startsWith("Q3") ? "11" : "02"}-01`);

  const save = () => {
    const url = URL.createObjectURL(new Blob([form26qCsv(rows, quarter)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `26Q-${quarter.replace(/\s/g, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const nothing = review.deductions.length === 0;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label={`Due in ${year.label}`} value={money(review.totalDueMinor)} />
        <Figure label="Held back so far" value={money(review.totalDeductedMinor)} />
        <Figure label="Not held back" value={money(review.shortfallMinor)} tone={review.shortfallMinor > 0 ? "bad" : "ok"} />
      </section>

      {nothing ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Nothing marked for deduction yet</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Tax has to be held back from some payments - a contractor, a landlord, a professional -
            and handed to the government yourself. Mark the section on an expense and it is counted
            here, with the thresholds watched for you.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {TDS_SECTIONS.slice(0, 5).map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-2 border-t border-line pt-2">
                <span className="font-medium">{s.label}</span>
                <span className="text-ink-faint">{s.id}</span>
                <span className="ml-auto tabular text-ink-soft">
                  {(s.rate.other * 100).toFixed(s.rate.other < 0.01 ? 2 : 0)}% above{" "}
                  {money(s.threshold.singleMinor ?? s.threshold.aggregateMinor ?? 0)}
                  {s.threshold.basis === "monthly" ? " a month" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {review.missed.length > 0 ? (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-display text-lg">
            <AlertTriangle size={17} className="text-bad" aria-hidden="true" />Should have been held back
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            {money(review.shortfallMinor)} across {review.missed.length}{" "}
            {review.missed.length === 1 ? "payment" : "payments"}. Paying the supplier in full does
            not end it: the tax is still owed, with interest, and the expense can be disallowed -
            so you would pay tax on money you have already spent.
          </p>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
              <tr><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Supplier</th><th className="py-2 pr-4">Section</th><th className="py-2 pr-4 text-right">Should be</th><th className="py-2">Why</th></tr>
            </thead>
            <tbody>
              {review.missed.map((d) => (
                <tr key={d.paymentId} className="border-t border-line">
                  <td className="py-2 pr-4 tabular text-ink-soft">{date(d.date)}</td>
                  <td className="py-2 pr-4">{d.supplier}</td>
                  <td className="py-2 pr-4">{sectionById(d.sectionId)?.label ?? d.sectionId}</td>
                  <td className="py-2 pr-4 text-right tabular font-medium">{money(d.shouldBeMinor)}</td>
                  <td className="py-2 text-xs text-ink-soft">
                    {d.noPan ? "No PAN, so the higher rate applies. " : ""}
                    {d.becauseOfAggregate ? "The year's payments to this supplier crossed the limit, which catches earlier bills too." : `${(d.rate * 100).toFixed(d.rate < 0.01 ? 2 : 0)}% of the bill.`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {review.approaching.length > 0 ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Getting close to a threshold</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            Once a supplier goes past, the deduction applies to everything you have already paid
            them this year - not just the bill that crossed it. Easier to start deducting on the
            next one than to go back.
          </p>
          <ul className="mt-3 divide-y divide-line">
            {review.approaching.map((a) => (
              <li key={`${a.supplier}-${a.sectionId}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="font-medium">{a.supplier}</span>
                <span className="text-sm text-ink-soft">
                  {money(a.spentMinor)} of {money(a.thresholdMinor)} -{" "}
                  <span className="font-medium text-warn">{money(a.leftMinor)} left</span>{" "}
                  under {sectionById(a.sectionId)?.label}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {review.owed.length > 0 ? (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-display text-lg">
            <CalendarClock size={17} className="text-ink-faint" aria-hidden="true" />When it has to reach the government
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {review.owed.map((o) => (
              <li key={o.depositBy} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className={o.late ? "font-medium text-bad" : ""}>
                  By {date(o.depositBy)}{o.late ? " - overdue" : ""}
                </span>
                <span className="tabular font-medium">{money(o.minor)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-faint">
            Deducted tax is due by the seventh of the following month, except March, which has until 30 April.
          </p>
        </section>
      ) : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">Form 26Q</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Deductee by deductee, which is what whoever files it will ask you for. Due {date(due.dueOn)}.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">Quarter</span>
              <select className="field mt-1" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                {quarters.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </label>
            <button type="button" className="btn-ghost" onClick={save} disabled={rows.length === 0}>
              <Download size={16} /> CSV
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">Nothing was held back in {quarter}.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
              <tr><th className="py-2 pr-4">Deductee</th><th className="py-2 pr-4">PAN</th><th className="py-2 pr-4">Section</th><th className="py-2 pr-4 text-right">Paid</th><th className="py-2 text-right">Deducted</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.supplier}-${r.sectionId}`} className="border-t border-line">
                  <td className="py-2 pr-4">{r.supplier}</td>
                  <td className={`py-2 pr-4 ${r.pan ? "" : "font-medium text-warn"}`}>{r.pan || "not provided"}</td>
                  <td className="py-2 pr-4">{r.sectionId}{r.newCode ? <span className="block text-xs text-ink-faint">code {r.newCode}</span> : null}</td>
                  <td className="py-2 pr-4 text-right tabular">{money(r.paidMinor)}</td>
                  <td className="py-2 text-right tabular font-medium">{money(r.deductedMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-display text-lg">Tax you collect from customers</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          The other direction: added to a customer&apos;s bill, collected with it, and paid over.
          Most businesses never meet it - on ordinary goods it starts only once your turnover
          passes ₹10 crore and you have sold more than ₹50 lakh to one customer in a year. A scrap
          or timber dealer meets it from the first sale.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {TCS_RULES.map((rule) => (
            <li key={rule.id} className="flex flex-wrap gap-x-3 border-t border-line pt-2">
              <span className="font-medium">{rule.label}</span>
              <span className="tabular text-ink-soft">{(rule.rate * 100).toFixed(rule.rate < 0.01 ? 2 : 1)}%</span>
              <span className="w-full text-xs text-ink-faint">{rule.describes}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-faint">
          Where there is a threshold, it is charged only on the part above it - charging the whole
          amount is the usual mistake, and it overcharges the customer rather than the government.
        </p>
      </section>

      <p className="flex gap-2 rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{TDS_CAVEAT} {TCS_CAVEAT}
      </p>
    </div>
  );
}

function Figure({ label, value, tone = "plain" }: { label: string; value: string; tone?: "ok" | "bad" | "plain" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-1 font-display text-2xl tabular ${tone === "bad" ? "text-bad" : ""}`}>{value}</p>
    </div>
  );
}
