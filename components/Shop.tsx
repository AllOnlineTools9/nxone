"use client";
import { Banknote, Camera, CreditCard, Minus, Plus, Printer, ScanLine, Settings2, Smartphone, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { advanceNumber, blankDocument } from "@/components/builder/state";
import { calculate } from "@/lib/documents/totals";
import { qrDataUrl, upiUri } from "@/lib/documents/payment";
import { formatMoney, fromMinor } from "@/lib/money";
import {
  DEFAULT_SETTINGS, addToCart, changeFor, cleanCode, daySummary, findByCode, quickCash, round3, saleDocument, searchItems,
  type CartLine, type PayMode, type ShopSettings
} from "@/lib/shop/sale";
import { nextNumber, todayIso } from "@/lib/format";
import { packFor } from "@/lib/countries/packs";
import { rulesOn } from "@/lib/countries/types";
import type { CatalogueItem, SavedDocument } from "@/lib/store/types";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";
import ShopReceipt from "./ShopReceipt";

/**
 * Billing at the counter: scan or type, take the money, print the receipt, next customer.
 *
 * Every sale is saved as a paid invoice in the business's own series, so GST, stock, reports and
 * the accountant see counter sales like any other. A barcode scanner works as a keyboard, so the
 * search box is always ready for one: a scan types the code and presses Enter.
 */

const SETTINGS_KEY = "nxone.shop.settings";
const MODES: Array<[PayMode, string, typeof Banknote]> = [["cash", "Cash", Banknote], ["upi", "UPI", Smartphone], ["card", "Card", CreditCard]];

declare global {
  interface Window { BarcodeDetector?: new (opts?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } }
}

function loadSettings(): ShopSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }; } catch { return DEFAULT_SETTINGS; }
}

