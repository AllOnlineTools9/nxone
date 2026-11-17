"use client";
import { Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { firstDraft, reviewBudget, type BudgetLine } from "@/lib/analysis/budget";
import Link from "next/link";
import { ledgerFor, toAssetForBooks } from "@/lib/ledger/posting";
import { openingOf } from "@/lib/ledger/opening";
import { accountsOfType } from "@/lib/ledger/accounts";
import type { StockItem } from "@/lib/stock/ledger";
import { todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * What you meant to spend, against what you did.
 *
 * The number worth showing is not the variance to date - that is history by the time anybody
 * reads it. It is the rate: at this pace, what will the year come to, and is that more than was
 * set aside. Knowing in July that one account is running at twice its rate is a decision;
 * knowing in March is a post-mortem.
 */
export default function Budget() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [editing, setEditing] = useState(false);
  /** Said once a draft is made, so nobody mistakes a projection for last year's figures. */
  const [drafted, setDrafted] = useState("");

  const entries = useMemo(() => ledgerFor(
    db.documents(), db.expenses(), ws.profile?.currency ?? "INR",
    openingOf(ws.profile), { items: db.items() as StockItem[] },
    { list: db.assets().map(toAssetForBooks) }
  ), [db, ws.profile]);

  if (!ready) return null;

  // Without a business there is nothing to budget for, but a blank page reads as broken.
  if (!ws.profile) {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg">Set up your business first</h2>
        <p className="mt-1 text-sm text-ink-soft">A budget is set against your own accounts, so it needs your business details first.</p>
        <Link href="/welcome/" className="btn-primary mt-3 inline-flex">Set up your business</Link>
      </section>
    );
  }

  const currency = ws.profile.currency ?? "INR";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const budgets = ws.profile.budgets ?? [];
  const review = reviewBudget({ budgets, entries, currency, today: todayIso() });

  const save = (lines: BudgetLine[]) =>
    store.saveProfile({ ...ws.profile!, budgets: lines.filter((l) => l.yearMinor > 0) });

  const setLine = (code: string, yearMinor: number) => {
    const rest = budgets.filter((b) => b.code !== code);
    save(yearMinor > 0 ? [...rest, { code, yearMinor }] : rest);
  };

  // This used to do nothing at all for a business with no last year, which is every new one:
  // the button was pressed and the page did not change. Now it falls back to this year, and
  // failing that opens a blank budget, and in every case says which it did.
  const startFromHistory = () => {
    const draft = firstDraft(entries, currency, todayIso());
    if (draft.lines.length > 0) save(draft.lines);
    setDrafted(
      draft.source === "last-year"
        ? "Filled in from what you actually spent last year. Change anything that will be different this year."
        : draft.source === "this-year"
          ? "There is no last year to copy, so this is what you have spent so far this year, scaled up to a full year. Treat it as a first guess."
          : "Nothing has been spent yet to start from, so here is a blank budget. Put a figure against the accounts you care about."
    );
    setEditing(true);
  };

  const expenseAccounts = accountsOfType("expense");

  if (budgets.length === 0 && !editing) {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg">No budget set</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          A budget is only useful if it is checked while there is still time to act on it. Set a
          figure for the year against the accounts you care about, and this will tell you - in
          July, not in March - which of them are running faster than planned.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={startFromHistory}>
            <Sparkles size={16} /> Start from what you have spent
          </button>
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>Start from nothing</button>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Uses last year if there is one, otherwise this year so far. Either way it is a first
          draft, not a target: arguing with a number already on the page is easier than inventing one.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label={`Budget for ${review.year}`} value={money(review.totalBudgetMinor)} />
        <Figure label={`Spent (${Math.round(review.elapsed * 100)}% of the year gone)`} value={money(review.totalActualMinor)} />
        <Figure
          label="Heading for"
          value={money(review.totalProjectedMinor)}
          tone={review.totalProjectedMinor > review.totalBudgetMinor * 1.05 ? "bad" : "plain"}
        />
      </section>

      {review.attention.length > 0 ? (
        <section className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <h2 className="flex items-center gap-2 font-medium text-warn">
            <TriangleAlert size={17} aria-hidden="true" />
            {review.attention.length === 1 ? "One account is running ahead" : `${review.attention.length} accounts are running ahead`}
          </h2>
          <ul className="mt-2 space-y-2 text-sm">
            {review.attention.map((line) => (
              <li key={line.code} className="border-t border-warn/20 pt-2">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{line.name}</span>
                  <span className="tabular text-ink-soft">
                    {money(line.projectedMinor)} against {money(line.yearMinor)}
                  </span>
                </span>
                {line.says ? <span className="mt-0.5 block text-ink-soft">{line.says}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {drafted ? (
        <p className="rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">{drafted}</p>
      ) : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">Account by account</h2>
          <button type="button" className="btn-quiet" onClick={() => setEditing(!editing)}>
            {editing ? "Done" : "Change the figures"}
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
              <tr>
                <th className="py-2 pr-4">Account</th>
                <th className="py-2 pr-4 text-right">Year&apos;s budget</th>
                <th className="py-2 pr-4 text-right">Due by now</th>
                <th className="py-2 pr-4 text-right">Spent</th>
                <th className="py-2 text-right">Heading for</th>
              </tr>
            </thead>
            <tbody>
              {(editing ? expenseAccounts.map((a) => ({ code: a.code, name: a.name })) : review.lines.map((l) => ({ code: l.code, name: l.name }))).map((account: { code: string; name: string }) => {
                const line = review.lines.find((l) => l.code === account.code);
                const budget = budgets.find((b) => b.code === account.code);
                return (
                  <tr key={account.code} className="border-t border-line">
                    <td className="py-2 pr-4">{account.name}<span className="ml-2 text-xs text-ink-faint">{account.code}</span></td>
                    <td className="py-2 pr-4 text-right">
                      {editing ? (
                        <input
                          type="number" className="field w-32 text-right"
                          value={budget ? budget.yearMinor / 100 : ""}
                          onChange={(e) => setLine(account.code, Math.round(Number(e.target.value) * 100))}
                          placeholder="0"
                        />
                      ) : <span className="tabular">{money(line?.yearMinor ?? 0)}</span>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular text-ink-soft">{line ? money(line.expectedToDateMinor) : "-"}</td>
                    <td className="py-2 pr-4 text-right tabular">{line ? money(line.actualToDateMinor) : "-"}</td>
                    <td className={`py-2 text-right tabular ${
                      line?.outlook === "well-over" ? "font-semibold text-bad"
                        : line?.outlook === "over" ? "text-warn"
                          : line?.outlook === "under" ? "text-ink-soft" : ""
                    }`}>{line ? money(line.projectedMinor) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editing ? (
          <p className="mt-3 text-xs text-ink-faint">
            Figures are for the whole year. Leave an account at nothing to keep it out of the budget.
          </p>
        ) : null}
      </section>
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
