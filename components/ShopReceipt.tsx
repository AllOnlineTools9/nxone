"use client";
import { calculate } from "@/lib/documents/totals";
import { formatMoney, fromMinor } from "@/lib/money";
import type { ShopSettings } from "@/lib/shop/sale";
import type { SavedDocument } from "@/lib/store/types";

/**
 * The receipt for a thermal printer, 58 or 80 mm wide. It is on the page but only printed: when
 * the shop prints, everything else is hidden and the paper is set to the receipt's width, so the
 * browser's print dialog sends just this to the printer.
 */
export default function ShopReceipt({ sale, settings }: { sale: SavedDocument; settings: ShopSettings }) {
  const d = sale.doc;
  const t = calculate(d);
  const cur = d.currency;
  const m = (minor: number) => formatMoney(fromMinor(minor, cur), cur === "INR" ? "en-IN" : "en-US");
  const width = settings.paper === "58" ? "58mm" : "80mm";
  const small = settings.paper === "58";
  const title = d.noGst ? "Bill" : d.composition ? "Bill of Supply" : d.country === "IN" ? "Tax Invoice" : "Receipt";
  const time = new Date(sale.createdAt || Date.now()).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <style>{`
        .shop-receipt { display: none; }
        @media print {
          @page { size: ${width} auto; margin: 0; }
          body * { visibility: hidden !important; }
          .shop-receipt, .shop-receipt * { visibility: visible !important; }
          .shop-receipt { display: block; position: absolute; left: 0; top: 0; width: ${width}; padding: 3mm ${small ? "2mm" : "4mm"};
            font: ${small ? "10px" : "11.5px"}/1.35 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; color: #000; background: #fff; }
          .shop-receipt hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
          .shop-receipt .row { display: flex; justify-content: space-between; gap: 6px; }
          .shop-receipt .c { text-align: center; }
          .shop-receipt .b { font-weight: 700; }
          .shop-receipt .big { font-size: 1.35em; }
        }
      `}</style>
      <div className="shop-receipt" aria-hidden="true">
        <div className="c b big">{d.seller.name}</div>
        {d.seller.address ? <div className="c">{d.seller.address.split("\n").map((l) => <div key={l}>{l}</div>)}</div> : null}
        {d.seller.phone ? <div className="c">Ph {d.seller.phone}</div> : null}
        {d.seller.taxId ? <div className="c">GSTIN {d.seller.taxId}</div> : null}
        <hr />
        <div className="c b">{title}</div>
        <div className="row"><span>No. {d.number}</span><span>{d.issueDate.split("-").reverse().join("/")} {time}</span></div>
        {d.buyer.name && d.buyer.name !== "Walk-in customer" ? <div>To: {d.buyer.name}{d.buyer.taxId ? ` (${d.buyer.taxId})` : ""}</div> : null}
        <hr />
        {d.items.map((l, i) => (
          <div key={l.id}>
            <div>{l.description}</div>
            <div className="row"><span>{l.quantity} x {m(Math.round(l.rate * 100))}</span><span>{m(t.lines[i]?.total.minor ?? 0)}</span></div>
          </div>
        ))}
        <hr />
        <div className="row"><span>Taxable</span><span>{m(t.taxableTotal.minor)}</span></div>
        {t.taxRows.map((r) => <div key={r.label} className="row"><span>{r.label}</span><span>{m(r.tax.minor)}</span></div>)}
        {t.roundOff.minor ? <div className="row"><span>Round off</span><span>{m(t.roundOff.minor)}</span></div> : null}
        <div className="row b big"><span>TOTAL</span><span>{m(t.total.minor)}</span></div>
        <hr />
        <div className="row"><span>Paid by {sale.sale?.mode === "upi" ? "UPI" : sale.sale?.mode ?? "cash"}</span><span>{m(sale.totalMinor)}</span></div>
        {sale.sale?.tenderedMinor ? (
          <>
            <div className="row"><span>Cash given</span><span>{m(sale.sale.tenderedMinor)}</span></div>
            <div className="row"><span>Change</span><span>{m(Math.max(0, sale.sale.tenderedMinor - sale.totalMinor))}</span></div>
          </>
        ) : null}
        {d.taxInclusive ? <div className="c">Prices include GST</div> : null}
        {settings.footer ? <><hr /><div className="c">{settings.footer}</div></> : null}
      </div>
    </>
  );
}
