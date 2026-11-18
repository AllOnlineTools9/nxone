"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { PACKS, packFor } from "@/lib/countries/packs";
import { hsnByCode, rateFor, ruleIdForRate } from "@/lib/countries/hsn";
import SignatureBox from "./SignatureBox";
import SupplyType from "./SupplyType";
import ExportBox from "./ExportBox";
import ClientPicker from "./ClientPicker";
import ItemPicker from "./ItemPicker";
import PaymentBox from "./PaymentBox";
import { likelyProjects } from "@/lib/analysis/projects";
import { store } from "@/lib/store/db";
import { kindConfig } from "@/lib/documents/kinds";
import HsnPicker from "./HsnPicker";
import { rulesOn } from "@/lib/countries/types";
import { describeRate, knownRates, usableRate } from "@/lib/fx";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";
import type { DocumentData, DocumentTotals, LineItem } from "@/lib/documents/types";
import type { SavedDocument } from "@/lib/store/types";
import { formatMoney } from "@/lib/money";

interface Props {
  /** Set once the document has been saved, so a payment link can point at it. */
  documentId?: string;
  doc: DocumentData;
  totals: DocumentTotals;
  update: (patch: Partial<DocumentData>) => void;
  updateItem: (id: string, patch: Partial<LineItem>) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, dir: -1 | 1) => void;
  setCountry: (code: string) => void;
}

