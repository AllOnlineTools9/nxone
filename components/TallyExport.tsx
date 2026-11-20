"use client";
import { AlertTriangle, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { makeZip } from "@/lib/files/zip";
import { tallyExport, tallyFiles, type TallyInput } from "@/lib/reports/tally";
import { todayIso } from "@/lib/format";
import { financialYear, monthPeriod, quarterPeriod } from "@/lib/store/reports";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * The period's books as files Tally imports, for an accountant who works in Tally. Ledgers and
 * vouchers are separate files because Tally imports them separately, masters first.
 */
export default function TallyExport() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [when, setWhen] = useState(() => todayIso().slice(0, 7));
  const [span, setSpan] = useState<"month" | "quarter" | "year">("year");
  const [done, setDone] = useState(false);

  const built = useMemo(() => {
    if (!ready || !ws.profile) return undefined;
    const anchor = `${when}-15`;
    const period = span === "month" ? monthPeriod(anchor) : span === "quarter" ? quarterPeriod(anchor) : financialYear(anchor);
    const input: TallyInput = { profile: ws.profile, documents: db.documents(), expenses: db.expenses(), entries: db.entries(), period };
    return { input, result: tallyExport(input) };
  }, [ready, ws, when, span]);

  if (!ready || !built) return null;
  const { input, result } = built;
  const c = result.counts;
  const total = c.sales + c.creditNotes + c.receipts + c.purchases + c.payments + c.journals + c.contras;

  const download = () => {
    const bytes = makeZip(tallyFiles(result, input));
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tally-${input.period.from}-to-${input.period.to}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setDone(true);
  };

  return (
    <section className="card p-5">
      <h2 className="font-display text-lg">For an accountant on Tally</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Sales, credit notes, receipts, purchases and payments as Tally vouchers, with the customer,
        supplier, tax and bank ledgers they need. Your accountant imports them in two steps instead
        of typing each one in.
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
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">{span === "month" ? "Which month" : "A month inside it"}</span>
          <input type="month" className="field mt-1" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <span className="pb-2 text-sm text-ink-soft">{input.period.label ?? `${input.period.from} to ${input.period.to}`}</span>
      </div>

      <p className="mt-4 text-sm">
        {total
          ? `${c.sales} sales, ${c.creditNotes} credit notes, ${c.receipts} receipts, ${c.purchases} purchases, ${c.payments} payments and ${c.journals + c.contras} other entries, using ${c.ledgers} ledgers.`
          : "Nothing in this period yet."}
      </p>

      {result.notes.length ? (
        <details className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 text-warn"><AlertTriangle size={15} />{result.notes.length} thing{result.notes.length === 1 ? "" : "s"} for your accountant to check</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="mt-2 text-xs text-ink-faint">These are also in the read-me inside the download.</p>
        </details>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={download} disabled={!total}>
          <Download size={16} />{done ? "Download it again" : "Download for Tally"}
        </button>
        <span className="text-sm text-ink-soft">
          In Tally: Import, Masters, 1-ledgers.xml. Then Import, Transactions, 2-vouchers.xml.
        </span>
      </div>
    </section>
  );
}
