"use client";
import { AlertTriangle, Check, Download, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import {
  THRESHOLD_MINOR, buildEwayBill, bulkFile, checkEwayBill, needFor,
  type EwayProblem, type EwayTransport, type TransportMode
} from "@/lib/ewaybill/ewaybill";
import type { SavedDocument } from "@/lib/store/types";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * E-way bills for invoices that move goods.
 *
 * The portal makes the bill; this makes the file it takes, from invoices already written, and
 * checks every bill before it goes so the upload is turned away for nothing. How the goods
 * travel is kept on each invoice, so a second download does not mean typing it all again.
 */

const MODES: Array<[TransportMode, string]> = [["road", "Road"], ["rail", "Rail"], ["air", "Air"], ["ship", "Ship"]];

const blank = (shared: Partial<EwayTransport>): EwayTransport => ({
  mode: shared.mode ?? "road",
  distanceKm: 0,
  transporterId: shared.transporterId,
  transporterName: shared.transporterName
});

export default function EWayBills() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [showAll, setShowAll] = useState(false);
  const [shared, setShared] = useState<Partial<EwayTransport>>({ mode: "road" });
  const [forms, setForms] = useState<Record<string, EwayTransport>>({});
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const profile = ws.profile;
  const country = profile?.country ?? "IN";

  const invoices = useMemo(() => {
    if (!ready) return [];
    return db.documents()
      .map((d) => ({ d, need: needFor(d) }))
      .filter((x) => x.need.applies)
      .sort((a, b) => b.d.issueDate.localeCompare(a.d.issueDate))
      .slice(0, 300);
  }, [ws, ready]);

  if (!ready) return <div className="h-72 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  if (country.toUpperCase() !== "IN") {
    return (
      <div className="card p-6">
        <h1 className="font-display text-2xl">E-way bills</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">E-way bills are for moving goods in India, and your business is set elsewhere.</p>
      </div>
    );
  }

  const m = (minor: number) => formatMoney(fromMinor(minor, "INR"), "en-IN");
  const formFor = (d: SavedDocument): EwayTransport => forms[d.id] ?? d.ewaybill?.transport ?? blank(shared);
  const setForm = (id: string, patch: Partial<EwayTransport>, base: EwayTransport) =>
    setForms((f) => ({ ...f, [id]: { ...base, ...patch } }));

  const pending = invoices.filter((x) => !x.d.ewaybill?.number && (showAll || x.need.required));
  const done = invoices.filter((x) => x.d.ewaybill?.number);
  const hiddenUnder = invoices.filter((x) => !x.d.ewaybill?.number && !x.need.required).length;

  const checked = pending.map((x) => {
    const transport = formFor(x.d);
    const bill = buildEwayBill(x.d, profile, transport, db.documents());
    const problems: EwayProblem[] = bill ? checkEwayBill(bill, transport) : [{ field: "currency", says: "This invoice is in another currency with no exchange rate." }];
    return { ...x, transport, bill, problems };
  });
  const picked = checked.filter((x) => chosen[x.d.id]);
  const pickedReady = picked.filter((x) => x.bill && x.problems.length === 0);

  const applyShared = () => {
    setForms((f) => {
      const next = { ...f };
      for (const x of pending) {
        const base = formFor(x.d);
        next[x.d.id] = {
          ...base, mode: shared.mode ?? base.mode,
          transporterId: shared.transporterId || base.transporterId,
          transporterName: shared.transporterName || base.transporterName
        };
      }
      return next;
    });
  };

  const download = () => {
    if (!pickedReady.length) return;
    const now = new Date().toISOString();
    let kept = 0;
    for (const x of pickedReady) {
      try {
        db.saveDocument({ ...x.d, ewaybill: { ...x.d.ewaybill, transport: x.transport, preparedAt: now } });
        kept++;
      } catch { /* a closed period: the file is still made, the details just are not kept */ }
    }
    const url = URL.createObjectURL(new Blob([bulkFile(pickedReady.map((x) => x.bill!))], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `e-way-bills-${todayIso()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(`The file has ${pickedReady.length} bill${pickedReady.length === 1 ? "" : "s"}. Upload it at ewaybillgst.gov.in under E-way Bill, then Generate Bulk, and add the numbers it gives you below.${kept < pickedReady.length ? " Some invoices are in a closed period, so their transport details were not kept." : ""}`);
  };

  const keepNumber = (d: SavedDocument) => {
    const n = (numbers[d.id] ?? "").replace(/\D/g, "");
    if (!/^\d{12}$/.test(n)) { setNote("An e-way bill number is 12 digits."); return; }
    try {
      db.saveDocument({ ...d, ewaybill: { transport: d.ewaybill?.transport ?? formFor(d), preparedAt: d.ewaybill?.preparedAt ?? new Date().toISOString(), number: n } });
      setNote(`E-way bill ${n} is kept with ${d.number}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That could not be saved.");
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl">E-way bills</h1>
        <p className="mt-2 max-w-3xl text-ink-soft">
          Goods worth more than {m(THRESHOLD_MINOR)} in one consignment need an e-way bill before they move.
          Fill in how they travel, download one file, and upload it on the e-way bill portal under
          E-way Bill, then Generate Bulk. Services need none, so only goods lines count.
        </p>
      </header>

      <section className="card p-5">
        <h2 className="font-display text-lg">Your usual transporter</h2>
        <p className="mt-1 text-sm text-ink-soft">Filled in on every invoice below, so you only type the distance and vehicle.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <label className="block text-sm">
            <span className="label">Mode</span>
            <select className="field" value={shared.mode} onChange={(e) => setShared({ ...shared, mode: e.target.value as TransportMode })}>
              {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="label">Transporter name</span>
            <input className="field" value={shared.transporterName ?? ""} onChange={(e) => setShared({ ...shared, transporterName: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="label">Transporter ID (GSTIN or TRANSIN)</span>
            <input className="field uppercase" maxLength={15} value={shared.transporterId ?? ""} onChange={(e) => setShared({ ...shared, transporterId: e.target.value.toUpperCase() })} />
          </label>
          <div className="flex items-end">
            <button type="button" className="btn-ghost w-full justify-center" onClick={applyShared}>Use on all below</button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <div>
            <h2 className="font-display text-lg">Waiting for an e-way bill</h2>
            <p className="text-sm text-ink-soft">
              {pending.length ? `${pending.length} invoice${pending.length === 1 ? "" : "s"}` : "Nothing waiting."}
              {hiddenUnder && !showAll ? ` ${hiddenUnder} more under ${m(THRESHOLD_MINOR)} are hidden.` : ""}
            </p>
          </div>
          {hiddenUnder ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show invoices under the limit too
            </label>
          ) : null}
        </div>

        {checked.length === 0 ? (
          <p className="flex items-center gap-2 p-5 text-sm text-ink-soft"><Truck size={16} />No invoices with goods over the limit. Invoices appear here once they are sent.</p>
        ) : (
          <ul>
            {checked.map((x) => {
              const t = x.transport;
              const ok = x.bill && x.problems.length === 0;
              return (
                <li key={x.d.id} className="border-t border-line p-5 first:border-t-0">
                  <div className="flex flex-wrap items-start gap-3">
                    <input
                      type="checkbox" className="mt-1.5 h-5 w-5" aria-label={`Include ${x.d.number}`}
                      checked={Boolean(chosen[x.d.id])} onChange={(e) => setChosen({ ...chosen, [x.d.id]: e.target.checked })}
                    />
                    <div className="min-w-[12rem] flex-1">
                      <p className="font-medium">{x.d.number} <span className="font-normal text-ink-soft">to {x.d.clientName}</span></p>
                      <p className="text-sm text-ink-soft">
                        {formatDate(x.d.issueDate, country)} · goods {m(x.need.goodsMinor)}
                        {x.need.required ? "" : " · under the limit"}
                      </p>
                    </div>
                    <span className={`chip ${ok ? "text-ok" : "text-warn"}`}>
                      {ok ? <><Check size={14} />Ready</> : <><AlertTriangle size={14} />{x.problems.length} to fix</>}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
                    <label className="block text-sm">
                      <span className="label">Mode</span>
                      <select className="field" value={t.mode} onChange={(e) => setForm(x.d.id, { mode: e.target.value as TransportMode }, t)}>
                        {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="label">Distance (km)</span>
                      <input className="field" inputMode="numeric" value={t.distanceKm || ""} onChange={(e) => setForm(x.d.id, { distanceKm: Number(e.target.value.replace(/\D/g, "")) }, t)} />
                    </label>
                    {t.mode === "road" ? (
                      <label className="col-span-2 block text-sm">
                        <span className="label">Vehicle number</span>
                        <input className="field uppercase" placeholder="KA01AB1234" value={t.vehicleNumber ?? ""} onChange={(e) => setForm(x.d.id, { vehicleNumber: e.target.value.toUpperCase() }, t)} />
                      </label>
                    ) : (
                      <>
                        <label className="block text-sm">
                          <span className="label">{t.mode === "rail" ? "Railway receipt" : t.mode === "air" ? "Airway bill" : "Bill of lading"}</span>
                          <input className="field" value={t.transportDocNumber ?? ""} onChange={(e) => setForm(x.d.id, { transportDocNumber: e.target.value }, t)} />
                        </label>
                        <label className="block text-sm">
                          <span className="label">Its date</span>
                          <input className="field" type="date" value={t.transportDocDate ?? ""} onChange={(e) => setForm(x.d.id, { transportDocDate: e.target.value }, t)} />
                        </label>
                      </>
                    )}
                    <label className="block text-sm">
                      <span className="label">Delivery pincode</span>
                      <input className="field" inputMode="numeric" maxLength={6} placeholder={x.bill?.toPincode ? String(x.bill.toPincode) : "From address"} value={t.toPincode ?? ""} onChange={(e) => setForm(x.d.id, { toPincode: e.target.value.replace(/\D/g, "") }, t)} />
                    </label>
                    <label className="block text-sm">
                      <span className="label">Transporter ID</span>
                      <input className="field uppercase" maxLength={15} value={t.transporterId ?? ""} onChange={(e) => setForm(x.d.id, { transporterId: e.target.value.toUpperCase() }, t)} />
                    </label>
                  </div>

                  {x.problems.length ? (
                    <ul className="mt-3 space-y-1 text-sm text-warn">
                      {x.problems.map((p) => <li key={p.field} className="flex gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{p.says}</li>)}
                    </ul>
                  ) : null}

                  {x.d.ewaybill?.preparedAt ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="block text-sm">
                        <span className="label">E-way bill number from the portal</span>
                        <input className="field" inputMode="numeric" maxLength={14} placeholder="12 digits" value={numbers[x.d.id] ?? ""} onChange={(e) => setNumbers({ ...numbers, [x.d.id]: e.target.value })} />
                      </label>
                      <button type="button" className="btn-ghost" onClick={() => keepNumber(x.d)}>Keep it</button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-white/95 p-4 backdrop-blur">
          <button type="button" className="btn-primary" disabled={!pickedReady.length} onClick={download}>
            <Download size={16} />Download file{pickedReady.length ? ` for ${pickedReady.length}` : ""}
          </button>
          <span className="text-sm text-ink-soft">
            {picked.length === 0 ? "Tick the invoices to include." : picked.length > pickedReady.length ? `${picked.length - pickedReady.length} ticked still need fixing and will be left out.` : ""}
          </span>
        </div>
      </section>

      {note ? <p role="status" className="rounded-lg border border-line bg-canvas p-3 text-sm">{note}</p> : null}

      {done.length ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Done</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {done.map(({ d }) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{d.number} <span className="text-ink-soft">to {d.clientName}</span></span>
                <span className="tabular">EWB {d.ewaybill?.number}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
