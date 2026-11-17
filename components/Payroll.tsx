"use client";
import { AlertTriangle, Download, Plus, Trash2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { todayIso } from "@/lib/format";
import { postPayroll } from "@/lib/ledger/posting";
import { decimalsFor, formatMoney, fromMinor } from "@/lib/money";
import { ecrFor, payRun, type Employee } from "@/lib/payroll/run";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";
import type { SavedEmployee } from "@/lib/store/types";
import RateNeeded from "./RateNeeded";

/**
 * The payroll.
 *
 * The calendar has been telling employers for months that provident fund is due on the 15th. This
 * is the part that says how much. Everything on a payslip traces to a dated rule, and the two
 * things the arithmetic cannot know - a professional tax slab we do not hold, a tax declaration
 * nobody has made - are shown as questions rather than filled in with a nil.
 */

const BLANK: Omit<Employee, "id"> = {
  name: "", joined: todayIso(), basicMinor: 0, hraMinor: 0, otherAllowancesMinor: 0,
  region: "", pf: { enrolled: true }, esi: { enrolled: true }
};

export default function Payroll() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Omit<Employee, "id"> & { id?: string }>({ ...BLANK });

  const currency = ws.profile?.currency ?? "INR";
  const unit = 10 ** decimalsFor(currency);
  const staff = ready ? db.employees() : [];
  const run = useMemo(() => payRun(staff as Employee[], month), [staff, month]);

  if (!ready) return <div className="h-72 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const m = (minor: number) => formatMoney(fromMinor(minor, currency), "en-IN");
  const major = (minor: number) => (minor ? String(minor / unit) : "");
  const toMinor = (value: string) => Math.round((Number(value) || 0) * unit);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    if (!form.name.trim() || !form.basicMinor) return;
    db.saveEmployee({ ...form, name: form.name.trim(), id: form.id } as Omit<SavedEmployee, "createdAt" | "updatedAt">);
    setForm({ ...BLANK });
    setAdding(false);
  };

  const download = (name: string, body: string, type = "text/plain") => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const record = () => {
    db.savePayRun(month, run, new Date().toISOString());
  };

  const recorded = db.payruns().find((r) => r.month === month);

  return (
    <div className="space-y-8">
      <RateNeeded />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Payroll</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">
            What each person is paid, what is held back, and what has to reach the fund and the department by when.
          </p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Month</span>
          <input type="month" className="field w-44 tabular" value={month} onChange={(e) => setMonth(e.target.value || month)} />
        </label>
      </div>

      {/* ---- the people ---- */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <h2 className="font-display text-lg">On the payroll</h2>
          <button type="button" className="btn-ghost" onClick={() => { setForm({ ...BLANK }); setAdding(!adding); }}>
            <UserPlus size={16} /> Add somebody
          </button>
        </div>

        {staff.length ? (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead className="bg-canvas text-left">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Name</th>
                <th className="px-5 py-2.5 font-semibold">State</th>
                <th className="px-5 py-2.5 text-right font-semibold">Basic</th>
                <th className="px-5 py-2.5 text-right font-semibold">Gross a month</th>
                <th className="px-5 py-2.5 font-semibold">In</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {staff.map((person) => (
                <tr key={person.id} className="border-t border-line">
                  <td className="px-5 py-2.5">
                    <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => { setForm({ ...person }); setAdding(true); }}>
                      {person.name}
                    </button>
                    {person.left ? <span className="ml-2 text-xs text-ink-faint">left {person.left}</span> : null}
                  </td>
                  <td className="px-5 py-2.5 text-ink-soft">{person.region || "-"}</td>
                  <td className="px-5 py-2.5 text-right tabular">{m(person.basicMinor)}</td>
                  <td className="px-5 py-2.5 text-right tabular">
                    {m(person.basicMinor + (person.daMinor ?? 0) + (person.hraMinor ?? 0) + (person.otherAllowancesMinor ?? 0))}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-ink-soft">
                    {[person.pf?.enrolled && "PF", person.esi?.enrolled && "ESI"].filter(Boolean).join(", ") || "Neither"}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-bad"
                      aria-label={`Remove ${person.name}`} onClick={() => db.deleteEmployee(person.id)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-soft">Nobody yet. Add the people you pay and the month works itself out.</p>
        )}

        {adding ? (
          <div className="border-t border-line bg-canvas/50 p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="label" htmlFor="pr-name">Name</label><input id="pr-name" className="field" value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
              <div><label className="label" htmlFor="pr-code">Payroll number</label><input id="pr-code" className="field" value={form.code ?? ""} onChange={(e) => set({ code: e.target.value })} /></div>
              <div><label className="label" htmlFor="pr-joined">Joined</label><input id="pr-joined" type="date" className="field" value={form.joined} onChange={(e) => set({ joined: e.target.value })} /></div>
              <div><label className="label" htmlFor="pr-region">State</label><input id="pr-region" className="field uppercase" placeholder="KA" value={form.region ?? ""} onChange={(e) => set({ region: e.target.value.toUpperCase().slice(0, 3) })} /></div>

              <div><label className="label" htmlFor="pr-basic">Basic</label><input id="pr-basic" type="number" className="field tabular" value={major(form.basicMinor)} onChange={(e) => set({ basicMinor: toMinor(e.target.value) })} /></div>
              <div><label className="label" htmlFor="pr-da">Dearness allowance</label><input id="pr-da" type="number" className="field tabular" value={major(form.daMinor ?? 0)} onChange={(e) => set({ daMinor: toMinor(e.target.value) })} /></div>
              <div><label className="label" htmlFor="pr-hra">House rent allowance</label><input id="pr-hra" type="number" className="field tabular" value={major(form.hraMinor ?? 0)} onChange={(e) => set({ hraMinor: toMinor(e.target.value) })} /></div>
              <div><label className="label" htmlFor="pr-other">Other allowances</label><input id="pr-other" type="number" className="field tabular" value={major(form.otherAllowancesMinor ?? 0)} onChange={(e) => set({ otherAllowancesMinor: toMinor(e.target.value) })} /></div>

              <div><label className="label" htmlFor="pr-uan">Provident fund number</label><input id="pr-uan" className="field tabular" value={form.pf?.uan ?? ""} onChange={(e) => set({ pf: { ...form.pf, enrolled: form.pf?.enrolled ?? true, uan: e.target.value } })} /></div>
              <div><label className="label" htmlFor="pr-pan">PAN</label><input id="pr-pan" className="field uppercase" value={form.pan ?? ""} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} /></div>
              <div className="flex items-end gap-4 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.pf?.enrolled ?? false} onChange={(e) => set({ pf: { ...form.pf, enrolled: e.target.checked } })} /> Provident fund</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.esi?.enrolled ?? false} onChange={(e) => set({ esi: { ...form.esi, enrolled: e.target.checked } })} /> Employee insurance</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.pf?.capAtCeiling === false} onChange={(e) => set({ pf: { ...form.pf, enrolled: form.pf?.enrolled ?? true, capAtCeiling: e.target.checked ? false : undefined } })} /> Contribute on the full wage</label>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" className="btn-primary" onClick={save} disabled={!form.name.trim() || !form.basicMinor}><Plus size={16} /> Save</button>
              <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
      </section>

      {run.payslips.length ? (
        <>
          {/* ---- what it comes to ---- */}
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
              <div>
                <h2 className="font-display text-lg">{run.label}</h2>
                <p className="text-sm text-ink-soft">{run.totals.employees} on the payroll, costing {m(run.totals.costMinor)} all in.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-ghost" onClick={() => download(`ECR-${month}.txt`, ecrFor(run, staff as Employee[]))}>
                  <Download size={16} /> Provident fund file
                </button>
                <button type="button" className="btn-primary" onClick={record} disabled={Boolean(recorded)}>
                  {recorded ? "Recorded" : "Record this month"}
                </button>
              </div>
            </div>

            <table className="mt-3 w-full border-collapse text-sm">
              <thead className="bg-canvas text-left">
                <tr>
                  <th className="px-5 py-2.5 font-semibold">Person</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Gross</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Fund</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Insurance</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Tax</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody>
                {run.payslips.map((slip) => {
                  const find = (label: string) => slip.deductions.find((d) => d.label === label)?.amountMinor ?? 0;
                  return (
                    <tr key={slip.employeeId} className="border-t border-line">
                      <td className="px-5 py-2.5">
                        {slip.name}
                        {slip.paidDays < slip.monthDays ? <span className="ml-2 text-xs text-ink-faint">{slip.paidDays} of {slip.monthDays} days</span> : null}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular">{m(slip.grossMinor)}</td>
                      <td className="px-5 py-2.5 text-right tabular text-ink-soft">{find("Provident fund") ? m(find("Provident fund")) : "-"}</td>
                      <td className="px-5 py-2.5 text-right tabular text-ink-soft">{find("Employee insurance") ? m(find("Employee insurance")) : "-"}</td>
                      <td className="px-5 py-2.5 text-right tabular text-ink-soft">
                        {find("Tax deducted at source") + find("Professional tax") ? m(find("Tax deducted at source") + find("Professional tax")) : "-"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular font-medium">{m(slip.netMinor)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-line font-semibold">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3 text-right tabular">{m(run.totals.grossMinor)}</td>
                  <td className="px-5 py-3 text-right tabular">{m(run.totals.employeePfMinor)}</td>
                  <td className="px-5 py-3 text-right tabular">{m(run.totals.employeeEsiMinor)}</td>
                  <td className="px-5 py-3 text-right tabular">{m(run.totals.taxDeductedMinor + run.totals.professionalTaxMinor)}</td>
                  <td className="px-5 py-3 text-right tabular">{m(run.totals.netMinor)}</td>
                </tr>
              </tbody>
            </table>

            <p className="border-t border-line px-5 py-3 text-xs text-ink-soft">
              The business also pays {m(run.totals.costMinor - run.totals.grossMinor)} on top of these salaries, in provident fund, pension, insurance and administration. That is the real cost of the month and it is in your accounts as one.
            </p>
          </section>

          {/* ---- what has to be paid ---- */}
          {run.challans.length ? (
            <section className="card p-5">
              <h2 className="font-display text-lg">What has to be paid, and when</h2>
              <ul className="mt-3 divide-y divide-line">
                {run.challans.map((challan) => (
                  <li key={challan.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                    <span>
                      <span className="font-medium">{challan.name}</span>
                      <span className="block text-xs text-ink-soft">{challan.detail}</span>
                    </span>
                    <span className="text-right">
                      <span className="block tabular font-medium">{m(challan.amountMinor)}</span>
                      <span className="block text-xs text-ink-soft">by {challan.dueOn}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {run.unanswered.length ? (
            <section className="rounded-xl border border-warn/40 bg-warn/5 p-4">
              <div className="flex gap-2.5">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
                <div>
                  <p className="font-medium">Things the rules here cannot settle</p>
                  <ul className="mt-1 space-y-1 text-sm text-ink-soft">
                    {run.unanswered.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}

          <p className="text-sm text-ink-faint">
            Tax deducted is an estimate on this salary running unchanged to the end of the year, under the regime set for each person. It is not advice, and each person&apos;s own return is where it settles.
          </p>
        </>
      ) : null}
    </div>
  );
}
