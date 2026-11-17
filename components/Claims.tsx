"use client";
import { Check, Plus, Wallet, X } from "lucide-react";
import { useMemo, useState } from "react";
import { canMove, nextStep, summariseClaims, type Claim, type ClaimState } from "@/lib/payroll/claims";
import { EXPENSE_CATEGORIES } from "@/lib/ledger/accounts";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Money your people spent that you owe them back.
 *
 * A claim is a cost like any other, but the money left somebody's own pocket - so until it is
 * repaid the business owes them, and the person who is out of pocket is the one keeping count.
 * The figure that matters here is not the total claimed, it is how long somebody has been
 * waiting.
 */
export default function Claims() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    employeeId: "", spentOn: todayIso(), description: "", category: "6030", amount: 0
  });

  const employees = useMemo(() => db.employees(), [db]);
  const claims = useMemo(() => ws.profile?.claims ?? [], [ws.profile]);

  if (!ready || !ws.profile) return null;

  const currency = ws.profile.currency ?? "INR";
  const country = ws.profile.country ?? "IN";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const date = (iso: string) => formatDate(iso, country);
  const today = todayIso();
  const summary = summariseClaims(claims, today);

  const save = (next: Claim[]) => store.saveProfile({ ...ws.profile!, claims: next });

  const add = () => {
    const who = employees.find((e) => e.id === form.employeeId);
    if (!who || !form.amount || !form.description.trim()) return;
    const claim: Claim = {
      id: `cl_${Math.random().toString(36).slice(2, 9)}`,
      employeeId: who.id, employeeName: who.name,
      spentOn: form.spentOn, description: form.description.trim(),
      category: form.category, amountMinor: Math.round(form.amount * 100), currency,
      state: "submitted", submittedOn: today
    };
    save([...claims, claim]);
    setForm({ ...form, description: "", amount: 0 });
    setAdding(false);
  };

  const move = (claim: Claim, to: ClaimState) => {
    const verdict = canMove(claim.state, to);
    if (!verdict.allowed) return;
    save(claims.map((c) => c.id === claim.id
      ? { ...c, state: to, decidedOn: to === "approved" || to === "rejected" ? today : c.decidedOn, paidOn: to === "paid" ? today : c.paidOn }
      : c));

    // Once repaid, it is a cost like any other and belongs in the books.
    if (to === "paid") {
      store.saveExpense({
        date: claim.spentOn, supplier: claim.employeeName, description: claim.description,
        category: claim.category, currency: claim.currency, netMinor: claim.amountMinor,
        taxMinor: 0, paidFrom: "1020", reference: `Claim ${claim.id}`, version: 1
      } as never);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label="Waiting on you" value={String(summary.waiting.length)} />
        <Figure label="Owed to your people" value={money(summary.owedMinor)} tone={summary.owedMinor > 0 ? "warn" : "plain"} />
        <Figure label="Repaid this year" value={money(summary.paidThisYearMinor)} />
      </section>

      {summary.owedBy.some((p) => p.oldestDays > 30) ? (
        <section className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <h2 className="flex items-center gap-2 font-medium text-warn">
            <Wallet size={17} aria-hidden="true" />Somebody has been waiting a while
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.owedBy.filter((p) => p.oldestDays > 30).map((p) => (
              <li key={p.employeeId}>
                {p.employeeName} is {money(p.minor)} out of pocket, the oldest from {p.oldestDays} days ago.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">Claims</h2>
          <button type="button" className="btn-ghost" onClick={() => setAdding(!adding)} disabled={employees.length === 0}>
            <Plus size={16} /> Add a claim
          </button>
        </div>

        {employees.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            Add somebody in Payroll first - a claim has to be owed to a person.
          </p>
        ) : null}

        {adding ? (
          <div className="mt-4 grid gap-4 rounded-lg border border-line bg-canvas p-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cl-who">Who paid</label>
              <select id="cl-who" className="field" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">Choose</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cl-when">When</label>
              <input id="cl-when" type="date" className="field" value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="cl-what">What for</label>
              <input id="cl-what" className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Train to Pune" />
            </div>
            <div>
              <label className="label" htmlFor="cl-amount">How much</label>
              <input id="cl-amount" type="number" className="field" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label" htmlFor="cl-cat">Which account</label>
              <select id="cl-cat" className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <button type="button" className="btn-primary" onClick={add} disabled={!form.employeeId || !form.amount}>Add it</button>
              <button type="button" className="btn-quiet ml-2" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : null}

        {claims.length === 0 ? (
          <p className="mt-4 max-w-2xl text-sm text-ink-soft">
            Nothing claimed yet. A claim is dated the day the money was spent, not the day it is
            approved - so a September lunch stays a September cost however long it waits.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {[...claims].sort((a, b) => b.spentOn.localeCompare(a.spentOn)).map((claim) => (
              <li key={claim.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">{claim.description}</span>
                  <span className="block text-xs text-ink-faint">
                    {claim.employeeName} · {date(claim.spentOn)} · {nextStep(claim, today)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular font-medium">{money(claim.amountMinor)}</span>
                  {claim.state === "submitted" ? (
                    <>
                      <button type="button" className="btn-quiet text-sm" onClick={() => move(claim, "approved")}>
                        <Check size={14} /> Approve
                      </button>
                      <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-bad"
                        aria-label={`Turn down ${claim.description}`} onClick={() => move(claim, "rejected")}>
                        <X size={15} />
                      </button>
                    </>
                  ) : claim.state === "approved" ? (
                    <button type="button" className="btn-ghost text-sm" onClick={() => move(claim, "paid")}>Repay it</button>
                  ) : (
                    <span className="text-xs text-ink-faint">{claim.state}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value, tone = "plain" }: { label: string; value: string; tone?: "warn" | "plain" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-1 font-display text-2xl tabular ${tone === "warn" ? "text-warn" : ""}`}>{value}</p>
    </div>
  );
}
