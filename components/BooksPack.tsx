"use client";
import { Check, Copy, Download, Mail, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { makeZip } from "@/lib/files/zip";
import { packFileName, packFiles, packMessage, type PackInput } from "@/lib/reports/pack";
import { mailtoLink, todayIso, whatsappLink } from "@/lib/format";
import { monthPeriod, financialYear, quarterPeriod } from "@/lib/store/reports";
import { ledgerFor } from "@/lib/ledger/posting";
import { openingOf } from "@/lib/ledger/opening";
import type { StockItem } from "@/lib/stock/ledger";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * The books, as one folder an accountant can open.
 *
 * The accountant is the second user of this product and until now had no door in: they would be
 * walked through four screens and four separate downloads. One attachment, one covering note,
 * and figures in the message itself so a phone is enough to see whether anything looks wrong.
 */
export default function BooksPack() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [when, setWhen] = useState(() => todayIso().slice(0, 7));
  const [span, setSpan] = useState<"month" | "quarter" | "year">("month");
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  const input = useMemo<PackInput | undefined>(() => {
    if (!ready || !ws.profile) return undefined;
    const anchor = `${when}-15`;
    const period = span === "month" ? monthPeriod(anchor) : span === "quarter" ? quarterPeriod(anchor) : financialYear(anchor);
    const currency = ws.profile.currency ?? "INR";
    return {
      businessName: ws.profile.name || "This business",
      taxId: ws.profile.taxId,
      country: ws.profile.country ?? "IN",
      currency,
      period,
      // The same ledger the Books screen draws, opening balance and stock included. A pack
      // that quietly built its own would disagree with the screen the person checked it against.
      entries: ledgerFor(db.documents(), db.expenses(), currency, openingOf(ws.profile), { items: db.items() as StockItem[] }),
      documents: db.documents(),
      expenses: db.expenses(),
      preparedOn: todayIso()
    };
  }, [ready, ws, when, span]);

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;
  if (!input) return null;

  const message = packMessage(input);
  const files = packFiles(input);

  const download = () => {
    const bytes = makeZip(files);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = packFileName(input);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setDone(true);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the text is on screen to copy by hand */ }
  };

  return (
    <section className="card p-5">
      <h2 className="font-display text-lg">Send the books to your accountant</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        One folder holding the profit and loss, the balance sheet, the trial balance, every posting
        behind them and the documents they came from — as CSV, which every accounting package imports.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">Period</span>
          <select className="field mt-1" value={span} onChange={(e) => setSpan(e.target.value as typeof span)}>
            <option value="month">A month</option>
            <option value="quarter">A quarter</option>
            <option value="year">A financial year</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
            {span === "month" ? "Which month" : span === "quarter" ? "A month inside it" : "A month inside it"}
          </span>
          <input type="month" className="field mt-1" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <span className="pb-2 text-sm text-ink-soft">{input.period.label ?? `${input.period.from} to ${input.period.to}`}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={download}>
          <Download size={16} /> {done ? "Download it again" : "Download the folder"}
        </button>
        <a className={done ? "btn-primary" : "btn-ghost"} href={mailtoLink("", message.subject, message.body)}>
          <Mail size={16} /> Write the email
        </a>
        <a className="btn-ghost" href={whatsappLink("", message.short)} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={16} /> Send on WhatsApp
        </a>
        <button type="button" className="btn-quiet" onClick={copy}>
          {copied ? <><Check size={15} className="text-ok" />Copied</> : <><Copy size={15} />Copy the message</>}
        </button>
      </div>

      <p className="mt-3 text-sm text-ink-soft">
        {done
          ? "The folder is saved. Attach it to the email — that is the one thing we cannot do for you."
          : "Download the folder first, then attach it to the email."}
      </p>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-ink-soft">What is in it, and what it says</summary>
        <ul className="mt-2 space-y-1 text-sm">
          {files.map((f) => <li key={f.name} className="tabular text-ink-soft">{f.name.split("/")[1]}</li>)}
        </ul>
        <p className="mt-3 text-xs font-medium uppercase tracking-wider text-ink-faint">Message</p>
        <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-sm">{message.body}</pre>
      </details>
    </section>
  );
}
