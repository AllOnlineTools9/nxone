"use client";
import { AlertTriangle, Package, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { todayIso } from "@/lib/format";
import { decimalsFor, formatMoney, fromMinor } from "@/lib/money";
import { keepingStock, marginOn, stockFrom, STOCK_ACCOUNT, type StockItem } from "@/lib/stock/ledger";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * What is on the shelf.
 *
 * A shop that buys to sell cannot read its profit from its bank balance: stock bought in March
 * and sold in May is an asset until it sells. Switching an item on here is what makes the
 * accounts treat it that way - purchases become stock, and the cost appears in the month the
 * thing actually left the shop.
 *
 * Sales are read from the invoices rather than entered again, because asking somebody to record
 * the same sale twice is asking them to disagree with themselves.
 */
export default function Stock() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [showAll, setShowAll] = useState(false);

  const currency = ws.profile?.currency ?? "INR";
  const unit = 10 ** decimalsFor(currency);
  const items = (ready ? db.items() : []) as StockItem[];

  const position = useMemo(
    () => stockFrom({ items, documents: ready ? db.documents() : [], expenses: ready ? db.expenses() : [], from: todayIso().slice(0, 8) + "01" }),
    [ws, items, ready]
  );

  if (!ready) return <div className="h-72 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const m = (minor: number) => formatMoney(fromMinor(minor, currency), "en-IN");
  const tracked = items.filter((i) => i.tracked);
  const untracked = items.filter((i) => !i.tracked);

  const track = (item: StockItem, on: boolean) => {
    db.saveItem({ ...item, tracked: on });
  };

  const setField = (item: StockItem, patch: Partial<StockItem>) => {
    db.saveItem({ ...item, ...patch });
  };

  if (!keepingStock(items)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Stock</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">
            For anything you buy to sell on. Switch an item on here and it stops being a cost the month you buy it and becomes one the month it sells, which is the only way a monthly profit figure means anything in a shop.
          </p>
        </div>

        {items.length ? (
          <section className="card p-5">
            <h2 className="font-display text-lg">Which of these do you keep on a shelf?</h2>
            <p className="mt-0.5 text-sm text-ink-soft">Services and one-off work never need this. Goods do.</p>
            <ul className="mt-4 divide-y divide-line">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm">{item.description}</span>
                  <button type="button" className="btn-quiet text-sm" onClick={() => track(item, true)}>Keep count</button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="card p-6 text-center">
            <Package size={28} className="mx-auto text-ink-faint" aria-hidden="true" />
            <h2 className="mt-3 font-display text-lg">Nothing in your catalogue yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
              Things you sell are saved as you invoice them. Make an invoice with the goods on it, and the ones you keep on a shelf can be counted here.
            </p>
            <Link href="/invoice-generator/" className="btn-primary mt-4">Make an invoice</Link>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Stock</h1>
        <p className="mt-1 max-w-2xl text-ink-soft">
          Counted from your own bills and invoices. Everything on the shelf is worth {m(position.closingValueMinor)} at what it cost you.
        </p>
      </div>

      {position.shortages.length ? (
        <div className="rounded-xl border border-bad/30 bg-bad/5 p-4">
          <div className="flex gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden="true" />
            <div>
              <p className="font-medium">You have sold more than you bought</p>
              <p className="mt-0.5 text-sm text-ink-soft">
                {position.shortages.map((s) => s.description).join(", ")} went out of the door without a matching purchase. Usually a bill has not been recorded, and until it is, the cost of those sales is missing from your profit.
              </p>
              <Link href="/expenses/" className="mt-2 inline-block text-sm font-medium underline">Record a purchase</Link>
            </div>
          </div>
        </div>
      ) : null}

      {position.lowStock.length ? (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-4">
          <p className="font-medium">Running low</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            {position.lowStock.map((l) => `${l.description} (${l.quantity} left)`).join(", ")}
          </p>
        </div>
      ) : null}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
          <h2 className="font-display text-lg">On the shelf</h2>
          <p className="text-sm text-ink-soft">Cost of what sold this month: {m(position.costOfSalesMinor)}</p>
        </div>

        <table className="mt-3 w-full border-collapse text-sm">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Item</th>
              <th className="px-5 py-2.5 text-right font-semibold">On hand</th>
              <th className="px-5 py-2.5 text-right font-semibold">Cost each</th>
              <th className="px-5 py-2.5 text-right font-semibold">Worth</th>
              <th className="px-5 py-2.5 text-right font-semibold">Margin at your price</th>
              <th className="px-5 py-2.5 text-right font-semibold">Tell me at</th>
            </tr>
          </thead>
          <tbody>
            {position.levels.map((level) => {
              const item = tracked.find((i) => i.id === level.itemId);
              const margin = item ? marginOn(level, Math.round(item.rate * unit)) : undefined;
              return (
                <tr key={level.itemId} className="border-t border-line">
                  <td className="px-5 py-2.5">
                    {level.description}
                    {level.unit ? <span className="text-ink-faint"> / {level.unit}</span> : null}
                    {item ? (
                      <input
                        className="field mt-1 block w-40 py-1 text-xs" placeholder="Barcode" defaultValue={item.barcode ?? ""}
                        aria-label={`Barcode for ${level.description}`}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (item.barcode ?? "")) setField(item, { barcode: v || undefined }); }}
                      />
                    ) : null}
                  </td>
                  <td className={`px-5 py-2.5 text-right tabular ${level.quantity < 0 ? "text-bad" : ""}`}>{level.quantity}</td>
                  <td className="px-5 py-2.5 text-right tabular text-ink-soft">{level.averageCostMinor ? m(level.averageCostMinor) : "-"}</td>
                  <td className="px-5 py-2.5 text-right tabular">{m(level.valueMinor)}</td>
                  <td className={`px-5 py-2.5 text-right tabular ${margin && margin.marginMinor < 0 ? "text-bad" : "text-ink-soft"}`}>
                    {margin && level.averageCostMinor ? `${m(margin.marginMinor)}${margin.marginPercent === null ? "" : ` · ${margin.marginPercent}%`}` : "-"}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <input
                      type="number" className="field w-20 tabular text-right" value={level.reorderLevel ?? ""}
                      aria-label={`Warn me when ${level.description} falls to`}
                      onChange={(e) => item && setField(item, { reorderLevel: e.target.value === "" ? undefined : Number(e.target.value) })}
                    />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-line font-semibold">
              <td className="px-5 py-3" colSpan={3}>Everything on the shelf</td>
              <td className="px-5 py-3 text-right tabular">{m(position.closingValueMinor)}</td>
              <td className="px-5 py-3" colSpan={2} />
            </tr>
          </tbody>
        </table>

        <p className="border-t border-line px-5 py-3 text-xs text-ink-soft">
          Record a purchase as a bill filed under <strong>Stock</strong>, with how many arrived, and it lands here. Sales come from your invoices, matched by code where there is one and by name otherwise.
        </p>
      </section>

      {untracked.length ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg">Not being counted</h2>
            <button type="button" className="btn-quiet text-sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Hide" : `Show ${untracked.length}`}
            </button>
          </div>
          {showAll ? (
            <ul className="mt-3 divide-y divide-line">
              {untracked.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span>{item.description}</span>
                  <button type="button" className="btn-quiet text-sm" onClick={() => track(item, true)}><Plus size={14} /> Keep count</button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <p className="text-sm text-ink-faint">
        Cost is the weighted average: every delivery re-averages what the shelf is worth and every sale leaves at that average. It is one of the two methods the accounting standards allow, and the one you can check by hand. Purchases sit in account {STOCK_ACCOUNT} as an asset until they sell.
      </p>
    </div>
  );
}