export default function Editor({ doc, totals, update, updateItem, addItem, removeItem, moveItem, setCountry, documentId }: Props) {
  const jobs = likelyProjects(store.projects(), doc.buyer.name);
  const chargesNoTax = Boolean(doc.noGst || doc.composition);
  const [ws, db] = useWorkspace();
  const hydrated = useHydrated();
  const pack = packFor(doc.country);
  const rules = rulesOn(pack, doc.issueDate);
  const interRegion = totals.supply.interRegion;
  const kind = kindConfig(doc.kind);

  /**
   * Once the code and the price are both known, the rate follows from them. Apparel at 2,400 a piece
   * is 5% and the same shirt at 2,600 is 18%, so this is recalculated whenever either changes.
   */
  const autoTax = (code: string | undefined, unitRate: number) => {
    if (pack.code !== "IN" || !code) return {};
    const entry = hsnByCode(code);
    if (!entry) return {};
    const { rate } = rateFor(entry, unitRate, doc.issueDate);
    const ruleId = ruleIdForRate(rate, interRegion);
    return ruleId ? { taxRuleId: ruleId } : {};
  };

  const rateNote = (code: string | undefined, unitRate: number) => {
    if (pack.code !== "IN" || !code) return undefined;
    const entry = hsnByCode(code);
    return entry ? rateFor(entry, unitRate, doc.issueDate).reason : undefined;
  };

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update({ logoDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* On a phone the form is long and your own details rarely change, so these jump straight to
          the parts filled in every time. */}
      <nav aria-label="Jump to" className="no-print -mb-2 flex gap-2 overflow-x-auto lg:hidden">
        {[["#ed-customer", doc.kind === "purchase-order" ? "Supplier" : "Customer"], ["#ed-items", "Items"], ["#ed-more", "Notes and payment"], ["#send", "Send"]].map(([href, label]) => (
          <a key={href} href={href} className="chip shrink-0 px-3 py-1.5 text-sm">{label}</a>
        ))}
      </nav>

      <section className="card p-5">
        <h2 className="font-display text-lg">Where you trade</h2>
        <p className="mt-1 text-sm text-ink-soft">Pick your country and we set the currency, the tax and the document layout to match.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="country">Country</label>
            <select id="country" className="field" value={doc.country} onChange={(e) => setCountry(e.target.value)}>
              {PACKS.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
            {pack.support !== "supported" && (
              <p className="mt-1 text-xs text-warn">{pack.support === "partial" ? "Partly configured: check the rate you choose." : "No tax rules configured for this country yet."}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <input id="currency" className="field uppercase" value={doc.currency} onChange={(e) => update({ currency: e.target.value.toUpperCase().slice(0, 3) })} />
          </div>
          {hydrated && ws.profile?.currency && ws.profile.currency !== doc.currency ? (
            <ExchangeRate doc={doc} base={ws.profile.currency} documents={db.documents()} update={update} />
          ) : null}
          {pack.regions?.length ? (
            <>
              <div>
                <label className="label" htmlFor="sellerRegion">Your state</label>
                <select id="sellerRegion" className="field" value={doc.seller.region || ""} onChange={(e) => update({ seller: { ...doc.seller, region: e.target.value } })}>
                  <option value="">Select</option>
                  {pack.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="pos">Place of supply</label>
                <select id="pos" className="field" value={doc.placeOfSupply || ""} onChange={(e) => update({ placeOfSupply: e.target.value })}>
                  <option value="">Select</option>
                  {pack.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
                {doc.placeOfSupply && doc.seller.region ? (
                  <p className="mt-1 text-xs text-ink-faint">{interRegion ? "Different state, so IGST applies." : `Same state, so CGST and ${totals.supply.stateTaxLabel} apply.`}</p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </section>

      {kind.showDelivery ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Delivery</h2>
          <p className="mt-1 text-sm text-ink-soft">Where the goods should arrive and by when. This is the part suppliers actually read.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Area label="Deliver to" value={doc.shipTo || ""} onChange={(v) => update({ shipTo: v })} placeholder="Warehouse address, gate number, contact person" />
            <Field label="Required by" value={doc.deliveryDate || ""} onChange={(v) => update({ deliveryDate: v })} type="date" />
          </div>
        </section>
      ) : null}

      {kind.showPaymentReceived ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">How you were paid</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="paymethod">Method</label>
              <select id="paymethod" className="field" value={doc.paymentMethod || ""} onChange={(e) => update({ paymentMethod: e.target.value })}>
                <option value="">Select</option>
                {["Bank transfer", "UPI", "Cash", "Cheque", "Card", "Wallet", "Other"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <Field label="Reference or transaction id" value={doc.paymentReference || ""} onChange={(v) => update({ paymentReference: v })} placeholder="UTR, cheque number or UPI reference" />
          </div>
        </section>
      ) : null}

      {pack.code === "IN" ? <ExportBox doc={doc} update={update} /> : null}
      {pack.code === "IN" ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">GST</h2>
          {doc.composition ? (
            <p className="mt-1 text-sm text-ink-soft">
              You are on the composition scheme, so no GST is charged and this is a bill of supply.
            </p>
          ) : (
            <>
              <label className="mt-2 flex items-center gap-3 text-sm">
                <input
                  type="checkbox" className="h-4 w-4"
                  checked={!doc.noGst}
                  onChange={(e) => update({ noGst: e.target.checked ? undefined : true })}
                />
                Charge GST on this {kind.title.toLowerCase()}
              </label>
              <p className="mt-1 text-xs text-ink-faint">
                {doc.noGst
                  ? "No GST is added to any line, and an invoice is titled Invoice rather than Tax Invoice. Right for a business that is not registered for GST."
                  : "Untick if your business is not registered for GST. Each line keeps its rate, so ticking it again puts them back."}
              </p>
            </>
          )}
        </section>
      ) : null}
      {pack.code === "IN" && !doc.export?.enabled && !doc.noGst && !doc.composition ? <SupplyType doc={doc} totals={totals} update={update} /> : null}

      <section className="card p-5">
        <h2 className="font-display text-lg">Your details</h2>
        <p className="mt-1 text-sm text-ink-soft">This is the part your customer will use to pay you, so include a phone number or email if you want to be chased less.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field group="seller" label="Business name" value={doc.seller.name} onChange={(v) => update({ seller: { ...doc.seller, name: v } })} placeholder="Acme Consulting" />
          <Field group="seller" label={pack.taxIdLabel} value={doc.seller.taxId || ""} onChange={(v) => update({ seller: { ...doc.seller, taxId: v } })} placeholder={pack.code === "IN" ? "27AAPFU0939F1ZV" : ""} />
          <Area group="seller" label="Address" value={doc.seller.address || ""} onChange={(v) => update({ seller: { ...doc.seller, address: v } })} />
          <div className="grid gap-4">
            <Field group="seller" label="Email" value={doc.seller.email || ""} onChange={(v) => update({ seller: { ...doc.seller, email: v } })} type="email" placeholder="billing@yourbusiness.com" />
            <Field group="seller" label="Phone" value={doc.seller.phone || ""} onChange={(v) => update({ seller: { ...doc.seller, phone: v } })} placeholder="+91 98200 00000" />
            <Field group="seller" label="Website" value={doc.seller.website || ""} onChange={(v) => update({ seller: { ...doc.seller, website: v } })} placeholder="yourbusiness.com" />
          </div>
          <div className="sm:col-span-2">
            <span className="label">Logo</span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="btn-ghost cursor-pointer">Choose image<input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => onLogo(e.target.files?.[0])} /></label>
              {doc.logoDataUrl ? <button type="button" className="btn-quiet" onClick={() => update({ logoDataUrl: undefined })}>Remove logo</button> : <span className="text-sm text-ink-faint">PNG or JPG. It goes straight into the PDF.</span>}
            </div>
          </div>
        </div>
      </section>

      <section id="ed-customer" className="card scroll-mt-40 p-5">
        <h2 className="font-display text-lg">{doc.kind === "purchase-order" ? "Supplier" : "Customer"}</h2>
        <div className="mt-3"><ClientPicker doc={doc} update={update} /></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field group="buyer" label="Name" value={doc.buyer.name} onChange={(v) => update({ buyer: { ...doc.buyer, name: v } })} placeholder="Customer name" />
          <Field group="buyer" label={pack.taxIdLabel} value={doc.buyer.taxId || ""} onChange={(v) => update({ buyer: { ...doc.buyer, taxId: v } })} />
          <Area group="buyer" label="Address" value={doc.buyer.address || ""} onChange={(v) => update({ buyer: { ...doc.buyer, address: v } })} />
          <Field group="buyer" label="Email" value={doc.buyer.email || ""} onChange={(v) => update({ buyer: { ...doc.buyer, email: v } })} type="email" />
          <Field group="buyer" label="Phone" value={doc.buyer.phone || ""} onChange={(v) => update({ buyer: { ...doc.buyer, phone: v } })} />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-display text-lg">Dates and numbering</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Number" value={doc.number} onChange={(v) => update({ number: v })} />
          <Field label="Date" value={doc.issueDate} onChange={(v) => update({ issueDate: v })} type="date" />
          {kind.secondDateLabel ? <Field label={kind.secondDateLabel} value={doc.dueDate || ""} onChange={(v) => update({ dueDate: v })} type="date" /> : null}
          <Field label="Reference (optional)" value={doc.reference || ""} onChange={(v) => update({ reference: v })} />
          {doc.kind === "invoice" ? <Field label="Their order number (optional)" value={doc.buyerOrderRef || ""} onChange={(v) => update({ buyerOrderRef: v })} /> : null}
        </div>
      </section>

      <section id="ed-items" className="card scroll-mt-40 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Items</h2>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={doc.taxInclusive} onChange={(e) => update({ taxInclusive: e.target.checked })} />
            Prices include {pack.taxLabel.toLowerCase()}
          </label>
        </div>

        <ul className="mt-4 space-y-4">
          {doc.items.map((item, i) => {
            const line = totals.lines.find((l) => l.id === item.id);
            return (
              <li key={item.id} className="rounded-lg border border-line p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
                  <div className="col-span-2 sm:col-span-12"><ItemPicker item={item} onPick={(patch) => updateItem(item.id, { ...patch, ...autoTax(patch.code ?? item.code, patch.rate ?? item.rate) })} /></div>
                  <div className="col-span-2 sm:col-span-12">
                    <label className="label" htmlFor={`d-${item.id}`}>Description</label>
                    <input id={`d-${item.id}`} className="field" value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} placeholder="What are you charging for?" />
                  </div>
                  <Num className="sm:col-span-2" label="Qty" value={item.quantity} onChange={(v) => updateItem(item.id, { quantity: v })} />
                  <Num className="sm:col-span-3" label={`Rate (${doc.currency})`} value={item.rate} onChange={(v) => updateItem(item.id, { rate: v, ...autoTax(item.code, v) })} />
                  <Num className="sm:col-span-2" label="Disc %" value={item.discountPct ?? 0} onChange={(v) => updateItem(item.id, { discountPct: v || undefined })} />
                  <div className={`sm:col-span-3 ${chargesNoTax ? "hidden" : ""}`}>
                    <label className="label" htmlFor={`t-${item.id}`}>{pack.taxLabel}</label>
                    <select id={`t-${item.id}`} className="field" value={item.taxRuleId || ""} onChange={(e) => updateItem(item.id, { taxRuleId: e.target.value || undefined })}>
                      <option value="">No {pack.taxLabel.toLowerCase()}</option>
                      {rules.filter((r) => !r.appliesWhen || r.appliesWhen === "always" || (interRegion ? r.appliesWhen === "inter-region" : r.appliesWhen === "intra-region")).map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-2">
                    <span className="pb-2 text-sm tabular text-ink-soft">{line ? formatMoney(line.total, pack.locale) : ""}</span>
                  </div>
                  {item.taxRuleId && (rules.find((r) => r.id === item.taxRuleId)?.status === "draft") ? (
                    <Num className="sm:col-span-3" label="Tax rate %" value={item.taxRateOverride ?? 0} onChange={(v) => updateItem(item.id, { taxRateOverride: v })} />
                  ) : null}
                  {rateNote(item.code, item.rate) ? <p className="col-span-2 text-xs text-ink-soft sm:col-span-12">{rateNote(item.code, item.rate)}</p> : null}
                  {pack.code === "IN" ? (
                    <div className="col-span-2 sm:col-span-6">
                      <HsnPicker
                        value={item.code}
                        description={item.description}
                        onPick={(entry) => updateItem(item.id, { code: entry.code, ...autoTax(entry.code, item.rate) })}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <button type="button" className="btn-quiet px-3 py-2.5 sm:px-2 sm:py-1" onClick={() => moveItem(item.id, -1)} disabled={i === 0} aria-label="Move item up"><ArrowUp size={15} /></button>
                  <button type="button" className="btn-quiet px-3 py-2.5 sm:px-2 sm:py-1" onClick={() => moveItem(item.id, 1)} disabled={i === doc.items.length - 1} aria-label="Move item down"><ArrowDown size={15} /></button>
                  <button type="button" className="btn-quiet ml-auto px-3 py-2.5 sm:px-2 sm:py-1 hover:text-bad" onClick={() => removeItem(item.id)} disabled={doc.items.length === 1} aria-label="Remove item"><Trash2 size={15} /></button>
                </div>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn-ghost mt-4" onClick={addItem}><Plus size={16} />Add item</button>
      </section>

      {jobs.length > 0 ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Which contract</h2>
          <p className="mt-1 text-sm text-ink-soft">Tagging it lets this document count towards that contract&apos;s figures.</p>
          <select
            className="field mt-3 max-w-sm" value={doc.projectId ?? ""}
            onChange={(e) => update({ projectId: e.target.value || undefined })}
          >
            <option value="">Not against a contract</option>
            {jobs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` - ${p.client}` : ""}</option>)}
          </select>
        </section>
      ) : null}
      {kind.showPaymentDetails ? <PaymentBox doc={doc} update={update} totals={totals} documentId={documentId} /> : null}

      <SignatureBox doc={doc} update={update} />

      <section id="ed-more" className="card scroll-mt-40 p-5">
        <h2 className="font-display text-lg">Anything else</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Num label="Discount on total %" value={doc.discountPct ?? 0} onChange={(v) => update({ discountPct: v || undefined })} />
          <Num label={`Shipping (${doc.currency})`} value={doc.shipping ?? 0} onChange={(v) => update({ shipping: v || undefined })} />
          {kind.showPaidAndBalance ? <Num label={`Amount already paid (${doc.currency})`} value={doc.amountPaid ?? 0} onChange={(v) => update({ amountPaid: v || undefined })} /> : null}
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-soft sm:col-span-3">
            <input type="checkbox" checked={Boolean(doc.roundOff)} onChange={(e) => update({ roundOff: e.target.checked })} />
            Round the total to a whole {doc.currency}
          </label>
          {kind.showPaymentDetails ? <Area label="Payment details" value={doc.paymentDetails || ""} onChange={(v) => update({ paymentDetails: v })} placeholder="Bank name, account number, IFSC or IBAN, UPI id" /> : null}
          <Area label="Notes" value={doc.notes || ""} onChange={(v) => update({ notes: v })} />
          <Area label="Terms" value={doc.terms || ""} onChange={(v) => update({ terms: v })} />
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", group = "f" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; group?: string }) {
  const id = `${group}-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return <div><label className="label" htmlFor={id}>{label}</label><input id={id} type={type} className="field" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Area({ label, value, onChange, placeholder, group = "a" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; group?: string }) {
  const id = `${group}-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return <div><label className="label" htmlFor={id}>{label}</label><textarea id={id} className="field min-h-[5rem]" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Num({ label, value, onChange, className = "" }: { label: string; value: number; onChange: (v: number) => void; className?: string }) {
  const id = `n-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="decimal" step="any" className="field tabular" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
    </div>
  );
}

/**
 * The rate, asked for only when it is actually needed.
 *
 * A business billing in its own currency never sees this. One billing abroad is asked once per
 * invoice, with the last rate it used offered as a starting point and labelled as exactly that -
 * a starting point, from a date, not a quotation. NXOne has no rate feed and says so rather than
 * implying the number came from somewhere authoritative.
 */
function ExchangeRate({ doc, base, documents, update }: { doc: DocumentData; base: string; documents: SavedDocument[]; update: (patch: Partial<DocumentData>) => void }) {
  const last = knownRates(documents, base)[doc.currency];
  const current = doc.fxRate;
  const showing = usableRate(current) ? current : undefined;

  return (
    <div className="sm:col-span-2">
      <label className="label" htmlFor="fxRate">
        What 1 {doc.currency} is worth in {base}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="fxRate" type="number" step="0.0001" min="0" className="field tabular w-48"
          value={showing ?? ""} placeholder={last ? String(last.rate) : "83.2000"}
          onChange={(e) => update({ fxRate: e.target.value === "" ? undefined : Number(e.target.value) })}
        />
        {!showing && last ? (
          <button type="button" className="btn-quiet text-sm" onClick={() => update({ fxRate: last.rate })}>
            Use {last.rate} from {last.date}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        {showing
          ? `${describeRate({ from: doc.currency, to: base, rate: showing, source: "recorded" })}. Your books are kept in ${base}, and this is the rate they will use for this invoice.`
          : `Your books are kept in ${base}. Without this rate the invoice stays off your reports, cash and returns. Use the rate your bank gave you - NXOne has no rate feed and will not make one up.`}
      </p>
    </div>
  );
}
