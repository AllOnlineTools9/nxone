"use client";
import { Info, Package, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ASSET_CAVEAT, ASSET_CLASSES, WORTH_CAPITALISING_MINOR, classById } from "@/lib/assets/rates";
import { blockSchedule, booksSchedule, disposalOf, registerAt } from "@/lib/assets/depreciate";
import { toAssetForBooks } from "@/lib/ledger/posting";
import { financialYearOf } from "@/lib/tds/sections";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * The things the business owns.
 *
 * A laptop bought outright is not a cost in the month it was bought; it is a cost spread over
 * the years it is used. Treating it as a cost on the day makes this year look worse than it was
 * and the next three look better, and it is the adjustment an accountant has to make by hand at
 * the end of every year.
 *
 * Two columns of figures, deliberately: the books spread the cost over the life of the thing,
 * and the tax computation writes down a pool at a fixed rate. They are meant to differ, and the
 * screen says so rather than leaving somebody to wonder which one is wrong.
 */
export default function Assets() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "", classId: "computers", purchasedOn: todayIso(), cost: 0, salvage: 0, paidFrom: "1020"
  });
  const [selling, setSelling] = useState<string | null>(null);
  const [sale, setSale] = useState({ on: todayIso(), amount: 0 });

  const assets = useMemo(() => db.assets(), [ws]);

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const currency = ws.profile?.currency ?? "INR";
  const country = ws.profile?.country ?? "IN";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const date = (iso: string) => formatDate(iso, country);
  const today = todayIso();

  const register = registerAt(assets.map(toAssetForBooks), today);
  const owned = register.filter((r) => !r.gone);
  const totalCost = owned.reduce((sum, r) => sum + r.costMinor, 0);
  const totalWorth = owned.reduce((sum, r) => sum + r.carryingMinor, 0);

  const thisYear = financialYearOf(today);
  const years = [thisYear.label];
  const blocks = blockSchedule(assets.map(toAssetForBooks), years);

  // A bill large enough and durable enough that it probably should not have been a cost.
  const maybeAssets = db.expenses().filter((e) =>
    e.netMinor >= WORTH_CAPITALISING_MINOR &&
    !assets.some((a) => a.expenseId === e.id) &&
    ["6100", "6040", "6080"].includes(e.category)
  );

  const save = () => {
    if (!form.name.trim() || !form.cost) return;
    store.saveAsset({
      name: form.name.trim(), classId: form.classId, purchasedOn: form.purchasedOn,
      costMinor: Math.round(form.cost * 100), salvageMinor: Math.round(form.salvage * 100) || undefined,
      currency, version: 1
    });
    setForm({ ...form, name: "", cost: 0, salvage: 0 });
    setAdding(false);
  };

  const sell = (id: string) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return;
    store.saveAsset({ ...asset, disposedOn: sale.on, disposalMinor: Math.round(sale.amount * 100) });
    setSelling(null);
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label="What it all cost" value={money(totalCost)} />
        <Figure label="What it is worth now" value={money(totalWorth)} />
        <Figure label="Worn down so far" value={money(totalCost - totalWorth)} />
      </section>

      {maybeAssets.length > 0 ? (
        <section className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <h2 className="font-medium text-warn">
            {maybeAssets.length === 1 ? "A bill that might be an asset" : `${maybeAssets.length} bills that might be assets`}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            These were recorded as costs, but they are large and the kind of thing that lasts
            years. Charged in full to the month they were bought, they make that month look far
            worse than it was.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {maybeAssets.slice(0, 5).map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line/60 pt-1.5">
                <span>{e.supplier}{e.description ? ` - ${e.description}` : ""}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular text-ink-soft">{money(e.netMinor)}</span>
                  <button
                    type="button" className="btn-quiet text-sm"
                    onClick={() => {
                      setForm({ ...form, name: e.description || e.supplier, purchasedOn: e.date, cost: e.netMinor / 100 });
                      setAdding(true);
                    }}
                  >Treat as an asset</button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-faint">
            Recording it here keeps the bill where it is and spreads the cost - it is not counted twice.
          </p>
        </section>
      ) : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">What you own</h2>
          <button type="button" className="btn-ghost" onClick={() => setAdding(!adding)}>
            <Plus size={16} /> Add something
          </button>
        </div>

        {adding ? (
          <div className="mt-4 grid gap-4 rounded-lg border border-line bg-canvas p-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="as-name">What is it</label>
              <input id="as-name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="MacBook Pro" />
            </div>
            <div>
              <label className="label" htmlFor="as-class">What kind</label>
              <select id="as-class" className="field" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                {ASSET_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-faint">{classById(form.classId)?.describes}</p>
            </div>
            <div>
              <label className="label" htmlFor="as-date">Bought on</label>
              <input id="as-date" type="date" className="field" value={form.purchasedOn} onChange={(e) => setForm({ ...form, purchasedOn: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="as-cost">What it cost</label>
              <input id="as-cost" type="number" className="field" value={form.cost || ""} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} />
              <p className="mt-1 text-xs text-ink-faint">
                Before tax. The GST on it is reclaimed the usual way.
              </p>
            </div>
            <div className="sm:col-span-2">
              <button type="button" className="btn-primary" onClick={save} disabled={!form.name.trim() || !form.cost}>Add it</button>
              <button type="button" className="btn-quiet ml-2" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : null}

        {register.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">
            Nothing recorded yet. A laptop, a van, the fit-out of a shop - anything you will still
            be using in two years belongs here rather than in a single month&apos;s costs.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="py-2 pr-4">What</th><th className="py-2 pr-4">Bought</th>
                  <th className="py-2 pr-4 text-right">Cost</th>
                  <th className="py-2 pr-4 text-right">Worn down</th>
                  <th className="py-2 pr-4 text-right">Worth now</th>
                  <th className="py-2">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {register.map((row) => (
                  <tr key={row.asset.id} className={`border-t border-line ${row.gone ? "text-ink-faint" : ""}`}>
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2">
                        <Package size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
                        <span>
                          {row.asset.name}
                          <span className="block text-xs text-ink-faint">
                            {row.assetClass?.label}
                            {row.gone ? ` · sold ${date(row.asset.disposedOn!)}` : ` · ${booksSchedule(row.asset, today).length} of ${row.asset.usefulLifeYears ?? row.assetClass?.usefulLifeYears} years`}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="py-2 pr-4 tabular text-ink-soft">{date(row.asset.purchasedOn)}</td>
                    <td className="py-2 pr-4 text-right tabular">{money(row.costMinor)}</td>
                    <td className="py-2 pr-4 text-right tabular text-ink-soft">{money(row.depreciatedMinor)}</td>
                    <td className="py-2 pr-4 text-right tabular font-medium">{row.gone ? "-" : money(row.carryingMinor)}</td>
                    <td className="py-2">
                      <span className="flex justify-end gap-1">
                        {!row.gone ? (
                          <button type="button" className="btn-quiet text-sm" onClick={() => { setSelling(row.asset.id); setSale({ on: today, amount: 0 }); }}>Sold it</button>
                        ) : null}
                        <button
                          type="button" className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-bad"
                          aria-label={`Remove ${row.asset.name}`}
                          onClick={() => { if (confirm(`Remove ${row.asset.name} from the register?`)) store.deleteAsset(row.asset.id); }}
                        ><Trash2 size={15} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selling ? (
          <div className="mt-4 rounded-lg border border-line bg-canvas p-4">
            <p className="text-sm font-medium">What happened to {assets.find((a) => a.id === selling)?.name}?</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">On</span>
                <input type="date" className="field mt-1" value={sale.on} onChange={(e) => setSale({ ...sale, on: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">Sold for</span>
                <input type="number" className="field mt-1" value={sale.amount || ""} onChange={(e) => setSale({ ...sale, amount: Number(e.target.value) })} placeholder="0 if scrapped" />
              </label>
              <button type="button" className="btn-primary" onClick={() => sell(selling)}>Record it</button>
              <button type="button" className="btn-quiet" onClick={() => setSelling(null)}>Cancel</button>
            </div>
            {(() => {
              const asset = assets.find((a) => a.id === selling);
              if (!asset) return null;
              const result = disposalOf(
                { ...toAssetForBooks(asset), disposedOn: sale.on, disposalMinor: Math.round(sale.amount * 100) },
                money
              );
              return result ? <p className="mt-3 text-sm text-ink-soft">{result.describes}</p> : null;
            })()}
          </div>
        ) : null}
      </section>

      {blocks.length > 0 ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">The same things, for tax</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            The tax computation does not use the figures above. It pools assets into blocks and
            writes each block down at its own rate - and anything bought with fewer than 180 days
            left in the year gets half that rate. The two answers differ on purpose.
          </p>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
              <tr>
                <th className="py-2 pr-4">Block</th><th className="py-2 pr-4 text-right">Rate</th>
                <th className="py-2 pr-4 text-right">Opening</th><th className="py-2 pr-4 text-right">Added</th>
                <th className="py-2 pr-4 text-right">Half rate</th><th className="py-2 pr-4 text-right">Sold</th>
                <th className="py-2 pr-4 text-right">Depreciation</th><th className="py-2 text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={`${b.block}-${b.year}`} className="border-t border-line">
                  <td className="py-2 pr-4">{b.block}</td>
                  <td className="py-2 pr-4 text-right tabular">{(b.rate * 100).toFixed(0)}%</td>
                  <td className="py-2 pr-4 text-right tabular text-ink-soft">{money(b.openingMinor)}</td>
                  <td className="py-2 pr-4 text-right tabular">{money(b.additionsFullRateMinor)}</td>
                  <td className="py-2 pr-4 text-right tabular">{b.additionsHalfRateMinor ? money(b.additionsHalfRateMinor) : "-"}</td>
                  <td className="py-2 pr-4 text-right tabular">{b.disposalsMinor ? money(b.disposalsMinor) : "-"}</td>
                  <td className="py-2 pr-4 text-right tabular font-medium">{money(b.depreciationMinor)}</td>
                  <td className="py-2 text-right tabular">{money(b.closingMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <p className="flex gap-2 rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{ASSET_CAVEAT}
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-2xl tabular">{value}</p>
    </div>
  );
}
