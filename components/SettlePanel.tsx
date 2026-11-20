"use client";
import { useState } from "react";
import { allowDiscount, paymentBounced, writeOff } from "@/lib/documents/settle";
import { owedOn } from "@/lib/documents/owed";
import { todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import type { SavedDocument } from "@/lib/store/types";
import type { Store } from "@/lib/store/db";

/**
 * Closing an invoice without full payment, or reopening it when a payment bounced. Each choice
 * says in words what it will do before it is done, because each one moves money in the books.
 */
type Mode = "discount" | "writeoff" | "bounce";

export default function SettlePanel({ doc, db, modes, onDone }: { doc: SavedDocument; db: Store; modes: Mode[]; onDone: (said: string) => void }) {
  const [mode, setMode] = useState<Mode>(modes[0]);
  const owed = owedOn(doc);
  const [amount, setAmount] = useState(() => String((modes[0] === "bounce" ? doc.paidMinor : owed) / 100));
  const [charges, setCharges] = useState("");
  const [on, setOn] = useState(todayIso());
  const [error, setError] = useState("");
  const m = (minor: number) => formatMoney(fromMinor(minor, doc.currency), "en-IN");
  const minor = Math.round((Number(amount.replace(/,/g, "")) || 0) * 100);

  const pick = (next: Mode) => {
    setMode(next); setError("");
    setAmount(String((next === "bounce" ? doc.paidMinor : owed) / 100));
  };

  const apply = () => {
    const r = mode === "discount" ? allowDiscount(doc, minor, on)
      : mode === "writeoff" ? writeOff(doc, on, undefined, minor)
        : paymentBounced(doc, minor, on, Math.round((Number(charges) || 0) * 100));
    if (!r.ok) { setError(r.says); return; }
    try {
      db.saveDocument(r.doc);
      onDone(mode === "discount" ? `${doc.number} settled, with ${m(minor)} allowed as a discount.`
        : mode === "writeoff" ? `${m(minor)} on ${doc.number} written off as a bad debt.`
          : `${doc.number} is owed again: ${m(minor)} came back unpaid.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    }
  };

  const LABELS: Record<Mode, string> = { discount: "They paid less: let the rest go", writeoff: "They will not pay", bounce: "A payment bounced" };
  const SAYS: Record<Mode, string> = {
    discount: `The rest is recorded as a discount allowed, and ${doc.number} is closed.`,
    writeoff: "Recorded as a bad debt, a cost of the business, and the invoice is closed. GST already paid on it can only be got back by a credit note.",
    bounce: "The invoice is owed again, the bank shows the money going back out, and any bank charge is a cost."
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      {modes.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What happened">
          {modes.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => pick(v)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === v ? "border-forest bg-forest text-white" : "border-line bg-white text-ink-soft"}`}>{LABELS[v]}</button>
          ))}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="label">{mode === "discount" ? "Discount" : mode === "writeoff" ? "Write off" : "Came back"}</span>
          <input className="field tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block text-sm"><span className="label">On</span><input type="date" className="field" value={on} onChange={(e) => setOn(e.target.value)} /></label>
        {mode === "bounce" ? (
          <label className="block text-sm"><span className="label">Bank charges</span><input className="field tabular" inputMode="decimal" placeholder="0" value={charges} onChange={(e) => setCharges(e.target.value)} /></label>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-ink-soft">{SAYS[mode]}</p>
      {error ? <p role="alert" className="mt-2 text-sm text-bad">{error}</p> : null}
      <button type="button" className="btn-primary mt-3" onClick={apply}>Record it</button>
    </div>
  );
}
