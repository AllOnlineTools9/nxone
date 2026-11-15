"use client";
import { Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { baselineFrom, enoughToSimulate } from "@/lib/analysis/baseline";
import { affordableFixedCostMinor, describeChange, presetsFor, simulate, type Baseline, type Change, type ChangeKind } from "@/lib/analysis/scenario";
import { todayIso } from "@/lib/format";
import { decimalsFor, formatMoney, fromMinor } from "@/lib/money";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";
import Link from "next/link";

/**
 * Trying a change before you make it.
 *
 * The figures start from the books and can be corrected, because a typical month is a judgement
 * the owner makes better than an average does. Only the changes are saved, so a scenario opened
 * next quarter runs against next quarter's figures.
 */

const HORIZONS = [6, 12, 24] as const;

const KINDS: Array<{ kind: ChangeKind; label: string; field: "amount" | "percent"; fieldLabel: string; staged: boolean }> = [
  { kind: "hire", label: "Hire someone", field: "amount", fieldLabel: "Cost a month, including everything", staged: true },
  { kind: "let-go", label: "One fewer person", field: "amount", fieldLabel: "What they cost a month", staged: true },
  { kind: "lose-customer", label: "Lose a customer", field: "amount", fieldLabel: "What they buy a month", staged: true },
  { kind: "win-customer", label: "Win a customer", field: "amount", fieldLabel: "What they would buy a month", staged: true },
  { kind: "price-change", label: "Change your prices", field: "percent", fieldLabel: "Up or down, per cent", staged: false },
  { kind: "volume-change", label: "Sell more or less", field: "percent", fieldLabel: "Up or down, per cent", staged: false },
  { kind: "cost-change", label: "Supplier costs change", field: "percent", fieldLabel: "Up or down, per cent", staged: false },
  { kind: "fixed-cost", label: "A new standing cost", field: "amount", fieldLabel: "Cost a month", staged: true },
  { kind: "one-off", label: "A one-off payment", field: "amount", fieldLabel: "Amount, negative if money comes in", staged: true }
];

export default function Scenarios() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();

  const [changes, setChanges] = useState<Change[]>([]);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(12);
  const [override, setOverride] = useState<Baseline | null>(null);
  const [floorMajor, setFloorMajor] = useState(0);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const currency = ws.profile?.currency ?? "INR";
  const unit = 10 ** decimalsFor(currency);
  const today = todayIso();

  const derived = useMemo(
    () => baselineFrom({ documents: db.documents(), expenses: db.expenses(), profile: ws.profile, today, currency, items: db.items() }),
    // the workspace object itself changes on every save, which is exactly when this should rerun
    [ws, db, today, currency]
  );

  if (!ready) return <div className="h-72 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const m = (minor: number) => formatMoney(fromMinor(minor, currency), "en-IN");
  const major = (minor: number) => String(Math.round(minor / unit));
  const toMinor = (value: string) => Math.round((Number(value) || 0) * unit);

  const base: Baseline = { ...(override ?? derived.baseline), minimumCashMinor: Math.round(floorMajor * unit) };
  const usable = enoughToSimulate(derived) || override !== null;
  const sim = simulate(base, { name: name || "This change", changes, horizonMonths: horizon }, (minor) => m(minor));
  const affordable = affordableFixedCostMinor(base, horizon);
  const saved = db.scenarios();

  const editBase = (patch: Partial<Baseline>) => setOverride({ ...(override ?? derived.baseline), ...patch });

  const open = (id: string) => {
    const row = saved.find((s) => s.id === id);
    if (!row) return;
    setChanges(row.changes);
    setName(row.name);
    setHorizon((HORIZONS.find((h) => h === row.horizonMonths) ?? 12) as (typeof HORIZONS)[number]);
    if (row.baseline) setOverride(row.baseline);
    setOpenId(id);
  };

  const save = () => {
    if (!name.trim() || !changes.length) return;
    const row = db.saveScenario({
      name: name.trim(),
      changes,
      horizonMonths: horizon,
      ...(override ? { baseline: override } : {})
    });
    setOpenId(row.id);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">What if</h1>
        <p className="mt-1 max-w-2xl text-ink-soft">
          Try a change before you make it. Nothing here is saved to your books or shown to anyone: it is your own figures with one thing moved.
        </p>
      </div>

      {!usable ? (
        <div className="rounded-xl border border-forest bg-forest-pale p-5">
          <h2 className="font-display text-lg">There is nothing to work from yet</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            This runs on your own invoices and bills. Record a month of them, or put your figures in by hand below, and it can answer properly.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/invoice-generator/" className="btn-primary">Make an invoice</Link>
            <Link href="/expenses/" className="btn-ghost">Record a bill</Link>
          </div>
        </div>
      ) : null}

      {/* ---- the month as it stands ---- */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">Your month as it stands</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              {derived.basis.usedCurrentMonth
                ? `From ${derived.basis.label}, which is all there is so far. Worth correcting by hand.`
                : `Averaged over ${derived.basis.label}, from your own invoices and bills.`}
              {derived.basis.thin && !derived.basis.usedCurrentMonth ? " That is a short run, so check it." : ""}
            </p>
          </div>
          {override ? (
            <button type="button" className="btn-quiet text-sm" onClick={() => setOverride(null)}>
              <RotateCcw size={14} /> Back to my books
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Sales a month" value={major(base.monthlyIncomeMinor)} currency={currency}
            onChange={(v) => editBase({ monthlyIncomeMinor: toMinor(v) })} note="What you invoice, before tax" />
          <Figure label="Costs that move with sales" value={major(base.monthlyVariableCostMinor)} currency={currency}
            onChange={(v) => editBase({ monthlyVariableCostMinor: toMinor(v) })}
            note={derived.variable.length ? derived.variable.map((r) => r.name).join(", ") : "Stock, materials, fees"} />
          <Figure label="Standing costs a month" value={major(base.monthlyFixedCostMinor)} currency={currency}
            onChange={(v) => editBase({ monthlyFixedCostMinor: toMinor(v) })}
            note={derived.fixed.length ? derived.fixed.slice(0, 3).map((r) => r.name).join(", ") : "Rent, salaries, subscriptions"} />
          <Figure label="Cash in hand" value={major(base.cashMinor)} currency={currency}
            onChange={(v) => editBase({ cashMinor: toMinor(v) })}
            note={base.receivablesMinor ? `${m(base.receivablesMinor)} invoiced and not yet in` : "From your ledger today"} />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-line pt-4">
          <label className="text-sm text-ink-soft">
            <span className="mb-1 block font-medium text-ink">Tell me if cash goes below</span>
            <input type="number" className="field w-40 tabular" value={floorMajor || ""} placeholder="0"
              onChange={(e) => setFloorMajor(Number(e.target.value) || 0)} />
          </label>
          <div className="text-sm text-ink-soft">
            <span className="mb-1 block font-medium text-ink">Look ahead</span>
            <div className="flex gap-1.5">
              {HORIZONS.map((h) => (
                <button key={h} type="button" onClick={() => setHorizon(h)} aria-pressed={horizon === h}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${horizon === h ? "border-forest bg-forest text-white" : "border-line bg-white text-ink-soft hover:border-ink"}`}>
                  {h} months
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- the changes ---- */}
      <section className="card p-5">
        <h2 className="font-display text-lg">What are you thinking of doing?</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          {presetsFor(base, derived.biggestCustomer).map((p) => (
            <button key={p.name} type="button" className="chip hover:border-ink"
              onClick={() => { setChanges(p.changes); setName(p.name); setOpenId(null); }}>
              {p.name}
            </button>
          ))}
        </div>

        {changes.length ? (
          <ul className="mt-4 space-y-2">
            {changes.map((c, i) => (
              <li key={`${c.kind}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
                <span>
                  {describeChange(c)}
                  <span className="text-ink-soft">{detailOf(c, m)}</span>
                </span>
                <button type="button" aria-label={`Remove ${describeChange(c)}`} className="rounded p-1 text-ink-faint hover:bg-white hover:text-bad"
                  onClick={() => setChanges(changes.filter((_, j) => j !== i))}>
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-ink-faint">Pick one of the questions above, or build your own.</p>
        )}

        <AddChange currency={currency} unit={unit} onAdd={(c) => { setChanges([...changes, c]); setOpenId(null); }} />
      </section>

      {/* ---- the answer ---- */}
      {changes.length ? (
        <section className="space-y-5">
          <div className={`rounded-xl border p-5 ${sim.safe ? "border-forest bg-forest-pale" : "border-bad/30 bg-bad/5"}`}>
            <h2 className={`font-display text-xl ${sim.safe ? "" : "text-bad"}`}>{sim.headline}</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
              {sim.lines.map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {!sim.safe && affordable > 0 && sim.after.monthlyFixedCostMinor > sim.before.monthlyFixedCostMinor ? (
              <p className="mt-3 border-t border-line pt-3 text-sm">
                The most you could add to your monthly bill and still keep a profit is <strong className="tabular">{m(affordable)}</strong> a month
                {changes.some((c) => c.kind === "one-off") ? ", leaving aside the one-off payment" : ""}.
              </p>
            ) : null}
          </div>

          <div className="card overflow-hidden">
            <h3 className="px-5 pt-5 font-display text-lg">Side by side</h3>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead className="bg-canvas text-left">
                <tr>
                  <th className="px-5 py-2.5 font-semibold">A month</th>
                  <th className="px-5 py-2.5 text-right font-semibold">As it is</th>
                  <th className="px-5 py-2.5 text-right font-semibold">With the change</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Difference</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Sales" before={m(sim.before.monthlyIncomeMinor)} after={m(sim.after.monthlyIncomeMinor)} delta={signed(sim.delta.monthlyIncomeMinor, m)} good={sim.delta.monthlyIncomeMinor >= 0} />
                <Row label="Costs that move with sales" before={m(sim.before.monthlyVariableCostMinor)} after={m(sim.after.monthlyVariableCostMinor)}
                  delta={signed(sim.after.monthlyVariableCostMinor - sim.before.monthlyVariableCostMinor, m)} good={sim.after.monthlyVariableCostMinor <= sim.before.monthlyVariableCostMinor} />
                <Row label="Standing costs" before={m(sim.before.monthlyFixedCostMinor)} after={m(sim.after.monthlyFixedCostMinor)}
                  delta={signed(sim.after.monthlyFixedCostMinor - sim.before.monthlyFixedCostMinor, m)} good={sim.after.monthlyFixedCostMinor <= sim.before.monthlyFixedCostMinor} />
                <Row label="Profit" before={m(sim.before.monthlyProfitMinor)} after={m(sim.after.monthlyProfitMinor)} delta={signed(sim.delta.monthlyProfitMinor, m)} good={sim.delta.monthlyProfitMinor >= 0} strong />
                <Row label="Margin" before={sim.before.marginPercent === null ? "—" : `${sim.before.marginPercent}%`}
                  after={sim.after.marginPercent === null ? "—" : `${sim.after.marginPercent}%`}
                  delta={sim.delta.marginPoints === null || sim.delta.marginPoints === 0 ? "—" : `${sim.delta.marginPoints > 0 ? "+" : "−"}${Math.abs(sim.delta.marginPoints)} pts`}
                  good={(sim.delta.marginPoints ?? 0) >= 0} />
                <Row label="Sales needed to break even" before={sim.before.breakEvenIncomeMinor === null ? "—" : m(sim.before.breakEvenIncomeMinor)}
                  after={sim.after.breakEvenIncomeMinor === null ? "Not possible" : m(sim.after.breakEvenIncomeMinor)}
                  delta={sim.delta.breakEvenIncomeMinor === null ? "—" : signed(sim.delta.breakEvenIncomeMinor, m)}
                  good={(sim.delta.breakEvenIncomeMinor ?? 0) <= 0} />
                <Row label={`Cash after ${horizon} months`} before={m(sim.before.cashAtHorizonMinor)} after={m(sim.after.cashAtHorizonMinor)}
                  delta={signed(sim.delta.cashAtHorizonMinor, m)} good={sim.delta.cashAtHorizonMinor >= 0} />
              </tbody>
            </table>
          </div>

          <CashLines sim={sim} currency={currency} floorMinor={base.minimumCashMinor ?? 0} format={m} />

          {sim.unanswered.length ? (
            <div className="rounded-xl border border-line bg-white p-4">
              <h3 className="text-sm font-semibold">What this cannot tell you</h3>
              <ul className="mt-1.5 space-y-1 text-sm text-ink-soft">
                {sim.unanswered.map((u) => <li key={u}>{u}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Keep this question</span>
              <input className="field w-72" value={name} placeholder="Hire a second driver" onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" onClick={save} disabled={!name.trim()}>Save</button>
            <button type="button" className="btn-ghost" onClick={() => { setChanges([]); setName(""); setOpenId(null); }}>Start again</button>
          </div>
        </section>
      ) : null}

      {/* ---- kept questions ---- */}
      {saved.length ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Questions you kept</h2>
          <p className="mt-0.5 text-sm text-ink-soft">The changes are kept, not the answer, so these run against your figures as they are today.</p>
          <ul className="mt-3 divide-y divide-line">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.name}{openId === s.id ? <span className="ml-2 text-xs font-normal text-ink-faint">open</span> : null}</p>
                  <p className="truncate text-xs text-ink-soft">{s.changes.map((c) => describeChange(c)).join(" · ") || "No changes"}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" className="btn-quiet text-sm" onClick={() => open(s.id)}>Open</button>
                  <button type="button" aria-label={`Delete ${s.name}`} className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-bad"
                    onClick={() => db.deleteScenario(s.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-sm text-ink-faint">
        A projection, not a promise. It holds everything else steady, which real months never do, and assumes the costs that move with sales keep the same share of each sale.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- the parts */

function Figure({ label, value, note, currency, onChange }: { label: string; value: string; note: string; currency: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <span className="text-sm text-ink-faint">{currency}</span>
        <input type="number" className="field tabular font-display text-lg" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
      <span className="mt-1 block truncate text-xs text-ink-soft">{note}</span>
    </label>
  );
}

function Row({ label, before, after, delta, good, strong }: { label: string; before: string; after: string; delta: string; good: boolean; strong?: boolean }) {
  return (
    <tr className="border-t border-line">
      <td className={`px-5 py-2.5 ${strong ? "font-semibold" : ""}`}>{label}</td>
      <td className="px-5 py-2.5 text-right tabular text-ink-soft">{before}</td>
      <td className={`px-5 py-2.5 text-right tabular ${strong ? "font-semibold" : ""}`}>{after}</td>
      <td className={`px-5 py-2.5 text-right tabular ${good ? "text-ok" : "text-bad"}`}>{delta}</td>
    </tr>
  );
}

const signed = (minor: number, m: (minor: number) => string) => (minor === 0 ? "—" : `${minor > 0 ? "+" : "−"}${m(Math.abs(minor))}`);

function detailOf(c: Change, m: (minor: number) => string): string {
  const when = "startsInMonths" in c && c.startsInMonths ? `, from month ${c.startsInMonths}` : c.kind === "one-off" && c.inMonths ? `, in month ${c.inMonths}` : "";
  switch (c.kind) {
    case "hire":
    case "let-go":
    case "fixed-cost":
      return ` — ${m(c.monthlyCostMinor)} a month${when}`;
    case "lose-customer":
    case "win-customer":
      return ` — ${m(c.monthlyIncomeMinor)} of sales a month${when}`;
    case "one-off":
      return ` — ${m(Math.abs(c.amountMinor))}${when}`;
    case "price-change":
      return c.volumePercent ? ` — with ${Math.abs(c.volumePercent)}% ${c.volumePercent < 0 ? "fewer" : "more"} orders` : "";
    default:
      return "";
  }
}

/** The two cash lines, so the shape of the next year is visible rather than described. */
function CashLines({ sim, currency, floorMinor, format }: { sim: ReturnType<typeof simulate>; currency: string; floorMinor: number; format: (minor: number) => string }) {
  const beforeValues = sim.before.cash.map((p) => p.cashMinor);
  const afterValues = sim.after.cash.map((p) => p.cashMinor);
  const all = [...beforeValues, ...afterValues, 0];
  const high = Math.max(...all);
  const low = Math.min(...all);
  const span = high - low || 1;
  const path = (values: number[]) => values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${100 - ((v - low) / span) * 100}`).join(" ");
  const zeroLine = 100 - ((0 - low) / span) * 100;

  // Worth pointing at only when the lowest month is a real dip: either below the line the owner
  // drew, or a trough in the middle rather than simply the last month of a falling line.
  const serious = sim.after.lowestCashMinor < Math.max(0, floorMinor);
  const dip = serious || (sim.after.lowestCashMonth > 0 && sim.after.lowestCashMonth < sim.horizonMonths)
    ? { serious }
    : null;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg">Cash over {sim.horizonMonths} months</h3>
        <p className="flex items-center gap-4 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-ink-faint" aria-hidden="true" /> As it is</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-forest" aria-hidden="true" /> With the change</span>
        </p>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mt-3 h-44 w-full" role="img"
        aria-label={`Cash over ${sim.horizonMonths} months, ${format(sim.after.cashAtHorizonMinor)} with the change against ${format(sim.before.cashAtHorizonMinor)} without it`}>
        {low < 0 ? <line x1="0" y1={zeroLine} x2="100" y2={zeroLine} stroke="#B42318" strokeWidth="0.4" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" /> : null}
        <polyline points={path(beforeValues)} fill="none" stroke="#9AA3A0" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <polyline points={path(afterValues)} fill="none" stroke="#0B3D2E" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-ink-faint">
        <span>Month 1</span>
        <span>
          Month {sim.horizonMonths}: {format(sim.after.cashAtHorizonMinor)} ({currency})
        </span>
      </div>
      {dip ? (
        <p className={`mt-2 text-sm ${dip.serious ? "text-warn" : "text-ink-soft"}`}>
          The tightest month is month {sim.after.lowestCashMonth}, at {format(sim.after.lowestCashMinor)}.
          {dip.serious ? " That is below where you said to warn you." : ""}
        </p>
      ) : null}
    </section>
  );
}

/** Building a change by hand, with only the fields that kind of change needs. */
function AddChange({ currency, unit, onAdd }: { currency: string; unit: number; onAdd: (change: Change) => void }) {
  const [kind, setKind] = useState<ChangeKind>("hire");
  const [value, setValue] = useState("");
  const [volume, setVolume] = useState("");
  const [label, setLabel] = useState("");
  const [starts, setStarts] = useState(0);

  const spec = KINDS.find((k) => k.kind === kind)!;
  const amountMinor = Math.round((Number(value) || 0) * unit);
  const percent = Number(value) || 0;

  const add = () => {
    if (!value.trim()) return;
    const named = label.trim() ? { label: label.trim() } : {};
    const change: Change =
      kind === "hire" || kind === "let-go" || kind === "fixed-cost"
        ? { kind, monthlyCostMinor: amountMinor, startsInMonths: starts, ...named }
        : kind === "lose-customer" || kind === "win-customer"
          ? { kind, monthlyIncomeMinor: amountMinor, startsInMonths: starts, ...named }
          : kind === "one-off"
            ? { kind, amountMinor, inMonths: starts, ...named }
            : kind === "price-change"
              ? { kind, percent, volumePercent: Number(volume) || 0, ...named }
              : { kind: kind as "volume-change" | "cost-change", percent, ...named };
    onAdd(change);
    setValue("");
    setVolume("");
    setLabel("");
  };

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Add a change</span>
          <select className="field w-56" value={kind} onChange={(e) => setKind(e.target.value as ChangeKind)}>
            {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{spec.fieldLabel}</span>
          <span className="flex items-center gap-1.5">
            {spec.field === "amount" ? <span className="text-sm text-ink-faint">{currency}</span> : null}
            <input type="number" className="field w-40 tabular" value={value} onChange={(e) => setValue(e.target.value)} placeholder={spec.field === "percent" ? "10" : "25000"} />
            {spec.field === "percent" ? <span className="text-sm text-ink-faint">%</span> : null}
          </span>
        </label>

        {kind === "price-change" ? (
          <label className="text-sm">
            <span className="mb-1 block font-medium">Orders change by</span>
            <span className="flex items-center gap-1.5">
              <input type="number" className="field w-32 tabular" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="-10" />
              <span className="text-sm text-ink-faint">%</span>
            </span>
          </label>
        ) : null}

        {spec.staged ? (
          <label className="text-sm">
            <span className="mb-1 block font-medium">Starting</span>
            <select className="field w-36" value={starts} onChange={(e) => setStarts(Number(e.target.value))}>
              <option value={0}>This month</option>
              <option value={1}>Next month</option>
              <option value={3}>In 3 months</option>
              <option value={6}>In 6 months</option>
            </select>
          </label>
        ) : null}

        <label className="text-sm">
          <span className="mb-1 block font-medium">Call it</span>
          <input className="field w-44" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional" />
        </label>

        <button type="button" className="btn-ghost" onClick={add} disabled={!value.trim()}><Plus size={15} /> Add</button>
      </div>
      {kind === "price-change" ? (
        <p className="mt-2 text-xs text-ink-soft">
          A price rise usually costs some orders. Put the drop you expect in the second field, as a negative number, and leave it blank if you think nothing changes.
        </p>
      ) : null}
    </div>
  );
}