export default function Shop() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [settings, setSettings] = useState<ShopSettings>(DEFAULT_SETTINGS);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PayMode>("cash");
  const [tendered, setTendered] = useState("");
  const [customer, setCustomer] = useState({ name: "", phone: "", taxId: "" });
  const [showCustomer, setShowCustomer] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({ description: "", rate: "", taxRuleId: "" });
  const [done, setDone] = useState<SavedDocument | null>(null);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [upiQr, setUpiQr] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => { setSettings(loadSettings()); }, []);
  const saveSettings = (s: ShopSettings) => {
    setSettings(s);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* kept for this visit only */ }
  };

  const profile = ws.profile;
  const items = useMemo(() => (ready ? db.items() : []), [ws, ready]);
  const sales = useMemo(() => (ready ? db.documents().filter((d) => d.sale) : []), [ws, ready]);
  const today = todayIso();
  const day = daySummary(sales, today);

  // The items sold most lately, as buttons, so the usual things are one tap away.
  const usual = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of sales.slice(-300)) for (const l of s.doc.items) count.set(l.description, (count.get(l.description) ?? 0) + l.quantity);
    const ranked = [...items].sort((a, b) => (count.get(b.description) ?? 0) - (count.get(a.description) ?? 0));
    return ranked.slice(0, 12);
  }, [items, sales]);

  const draft = useMemo(() => {
    if (!ready || cart.length === 0) return null;
    return saleDocument(blankDocument("invoice", profile?.country ?? "IN"), profile, cart, { settings, mode, customer });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, settings, mode, customer, ready, ws]);
  const totals = draft ? calculate(draft) : null;
  const totalMinor = totals?.total.minor ?? 0;
  const tenderedMinor = Math.round((Number(tendered) || 0) * 100);
  const { changeMinor, shortMinor } = changeFor(totalMinor, tenderedMinor);
  const currency = profile?.currency ?? "INR";
  const m = (minor: number) => formatMoney(fromMinor(minor, currency), currency === "INR" ? "en-IN" : "en-US");

  // A UPI code for the exact amount, so the customer scans and pays without typing it.
  useEffect(() => {
    if (mode !== "upi" || !profile?.upiId || !totalMinor) { setUpiQr(""); return; }
    const uri = upiUri({ upiId: profile.upiId, name: profile.name ?? "", amount: fromMinor(totalMinor, currency), note: "Shop sale" });
    qrDataUrl(uri, 240).then(setUpiQr).catch(() => setUpiQr(""));
  }, [mode, totalMinor, profile?.upiId, profile?.name, currency]);

  // The rates a shop sells at, within its own state, for a new item found by scanning.
  const taxChoices = useMemo(() => {
    if (!profile) return [];
    const seen = new Set<number>();
    return rulesOn(packFor(profile.country ?? "IN"), today)
      .filter((r) => r.appliesWhen !== "inter-region")
      .filter((r) => (seen.has(r.rate) ? false : (seen.add(r.rate), true)))
      .sort((a, b) => a.rate - b.rate);
  }, [profile, today]);

  const focusSearch = () => setTimeout(() => search.current?.focus(), 0);

  const add = (item: CatalogueItem, qty = 1) => {
    setCart((c) => addToCart(c, item, qty));
    setQuery(""); setUnknown(null); setDone(null); setError("");
    focusSearch();
  };

  const onEnter = () => {
    const q = query.trim();
    if (!q) return;
    // "3*code" or "3x code" adds three, as counter staff are used to.
    const multi = q.match(/^(\d+(?:\.\d+)?)\s*[*x×]\s*(.+)$/i);
    const qty = multi ? Number(multi[1]) : 1;
    const term = multi ? multi[2] : q;
    const byCode = findByCode(items, term);
    if (byCode) return add(byCode, qty);
    const found = searchItems(items, term, 2);
    if (found.length === 1) return add(found[0], qty);
    if (/^[0-9A-Z-]{6,}$/i.test(cleanCode(term))) { setUnknown(cleanCode(term)); setNewItem({ description: "", rate: "", taxRuleId: "" }); }
  };

  const addUnknown = () => {
    const rate = Number(newItem.rate);
    if (!newItem.description.trim() || !(rate > 0)) { setError("Give the item a name and a price."); return; }
    try {
      const item = db.saveItem({ description: newItem.description.trim(), rate, barcode: unknown ?? undefined, taxRuleId: newItem.taxRuleId || blankDocument("invoice", profile?.country ?? "IN").items[0]?.taxRuleId });
      add(item);
    } catch (e) { setError(e instanceof Error ? e.message : "That item could not be saved."); }
  };

  const attachTo = (item: CatalogueItem) => {
    try {
      const updated = db.saveItem({ ...item, barcode: unknown ?? undefined });
      add(updated);
    } catch (e) { setError(e instanceof Error ? e.message : "That could not be saved."); }
  };

  const setQty = (key: string, q: number) => setCart((c) => (q <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity: round3(q) } : l))));
  const setRate = (key: string, r: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, rate: r } : l)));

  const complete = () => {
    if (!draft || !totalMinor) return;
    if (mode === "cash" && tendered && shortMinor > 0) { setError(`${m(shortMinor)} short.`); return; }
    setError("");
    // Never reuse a number: saving under one that exists would replace that invoice.
    const used = new Set(db.documents().filter((d) => d.kind === "invoice").map((d) => d.number));
    let number = draft.number;
    for (let i = 0; used.has(number) && i < 10_000; i++) number = nextNumber(number);
    try {
      const saved = db.saveDocument({
        kind: "invoice", number, clientName: draft.buyer.name, issueDate: draft.issueDate, currency: draft.currency,
        totalMinor, paidMinor: totalMinor, paidOn: draft.issueDate, status: "paid", doc: { ...draft, number },
        sale: { mode, tenderedMinor: mode === "cash" && tendered ? tenderedMinor : undefined }
      });
      advanceNumber("invoice", number);
      setDone(saved);
      setCart([]); setTendered(""); setCustomer({ name: "", phone: "", taxId: "" }); setShowCustomer(false);
      if (settings.autoPrint) setTimeout(() => window.print(), 150);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The sale could not be saved.");
    }
  };

  // Ctrl+Enter or F9 completes the sale from anywhere on the screen.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) || e.key === "F9") { e.preventDefault(); complete(); }
      if (e.key === "Escape") { setQuery(""); setUnknown(null); focusSearch(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  /* camera scanning, where the browser can read barcodes itself (Chrome on Android) */
  const canCamera = typeof window !== "undefined" && Boolean(window.BarcodeDetector);
  useEffect(() => {
    if (!scanning || !window.BarcodeDetector) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) {
            const code = codes[0].rawValue;
            const item = findByCode(items, code);
            if (item) add(item); else { setUnknown(cleanCode(code)); setNewItem({ description: "", rate: "", taxRuleId: "" }); }
            if (navigator.vibrate) navigator.vibrate(60);
            setScanning(false);
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setError("The camera could not be opened. Allow camera access, or type the code.");
        setScanning(false);
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  if (!ready) return <div className="h-96 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;
  if (!profile) {
    return (
      <div className="card p-6">
        <h1 className="font-display text-2xl">Shop billing</h1>
        <p className="mt-2 text-ink-soft">Set up your business first, so receipts carry your name, address and GSTIN.</p>
        <a href="/welcome/" className="btn-primary mt-4">Set up your business</a>
      </div>
    );
  }

  const results = query.trim() ? searchItems(items, query.replace(/^\d+(?:\.\d+)?\s*[*x×]\s*/i, "")) : [];

  return (
    <div className="no-print-shop">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl">Shop billing</h1>
          <p className="text-sm text-ink-soft">
            Today: {day.count} sale{day.count === 1 ? "" : "s"}, {m(day.totalMinor)}
            <span className="hidden sm:inline"> · cash {m(day.byMode.cash)} · UPI {m(day.byMode.upi)} · card {m(day.byMode.card)}</span>
          </p>
        </div>
        <button type="button" className="btn-quiet" onClick={() => setShowSettings((s) => !s)}><Settings2 size={16} />Counter settings</button>
      </div>

      {showSettings ? (
        <section className="card mb-4 grid gap-3 p-4 sm:grid-cols-4">
          <label className="block text-sm">
            <span className="label">Receipt paper</span>
            <select className="field" value={settings.paper} onChange={(e) => saveSettings({ ...settings, paper: e.target.value as ShopSettings["paper"] })}>
              <option value="80">80 mm</option><option value="58">58 mm</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm sm:pt-6">
            <input type="checkbox" checked={settings.pricesIncludeTax} onChange={(e) => saveSettings({ ...settings, pricesIncludeTax: e.target.checked })} />
            Prices include GST
          </label>
          <label className="flex items-center gap-2 text-sm sm:pt-6">
            <input type="checkbox" checked={settings.autoPrint} onChange={(e) => saveSettings({ ...settings, autoPrint: e.target.checked })} />
            Print as soon as a sale is done
          </label>
          <label className="block text-sm">
            <span className="label">Line at the bottom</span>
            <input className="field" maxLength={80} value={settings.footer} onChange={(e) => saveSettings({ ...settings, footer: e.target.value })} />
          </label>
          <p className="text-xs text-ink-faint sm:col-span-4">Kept on this device, so each counter can have its own printer settings.</p>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
        {/* ------------------------------------------------ finding items */}
        <section className="min-w-0 space-y-4">
          <div className="card p-4">
            <label className="relative block">
              <span className="sr-only">Scan or search</span>
              <ScanLine size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                ref={search} autoFocus className="field pl-10 pr-12 text-lg" placeholder="Scan a barcode or type an item"
                value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onEnter(); } }}
                autoComplete="off" inputMode="search"
              />
              {canCamera ? (
                <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2.5 text-ink-soft hover:bg-canvas" aria-label="Scan with the camera" onClick={() => setScanning(true)}>
                  <Camera size={18} />
                </button>
              ) : null}
            </label>
            <p className="mt-2 text-xs text-ink-faint">Enter adds it. Type 3*name or 3x code for three. Ctrl+Enter or F9 finishes the sale.</p>

            {scanning ? (
              <div className="relative mt-3 overflow-hidden rounded-lg bg-black">
                <video ref={video} className="aspect-video w-full object-cover" muted playsInline />
                <button type="button" className="absolute right-2 top-2 rounded-full bg-white/90 p-2" aria-label="Stop scanning" onClick={() => setScanning(false)}><X size={16} /></button>
              </div>
            ) : null}

            {results.length ? (
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                {results.map((i) => (
                  <li key={i.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-canvas" onClick={() => add(i)}>
                      <span>{i.description}{i.barcode ? <span className="ml-2 text-xs text-ink-faint">{i.barcode}</span> : null}</span>
                      <span className="tabular">{m(Math.round(i.rate * 100))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim() && !unknown ? <p className="mt-3 text-sm text-ink-soft">Nothing matches. Press Enter on a barcode to add it as a new item.</p> : null}

            {unknown ? (
              <div className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-3">
                <p className="text-sm">No item has the code <strong>{unknown}</strong>. Add it now, and the next scan finds it.</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_8rem_auto]">
                  <input className="field col-span-2 sm:col-span-1" placeholder="Item name" value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
                  <input className="field" placeholder="Price" inputMode="decimal" value={newItem.rate} onChange={(e) => setNewItem({ ...newItem, rate: e.target.value })} />
                  <select className="field" aria-label="Tax rate" value={newItem.taxRuleId} onChange={(e) => setNewItem({ ...newItem, taxRuleId: e.target.value })}>
                    <option value="">Usual rate</option>
                    {taxChoices.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                  <button type="button" className="btn-primary justify-center" onClick={addUnknown}>Add and sell</button>
                </div>
                {items.length ? (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-ink-soft">Or it is an item you already have</summary>
                    <ul className="mt-2 max-h-48 overflow-auto rounded border border-line bg-white">
                      {items.filter((i) => !i.barcode).slice(0, 50).map((i) => (
                        <li key={i.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-canvas" onClick={() => attachTo(i)}>{i.description}</button></li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>

          {usual.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {usual.map((i) => (
                <button key={i.id} type="button" onClick={() => add(i)} className="card flex min-h-[4.5rem] flex-col items-start justify-between p-3 text-left hover:border-forest">
                  <span className="line-clamp-2 text-sm font-medium">{i.description}</span>
                  <span className="text-sm tabular text-ink-soft">{m(Math.round(i.rate * 100))}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="card p-4 text-sm text-ink-soft">Items you add show up here as buttons, the ones you sell most first. Scan a barcode to add one.</p>
          )}
        </section>

        {/* ------------------------------------------------ the bill */}
        <section className="card flex flex-col p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg">This sale</h2>
            {cart.length ? <button type="button" className="btn-quiet text-sm" onClick={() => setCart([])}>Clear</button> : null}
          </div>

          {cart.length === 0 && !done ? <p className="py-8 text-center text-sm text-ink-soft">Scan or pick an item to start.</p> : null}

          <ul className="mt-2 divide-y divide-line overflow-auto">
            {cart.map((l) => (
              <li key={l.key} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{l.description}</span>
                  <button type="button" className="rounded p-1.5 text-ink-faint hover:text-bad" aria-label={`Remove ${l.description}`} onClick={() => setQty(l.key, 0)}><Trash2 size={15} /></button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-line">
                    <button type="button" className="p-2" aria-label="One fewer" onClick={() => setQty(l.key, l.quantity - 1)}><Minus size={14} /></button>
                    <input className="w-14 border-0 bg-transparent text-center tabular" inputMode="decimal" value={l.quantity} onChange={(e) => setQty(l.key, Number(e.target.value) || 0)} aria-label="Quantity" />
                    <button type="button" className="p-2" aria-label="One more" onClick={() => setQty(l.key, l.quantity + 1)}><Plus size={14} /></button>
                  </div>
                  <span className="text-ink-faint">×</span>
                  <input className="field w-24 py-1.5" inputMode="decimal" value={l.rate} onChange={(e) => setRate(l.key, Number(e.target.value) || 0)} aria-label="Price" />
                  <span className="ml-auto tabular">{m(Math.round(l.rate * l.quantity * 100))}</span>
                </div>
              </li>
            ))}
          </ul>

          {cart.length ? (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              <button type="button" className="btn-quiet text-sm" onClick={() => setShowCustomer((s) => !s)}>{showCustomer ? "No customer details" : "Add customer details"}</button>
              {showCustomer ? (
                <div className="grid grid-cols-2 gap-2">
                  <input className="field" placeholder="Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
                  <input className="field" placeholder="Phone" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
                  <input className="field col-span-2 uppercase" placeholder="GSTIN, for a business buyer" maxLength={15} value={customer.taxId} onChange={(e) => setCustomer({ ...customer, taxId: e.target.value.toUpperCase() })} />
                </div>
              ) : null}

              {totals ? (
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between text-ink-soft"><dt>Before tax</dt><dd className="tabular">{m(totals.taxableTotal.minor)}</dd></div>
                  {totals.taxRows.map((r) => <div key={r.label} className="flex justify-between text-ink-soft"><dt>{r.label}</dt><dd className="tabular">{m(r.tax.minor)}</dd></div>)}
                  {totals.roundOff.minor ? <div className="flex justify-between text-ink-soft"><dt>Round off</dt><dd className="tabular">{m(totals.roundOff.minor)}</dd></div> : null}
                  <div className="flex justify-between pt-1 font-display text-2xl"><dt>Total</dt><dd className="tabular">{m(totalMinor)}</dd></div>
                </dl>
              ) : null}

              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Paid by">
                {MODES.map(([v, label, Icon]) => (
                  <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-sm font-medium ${mode === v ? "border-forest bg-forest text-white" : "border-line bg-white"}`}>
                    <Icon size={16} />{label}
                  </button>
                ))}
              </div>

              {mode === "cash" ? (
                <div>
                  <label className="block text-sm">
                    <span className="label">Cash handed over</span>
                    <input className="field text-lg tabular" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={(totalMinor / 100).toFixed(0)} />
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {quickCash(totalMinor).map((v) => <button key={v} type="button" className="chip px-3 py-1.5" onClick={() => setTendered(String(v / 100))}>{m(v)}</button>)}
                  </div>
                  {tendered ? (
                    <p className={`mt-2 text-lg font-semibold ${shortMinor ? "text-bad" : "text-ok"}`}>
                      {shortMinor ? `${m(shortMinor)} short` : `Change ${m(changeMinor)}`}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {mode === "upi" ? (
                profile.upiId ? (
                  upiQr ? (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={upiQr} alt={`UPI code for ${m(totalMinor)}`} className="h-32 w-32 rounded border border-line" />
                      <p className="text-sm text-ink-soft">The customer scans this to pay {m(totalMinor)} to {profile.upiId}. Finish once it shows on your phone.</p>
                    </div>
                  ) : null
                ) : <p className="text-sm text-ink-soft">Add your UPI ID in Business details to show a code for the exact amount here.</p>
              ) : null}

              {error ? <p role="alert" className="text-sm text-bad">{error}</p> : null}

              <button type="button" className="btn-primary w-full justify-center py-3 text-base" onClick={complete}>
                Done, {m(totalMinor)}
              </button>
            </div>
          ) : null}

          {done ? (
            <div className="mt-3 rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm">
              <p className="font-medium">Sale {done.number} saved, {m(done.totalMinor)}.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn-ghost" onClick={() => window.print()}><Printer size={15} />Print receipt</button>
                <button type="button" className="btn-quiet" onClick={() => { setDone(null); focusSearch(); }}>Next customer</button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {done ? <ShopReceipt sale={done} settings={settings} /> : null}
    </div>
  );
}
