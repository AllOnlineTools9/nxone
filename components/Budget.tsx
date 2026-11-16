"use client";
import { Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { fromLastYear, reviewBudget, type BudgetLine } from "@/lib/analysis/budget";
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
 * The number worth showing is not the variance to date — that is history by the time anybody
 * reads it. It is the rate: at this pace, what will the year come to, and is that more than was
 * set aside. Knowing in July that one account is running at twice its rate is a decision;
 * knowing in March is a post-mortem.
 */
export default function Budget() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [editing, setEditing] = useState(false);

  const entries = useMemo(() => ledgerFor(
    db.documents(), db.expenses(), ws.profile?.currency ?? "INR",
    openingOf(ws.profile), { items: db.items() as StockItem[] },
    { list: db.assets().map(toAssetForBooks) }
  ), [db, ws.profile]);

  if (!ready || !ws.profile) return null;

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

  const startFromLastYear = () => {
    const draft = fromLastYear(entries, currency, todayIso());
    if (draft.length === 0) return;
    save(draft);
    setEditing(true);
  };

  const expenseAccounts = accountsOfType("expense");

  if (budgets.length === 0 && !editing) {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg">No budget set</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          A budget is only useful if it is checked while there is still time to act on it. Set a
          figure for the year against the accounts you care about, and this will tell you — in
          July, not in March — which of them are running faster than planned.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={startFromLastYear}>
            <Sparkles size={16} /> Start from what you spent last year
          </button>
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>Start from nothing</button>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Last year&apos;s figures are a first draft, not a target. Arguing with a number already on
          the page is easier than inventing one.
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
                    <td className="py-2 pr-4 text-right tabular text-ink-soft">{line ? money(line.expectedToDateMinor) : "—"}</td>
                    <td className="py-2 pr-4 text-right tabular">{line ? money(line.actualToDateMinor) : "—"}</td>
                    <td className={`py-2 text-right tabular ${
                      line?.outlook === "well-over" ? "font-semibold text-bad"
                        : line?.outlook === "over" ? "text-warn"
                          : line?.outlook === "under" ? "text-ink-soft" : ""
                    }`}>{line ? money(line.projectedMinor) : "—"}</td>
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
