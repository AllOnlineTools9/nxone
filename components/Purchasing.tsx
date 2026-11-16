"use client";
import { ClipboardList, Copy, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { committedMinor, matchOrders, possibleDuplicates, type BillState } from "@/lib/purchasing/match";
import { formatDate } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Orders against bills.
 *
 * Two things live here because they are the same habit: checking that what arrived is what was
 * agreed. Being billed above an order is the one that costs money quietly, and a bill entered
 * twice is the one that costs money invisibly — the books balance either way, the supplier is
 * simply better off.
 */

const LABELS: Record<BillState, { title: string; tone: "ok" | "warn" | "bad" | "plain" }> = {
  "over-billed": { title: "Billed above the order", tone: "bad" },
  "part-billed": { title: "Part billed", tone: "warn" },
  "not-billed": { title: "Nothing billed yet", tone: "plain" },
  billed: { title: "Agreed", tone: "ok" }
};

export default function Purchasing() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();

  const currency = ws.profile?.currency ?? "INR";
  const country = ws.profile?.country ?? "IN";
  const money = useMemo(() => (minor: number) => formatMoney(fromMinor(minor, currency)), [currency]);

  const matches = useMemo(() => matchOrders(db.documents(), db.expenses(), money), [db, money]);
  const duplicates = useMemo(() => possibleDuplicates(db.expenses(), money), [db, money]);

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const date = (iso: string) => formatDate(iso, country);
  const committed = committedMinor(matches);
  const overBilled = matches.filter((m) => m.state === "over-billed");

  return (
    <div className="space-y-6">
      {duplicates.length > 0 ? (
        <section className="card border-bad/30 bg-bad/5 p-5">
          <h2 className="flex items-center gap-2 font-display text-lg text-bad">
            <Copy size={17} aria-hidden="true" />
            {duplicates.length === 1 ? "A bill looks like it was entered twice" : `${duplicates.length} bills look like they were entered twice`}
          </h2>
          <ul className="mt-3 space-y-3">
            {duplicates.map((d) => (
              <li key={`${d.supplier}-${d.reference}`} className="border-t border-bad/20 pt-3">
                <p className="text-sm">{d.says}</p>
                <ul className="mt-1 text-xs text-ink-soft">
                  {d.bills.map((b) => <li key={b.id} className="tabular">{date(b.date)} · {money(b.amountMinor)}</li>)}
                </ul>
              </li>
            ))}
          </ul>
          <Link href="/expenses" className="mt-3 inline-block text-sm underline">Go and look at the bills</Link>
        </section>
      ) : null}

      {matches.length === 0 ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Orders and bills</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            No purchase orders yet. An order is a promise to pay for a particular thing at a
            particular price; once there is one, the bill that turns up later can be checked
            against it rather than taken on trust.
          </p>
          <Link href="/purchase-order-generator" className="btn-ghost mt-3 inline-flex">
            <ClipboardList size={16} /> Raise one
          </Link>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <Figure label="Orders open" value={String(matches.filter((m) => m.state !== "billed").length)} />
            <Figure label="Committed, not yet billed" value={money(committed)} />
            <Figure label="Billed above the order" value={money(overBilled.reduce((s, m) => s + -m.outstandingMinor, 0))} tone={overBilled.length ? "bad" : "ok"} />
          </section>

          <section className="card p-5">
            <h2 className="font-display text-lg">What you ordered, and what came back</h2>
            <ul className="mt-3 divide-y divide-line">
              {matches.map((m) => {
                const label = LABELS[m.state];
                return (
                  <li key={m.orderId} className="py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        <span className="font-medium">{m.number}</span>
                        <span className="ml-2 text-ink-soft">{m.supplier}</span>
                        <span className="ml-2 text-xs text-ink-faint">{date(m.issuedOn)}</span>
                      </span>
                      <span className="flex items-center gap-3 text-sm">
                        <span className="tabular text-ink-soft">{money(m.orderedMinor)} ordered</span>
                        <span className="tabular">{money(m.billedMinor)} billed</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          label.tone === "bad" ? "bg-bad/10 text-bad" : label.tone === "warn" ? "bg-warn/10 text-warn" : label.tone === "ok" ? "bg-ok/10 text-ok" : "bg-canvas text-ink-soft"
                        }`}>{label.title}</span>
                      </span>
                    </div>

                    {m.advice ? (
                      <p className={`mt-1.5 flex gap-2 text-sm ${m.state === "over-billed" ? "text-bad" : "text-ink-soft"}`}>
                        {m.state === "over-billed" ? <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : null}
                        {m.advice}
                      </p>
                    ) : null}

                    {m.bills.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 text-xs text-ink-faint">
                        {m.bills.map((b) => (
                          <li key={b.id} className="tabular">
                            {date(b.date)} · {b.reference ?? "no bill number"} · {money(b.amountMinor)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
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
