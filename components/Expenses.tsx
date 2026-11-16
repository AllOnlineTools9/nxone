"use client";
import { Camera, Loader2, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { receiptReader } from "@/lib/receipts/reader";
import { shrinkImage } from "@/lib/receipts/types";
import { EXPENSE_CATEGORIES, cashAccounts } from "@/lib/ledger/accounts";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor , decimalsFor } from "@/lib/money";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";
import { checkGstin } from "@/lib/returns/states";
import { ordersFor } from "@/lib/purchasing/match";
import { likelyProjects } from "@/lib/analysis/projects";
import { RCM_CATEGORIES, rcmById } from "@/lib/returns/rcm";
import { TDS_SECTIONS } from "@/lib/tds/sections";
import { deductionsFor } from "@/lib/tds/deduct";
import { knownRates, usableRate } from "@/lib/fx";
import Attachments from "./Attachments";
import type { Attachment } from "@/lib/files/vault";
import { keepingStock, STOCK_ACCOUNT, type StockItem } from "@/lib/stock/ledger";

const toMinor = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100);

/** Money out. Each one posts to the ledger, so profit and cash follow without extra work. */
export default function Expenses() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const currency = ws.profile?.currency ?? "INR";

  const [form, setForm] = useState({ date: todayIso(), supplier: "", description: "", category: "6900", net: 0, tax: 0, paidFrom: "1020", reference: "", orderId: "", projectId: "", rcmCategory: "", supplierGstin: "", supplierPan: "", supplierType: "other" as "individual" | "other", tdsSection: "", billCurrency: "", fxRate: 0, stockQuantity: 0 });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const foreignBill = Boolean(form.billCurrency) && form.billCurrency.toUpperCase() !== currency;
  const lastRate = foreignBill ? knownRates(db.documents(), currency)[form.billCurrency.toUpperCase()] : undefined;

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [receipt, setReceipt] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Attaching the bill always works and keeps the paperwork with the money. Reading it needs a
   * service, so when there is not one we say so rather than leaving the fields mysteriously empty.
   */
  const attach = async (file: File | undefined) => {
    if (!file) return;
    setReadNote("");
    try {
      const dataUrl = await shrinkImage(file);
      setReceipt({ dataUrl, fileName: file.name });
      setReading(true);
      const result = await receiptReader().read({ dataUrl, fileName: file.name });
      setReading(false);

      if (result.status === "extracted") {
        const r = result.receipt;
        set({
          supplier: r.supplier ?? form.supplier,
          date: r.date ?? form.date,
          net: r.totalMinor ? (r.totalMinor - (r.taxMinor ?? 0)) / 100 : form.net,
          tax: r.taxMinor ? r.taxMinor / 100 : form.tax,
          reference: r.invoiceNumber ?? form.reference
        });
        setReadNote(r.confidence > 0.6
          ? "Read from the photo. Check the figures before you save."
          : "Only some of it could be read. Fill in the rest yourself.");
      } else {
        setReadNote(result.message);
      }
    } catch (error) {
      setReading(false);
      setReadNote(error instanceof Error ? error.message : "That file could not be used.");
    }
  };

  /**
   * What this bill would attract, counting the year's earlier payments to the same supplier:
   * the threshold is on the year, not on the bill in front of you.
   */
  const suggestedTds = (() => {
    if (!form.tdsSection || !form.net) return 0;
    const earlier = db.expenses()
      .filter((e) => e.supplier.trim().toLowerCase() === form.supplier.trim().toLowerCase() && e.tdsSection === form.tdsSection)
      .map((e) => ({ id: e.id, date: e.date, supplier: e.supplier, supplierPan: e.supplierPan, supplierType: e.supplierType, netMinor: e.netMinor }));
    const all = [...earlier, {
      id: "new", date: form.date, supplier: form.supplier.trim(),
      supplierPan: form.supplierPan.trim() || undefined, supplierType: form.supplierType,
      netMinor: Math.round(form.net * 100)
    }];
    return deductionsFor(all, form.tdsSection).find((d) => d.paymentId === "new")?.shouldBeMinor ?? 0;
  })();

  /** Jobs this cost might belong to, that client's first. */
  const openProjects = likelyProjects(db.projects(), form.supplier);

  /** That supplier's orders with something still to bill, so a bill can be tied to one. */
  const openOrders = ordersFor(form.supplier, db.documents(), db.expenses());

  const add = () => {
    if (!form.supplier.trim() || !form.net) return;
    db.saveExpense({
      date: form.date, supplier: form.supplier.trim(), description: form.description.trim() || undefined,
      category: form.category,
      // A bill paid abroad is kept in the currency it was billed in, with the rate that turns it
      // into the books' currency; the ledger does the conversion rather than the form.
      currency: foreignBill ? form.billCurrency.toUpperCase() : currency,
      netMinor: Math.round(form.net * 10 ** decimalsFor(foreignBill ? form.billCurrency.toUpperCase() : currency)),
      taxMinor: Math.round(form.tax * 10 ** decimalsFor(foreignBill ? form.billCurrency.toUpperCase() : currency)),
      ...(foreignBill && usableRate(form.fxRate) ? { fxRate: form.fxRate } : {}),
      paidFrom: form.paidFrom || undefined, reference: form.reference.trim() || undefined,
      orderId: form.orderId || undefined,
      projectId: form.projectId || undefined,
      rcmCategory: form.rcmCategory || undefined,
      supplierGstin: form.supplierGstin.trim().toUpperCase() || undefined,
      supplierPan: form.supplierPan.trim().toUpperCase() || undefined,
      supplierType: form.tdsSection ? form.supplierType : undefined,
      tdsSection: form.tdsSection || undefined,
      tdsMinor: form.tdsSection ? suggestedTds : undefined,
      receiptDataUrl: receipt?.dataUrl, receiptFileName: receipt?.fileName,
      ...(attachments.length ? { attachments } : {}),
      ...(form.category === STOCK_ACCOUNT && form.stockQuantity ? { stockQuantity: form.stockQuantity } : {})
    });
    setForm({ ...form, supplier: "", description: "", net: 0, tax: 0, reference: "", orderId: "", projectId: "", rcmCategory: "", supplierGstin: "", supplierPan: "", tdsSection: "" });
    setReceipt(null);
    setAttachments([]);
    setReadNote("");
  };

  if (!ready) return <div className="h-72 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const rows = db.expenses();
  const m = (minor: number) => formatMoney(fromMinor(minor, currency), "en-IN");
  const total = rows.reduce((a, e) => a + e.netMinor + e.taxMinor, 0);
  const reclaimable = rows.reduce((a, e) => a + e.taxMinor, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Money out</h1>
        <p className="mt-1 text-ink-soft">What the business spent. Each one goes into the books as you add it, so profit and cash stay right.</p>
      </div>

      <section className="card p-5">
        <h2 className="font-display text-lg">Add an expense</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="ex-date">Date</label><input id="ex-date" type="date" className="field" value={form.date} onChange={(e) => set({ date: e.target.value })} /></div>
          <div><label className="label" htmlFor="ex-supplier">Paid to</label><input id="ex-supplier" className="field" value={form.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="WeWork, Amazon, your landlord" /></div>
          <div>
            <label className="label" htmlFor="ex-category">What for</label>
            <select id="ex-category" className="field" value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              {keepingStock(db.items() as StockItem[]) ? <option value={STOCK_ACCOUNT}>Stock for resale</option> : null}
            </select>
          </div>
          <div><label className="label" htmlFor="ex-net">Amount before tax</label><input id="ex-net" type="number" step="any" className="field tabular" value={form.net || ""} onChange={(e) => set({ net: Number(e.target.value) })} /></div>
          <div><label className="label" htmlFor="ex-tax">Tax you can reclaim</label><input id="ex-tax" type="number" step="any" className="field tabular" value={form.tax || ""} onChange={(e) => set({ tax: Number(e.target.value) })} /></div>
          <div>
            <label className="label" htmlFor="ex-paid">Paid from</label>
            <select id="ex-paid" className="field" value={form.paidFrom} onChange={(e) => set({ paidFrom: e.target.value })}>
              {cashAccounts().map((a) => <option key={a.code} value={a.code}>{a.plain ?? a.name}</option>)}
              <option value="">Not paid yet, still owed</option>
            </select>
          </div>
          <div className="sm:col-span-2"><label className="label" htmlFor="ex-desc">Note</label><input id="ex-desc" className="field" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Office rent for May" /></div>
          <div><label className="label" htmlFor="ex-ref">Bill number</label><input id="ex-ref" className="field" value={form.reference} onChange={(e) => set({ reference: e.target.value })} /></div>
          {openProjects.length > 0 ? (
            <div>
              <label className="label" htmlFor="ex-project">Which job</label>
              <select id="ex-project" className="field" value={form.projectId} onChange={(e) => set({ projectId: e.target.value })}>
                <option value="">Not against a job</option>
                {openProjects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` — ${p.client}` : ""}</option>)}
              </select>
            </div>
          ) : null}
          {openOrders.length > 0 ? (
            <div>
              <label className="label" htmlFor="ex-order">Against an order</label>
              <select id="ex-order" className="field" value={form.orderId} onChange={(e) => set({ orderId: e.target.value })}>
                <option value="">Not against an order</option>
                {openOrders.map((o) => (
                  <option key={o.id} value={o.id}>{o.number} — {m(o.outstandingMinor)} still to bill</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-faint">Linking it lets the bill be checked against what you agreed to pay.</p>
            </div>
          ) : null}
          {(ws.profile?.country ?? "IN") === "IN" ? (
            <div>
              <label className="label" htmlFor="ex-gstin">Supplier GSTIN</label>
              <input id="ex-gstin" className="field" value={form.supplierGstin} onChange={(e) => set({ supplierGstin: e.target.value })} placeholder="29AAGCB7383J1Z4" />
              <p className={`mt-1 text-xs ${form.supplierGstin.trim() && !checkGstin(form.supplierGstin.trim()).valid ? "text-warn" : "text-ink-faint"}`}>
                {form.supplierGstin.trim() && !checkGstin(form.supplierGstin.trim()).valid
                  ? checkGstin(form.supplierGstin.trim()).says ?? "That GSTIN does not look right."
                  : "With this and the bill number, we can check the credit against the portal."}
              </p>
            </div>
          ) : null}
          {(ws.profile?.country ?? "IN") === "IN" ? (
            <>
              <div>
                <label className="label" htmlFor="ex-rcm">Who pays the GST</label>
                <select id="ex-rcm" className="field" value={form.rcmCategory} onChange={(e) => set({ rcmCategory: e.target.value })}>
                  <option value="">The supplier charged it on the bill</option>
                  {RCM_CATEGORIES.map((c) => <option key={c.id} value={c.id}>I owe it — {c.label.toLowerCase()}</option>)}
                </select>
                {form.rcmCategory ? (
                  <p className="mt-1 text-xs text-ink-soft">
                    {rcmById(form.rcmCategory)?.creditable
                      ? `You owe ${m(Math.round(Math.round(form.net * 100) * 0.18))} to the government on this, and claim the same amount back. It costs nothing in the end, but it has to be paid in cash — it cannot come out of credit you already hold.`
                      : `You owe ${m(Math.round(Math.round(form.net * 100) * 0.18))} to the government on this, and it cannot be claimed back. That is a real cost on top of the bill.`}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="label" htmlFor="ex-tds">Tax to hold back</label>
                <select id="ex-tds" className="field" value={form.tdsSection} onChange={(e) => set({ tdsSection: e.target.value })}>
                  <option value="">None — nothing to deduct</option>
                  {TDS_SECTIONS.map((sec) => <option key={sec.id} value={sec.id}>{sec.label} ({sec.id})</option>)}
                </select>
                {form.tdsSection ? (
                  <p className="mt-1 text-xs text-ink-soft">
                    {suggestedTds > 0
                      ? `Hold back ${m(suggestedTds)} and pay ${form.supplier.trim() || "them"} the rest. It is owed to the government by the seventh of next month.`
                      : "Nothing is due yet: this supplier has not passed the threshold for the year. We will say so when they do."}
                  </p>
                ) : null}
              </div>
              {form.tdsSection ? (
                <>
                  <div>
                    <label className="label" htmlFor="ex-pan">Supplier PAN</label>
                    <input id="ex-pan" className="field" value={form.supplierPan} onChange={(e) => set({ supplierPan: e.target.value })} placeholder="AAAPR1234C" />
                    {!form.supplierPan.trim() ? <p className="mt-1 text-xs text-warn">Without a PAN the rate is 20%, not the usual one.</p> : null}
                  </div>
                  <div>
                    <label className="label" htmlFor="ex-type">They are</label>
                    <select id="ex-type" className="field" value={form.supplierType} onChange={(e) => set({ supplierType: e.target.value as "individual" | "other" })}>
                      <option value="other">A company, firm or LLP</option>
                      <option value="individual">An individual or HUF</option>
                    </select>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          {form.category === STOCK_ACCOUNT ? (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="ex-qty">How many arrived</label>
              <input id="ex-qty" type="number" className="field tabular w-40" value={form.stockQuantity || ""} onChange={(e) => set({ stockQuantity: Number(e.target.value) })} />
              <p className="mt-1 text-xs text-ink-soft">
                Put the item&apos;s name in the note exactly as it appears in your catalogue, so this lands against the right thing. It stays an asset until it sells.
              </p>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(form.billCurrency)} onChange={(e) => set({ billCurrency: e.target.checked ? "USD" : "", fxRate: 0 })} />
              <span>This bill was in another currency</span>
            </label>
            {form.billCurrency ? (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div>
                  <label className="label" htmlFor="ex-cur">Billed in</label>
                  <input id="ex-cur" className="field w-28 uppercase" value={form.billCurrency} onChange={(e) => set({ billCurrency: e.target.value.toUpperCase().slice(0, 3) })} />
                </div>
                <div>
                  <label className="label" htmlFor="ex-fx">1 {form.billCurrency || "USD"} in {currency}</label>
                  <input id="ex-fx" type="number" step="0.0001" min="0" className="field tabular w-40" value={form.fxRate || ""} placeholder={lastRate ? String(lastRate.rate) : "83.2000"} onChange={(e) => set({ fxRate: Number(e.target.value) })} />
                </div>
                {!usableRate(form.fxRate) && lastRate ? (
                  <button type="button" className="btn-quiet text-sm" onClick={() => set({ fxRate: lastRate.rate })}>Use {lastRate.rate} from {lastRate.date}</button>
                ) : null}
                <p className="w-full text-xs text-ink-soft">
                  {usableRate(form.fxRate)
                    ? `Recorded as ${form.net ? (form.net * form.fxRate).toFixed(2) : "0.00"} ${currency} in your books.`
                    : `Without a rate this bill stays off your reports. Use the rate your card or bank charged you.`}
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <Attachments attachments={attachments} onChange={setAttachments} compact />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={add} disabled={!form.supplier.trim() || !form.net}><Plus size={16} />Add expense</button>

          {receipt ? (
            <span className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={receipt.dataUrl} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="max-w-[12rem] truncate">{receipt.fileName}</span>
              <button type="button" onClick={() => { setReceipt(null); setReadNote(""); }} className="text-ink-faint hover:text-bad" aria-label="Remove the receipt"><X size={14} /></button>
            </span>
          ) : (
            <label className="btn-ghost cursor-pointer">
              <Camera size={16} />Attach a bill
              <input ref={fileInput} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => void attach(e.target.files?.[0])} />
            </label>
          )}

          {reading ? <span className="flex items-center gap-1.5 text-sm text-ink-soft"><Loader2 size={15} className="animate-spin" />Reading it</span> : null}
        </div>

        {readNote ? <p className="mt-3 max-w-2xl text-sm text-ink-soft">{readNote}</p> : null}
      </section>

      {rows.length > 0 ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="card p-4"><dt className="text-[0.68rem] font-semibold uppercase tracking-wider text-ink-faint">Total spent</dt><dd className="tabular font-display text-2xl font-semibold">{m(total)}</dd></div>
            <div className="card p-4"><dt className="text-[0.68rem] font-semibold uppercase tracking-wider text-ink-faint">Tax you can reclaim</dt><dd className="tabular font-display text-2xl font-semibold">{m(reclaimable)}</dd></div>
            <div className="card p-4"><dt className="text-[0.68rem] font-semibold uppercase tracking-wider text-ink-faint">Still owed to suppliers</dt><dd className="tabular font-display text-2xl font-semibold">{m(rows.filter((e) => !e.paidFrom).reduce((a, e) => a + e.netMinor + e.taxMinor, 0))}</dd></div>
          </dl>

          <section className="card overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-canvas text-left">
                <tr><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Paid to</th><th className="px-4 py-2.5 font-semibold">What for</th><th className="px-4 py-2.5 text-right font-semibold">Amount</th><th className="px-4 py-2.5 font-semibold">Paid from</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="px-4 py-2.5 tabular text-ink-soft">{formatDate(e.date, ws.profile?.country ?? "IN")}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        {e.supplier}
                        {e.receiptDataUrl ? (
                          <a href={e.receiptDataUrl} target="_blank" rel="noopener noreferrer" className="text-ink-faint hover:text-ink" aria-label={`Bill for ${e.supplier}`} title="See the bill"><Paperclip size={13} /></a>
                        ) : null}
                      </span>
                      {e.description ? <span className="block text-xs text-ink-faint">{e.description}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{EXPENSE_CATEGORIES.find((c) => c.code === e.category)?.name}</td>
                    <td className="px-4 py-2.5 text-right tabular">{m(e.netMinor + e.taxMinor)}{e.taxMinor ? <span className="block text-xs text-ink-faint">{m(e.taxMinor)} tax</span> : null}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{e.paidFrom ? cashAccounts().find((a) => a.code === e.paidFrom)?.plain : <span className="text-warn">Still owed</span>}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => { if (confirm(`Delete the ${e.supplier} expense?`)) db.deleteExpense(e.id); }} className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-bad" aria-label={`Delete ${e.supplier}`}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}
