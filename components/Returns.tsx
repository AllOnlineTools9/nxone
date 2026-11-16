"use client";
import { AlertTriangle, Download, Info, Lock } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { checksFor, verdictOf } from "@/lib/returns/checks";
import { gstr1Csvs, gstr1Json, gstr3bCsv } from "@/lib/returns/export";
import { suggestedLock } from "@/lib/books/lock";
import { formatDate } from "@/lib/format";
import { store } from "@/lib/store/db";
import { gstr1, returnPeriod } from "@/lib/returns/gstr1";
import { gstr3b } from "@/lib/returns/gstr3b";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * The monthly return, prepared.
 *
 * The filing calendar already says GSTR-1 is due on the eleventh. This is the part that was
 * missing: the same sales, sorted into the boxes the return asks for, with the things that would
 * be rejected listed before anything is downloaded.
 *
 * Nothing is filed from here. The portal is where a return is signed, and the offline utility
 * checks what it is given — a check worth keeping. What this removes is the evening of copying.
 */
export default function Returns() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [month, setMonth] = useState(() => lastMonth(todayIso()));

  const currency = ws.profile?.currency ?? "INR";
  const period = useMemo(() => returnPeriod(`${month}-15`), [month]);
  const [closed, setClosed] = useState(false);

  const prepared = useMemo(() => {
    const documents = db.documents();
    const expenses = db.expenses();
    const one = gstr1(documents, ws.profile, period);
    return {
      one,
      three: gstr3b(one, expenses, { currency }),
      findings: checksFor({ documents, expenses, profile: ws.profile, period, return: one, currency })
    };
    // the workspace changes whenever anything is saved, which is exactly when this should rerun
  }, [ws, db, period, currency]);

  if (!ready) return <div className="h-72 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const country = (ws.profile?.country ?? "IN").toUpperCase();
  if (country !== "IN") {
    return (
      <div className="card p-6">
        <h1 className="text-2xl font-semibold">GST returns</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          This prepares the Indian GST returns, and your business is set to {country}. The filing calendar still tracks what you owe where you are.
        </p>
        <Link href="/compliance/" className="btn-ghost mt-4">Filing calendar</Link>
      </div>
    );
  }

  const { one, three, findings } = prepared;
  const verdict = verdictOf(findings);
  const m = (minor: number) => formatMoney(fromMinor(minor, currency), "en-IN");
  const files = gstr1Csvs(one);

  const save = (name: string, body: string, type = "text/csv") => {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">GST returns</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">
            Your own invoices, sorted into the boxes GSTR-1 and GSTR-3B ask for. Nothing is filed from here.
          </p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Period</span>
          <input type="month" className="field w-44 tabular" value={month} max={lastMonth(todayIso())}
            onChange={(e) => setMonth(e.target.value || lastMonth(todayIso()))} />
        </label>
      </div>

      {/* ---- is it fit to file ---- */}
      <section className={`rounded-xl border p-5 ${verdict.ready ? "border-forest bg-forest-pale" : "border-bad/30 bg-bad/5"}`}>
        <h2 className={`font-display text-xl ${verdict.ready ? "" : "text-bad"}`}>{verdict.says}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {one.totals.documents} document{one.totals.documents === 1 ? "" : "s"} in {period.label}, {m(one.totals.taxableMinor)} of taxable value and {m(one.totals.taxMinor)} of tax.
        </p>

        {findings.length ? (
          <ul className="mt-4 space-y-3">
            {findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-line bg-white p-4">
                <div className="flex gap-2.5">
                  {f.severity === "stop"
                    ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden="true" />
                    : <Info size={16} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className="font-medium">{f.title}</p>
                    <p className="mt-0.5 text-sm text-ink-soft">{f.detail}</p>
                    {f.documents?.length ? (
                      <p className="mt-1.5 text-xs text-ink-faint">
                        {f.documents.slice(0, 8).map((d) => `${d.number} (${d.clientName})`).join(", ")}
                        {f.documents.length > 8 ? ` and ${f.documents.length - 8} more` : ""}
                      </p>
                    ) : null}
                    {f.action ? <Link href={f.action.href} className="mt-2 inline-block text-sm font-medium underline">{f.action.label}</Link> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ---- GSTR-1 ---- */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="font-display text-lg">GSTR-1 for {period.label}</h2>
            <p className="text-sm text-ink-soft">What you sold, in the return&apos;s own sections.</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => save(`GSTR1-${one.fp}.json`, gstr1Json(one), "application/json")}>
            <Download size={16} /> JSON for the offline utility
          </button>
        </div>

        <table className="mt-3 w-full border-collapse text-sm">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Section</th>
              <th className="px-5 py-2.5 text-right font-semibold">Rows</th>
              <th className="px-5 py-2.5 text-right font-semibold">Taxable value</th>
              <th className="px-5 py-2.5 text-right font-semibold">Tax</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            <Section name="B2B — sales to registered customers" rows={one.b2b.length}
              taxable={one.b2b.reduce((a, r) => a + r.lines.reduce((x, l) => x + l.taxableMinor, 0), 0)}
              tax={one.b2b.reduce((a, r) => a + r.lines.reduce((x, l) => x + l.igstMinor + l.cgstMinor + l.sgstMinor, 0), 0)}
              file={files.find((f) => f.name === "b2b.csv")} onSave={save} m={m} />
            <Section name="B2CL — large inter-state sales to everyone else" rows={one.b2cl.length}
              taxable={one.b2cl.reduce((a, r) => a + r.lines.reduce((x, l) => x + l.taxableMinor, 0), 0)}
              tax={one.b2cl.reduce((a, r) => a + r.lines.reduce((x, l) => x + l.igstMinor, 0), 0)}
              file={files.find((f) => f.name === "b2cl.csv")} onSave={save} m={m} />
            <Section name="B2CS — everything else, summarised" rows={one.b2cs.length}
              taxable={one.b2cs.reduce((a, r) => a + r.taxableMinor, 0)}
              tax={one.b2cs.reduce((a, r) => a + r.igstMinor + r.cgstMinor + r.sgstMinor, 0)}
              file={files.find((f) => f.name === "b2cs.csv")} onSave={save} m={m} />
            <Section name="Credit notes" rows={one.cdnr.length}
              taxable={one.cdnr.reduce((a, r) => a + r.lines.reduce((x, l) => x + l.taxableMinor, 0), 0)}
              tax={one.cdnr.reduce((a, r) => a + r.lines.reduce((x, l) => x + l.igstMinor + l.cgstMinor + l.sgstMinor, 0), 0)}
              file={files.find((f) => f.name === "cdnr.csv")} onSave={save} m={m} />
            <Section name="Exports" rows={one.exp.length}
              taxable={one.exp.reduce((a, r) => a + r.lines.reduce((x, l) => x + l.taxableMinor, 0), 0)}
              tax={one.exp.reduce((a, r) => a + r.lines.reduce((x, l) => x + l.igstMinor, 0), 0)}
              file={files.find((f) => f.name === "exp.csv")} onSave={save} m={m} />
            <Section name="HSN summary" rows={one.hsn.length}
              taxable={one.hsn.reduce((a, r) => a + r.taxableMinor, 0)}
              tax={one.hsn.reduce((a, r) => a + r.igstMinor + r.cgstMinor + r.sgstMinor, 0)}
              file={files.find((f) => f.name === "hsn.csv")} onSave={save} m={m} />
            <tr className="border-t border-line">
              <td className="px-5 py-2.5">Documents issued</td>
              <td className="px-5 py-2.5 text-right tabular">{one.docs[0]?.issued ?? 0}</td>
              <td className="px-5 py-2.5 text-right text-ink-faint" colSpan={2}>
                {one.docs[0] ? `${one.docs[0].from} to ${one.docs[0].to}, ${one.docs[0].cancelled} cancelled` : ""}
              </td>
              <td className="px-5 py-2.5 text-right">
                {files.find((f) => f.name === "docs.csv")
                  ? <button type="button" className="btn-quiet text-sm" onClick={() => save("docs.csv", files.find((f) => f.name === "docs.csv")!.csv)}>CSV</button>
                  : null}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="border-t border-line px-5 py-3 text-xs text-ink-soft">
          Place of supply above the {m(one.threshold.amountMinor)} threshold is listed invoice by invoice, below it summarised.
          {one.threshold.status === "unverified" ? ` That figure comes from ${one.threshold.source}, which we have not verified ourselves — worth confirming.` : ""}
        </p>
      </section>

      {/* ---- GSTR-3B ---- */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="font-display text-lg">GSTR-3B for {period.label}</h2>
            <p className="text-sm text-ink-soft">Built from the same sales, so the two returns cannot disagree.</p>
          </div>
          <button type="button" className="btn-ghost" onClick={() => save(`GSTR3B-${one.fp}.csv`, gstr3bCsv(three))}>
            <Download size={16} /> CSV
          </button>
        </div>

        <table className="mt-3 w-full border-collapse text-sm">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Box</th>
              <th className="px-5 py-2.5 text-right font-semibold">Taxable value</th>
              <th className="px-5 py-2.5 text-right font-semibold">IGST</th>
              <th className="px-5 py-2.5 text-right font-semibold">CGST</th>
              <th className="px-5 py-2.5 text-right font-semibold">SGST</th>
            </tr>
          </thead>
          <tbody>
            <Box label="3.1(a) Taxable supplies" split={three.outwardTaxable} m={m} />
            {three.zeroRated.taxableMinor ? <Box label="3.1(b) Zero rated" split={three.zeroRated} m={m} /> : null}
            {three.nilAndExempt.taxableMinor ? (
              <tr className="border-t border-line">
                <td className="px-5 py-2.5">3.1(c) Nil rated and exempt</td>
                <td className="px-5 py-2.5 text-right tabular">{m(three.nilAndExempt.taxableMinor)}</td>
                <td colSpan={3} />
              </tr>
            ) : null}
            {three.interStateToUnregistered.map((row) => (
              <tr key={row.pos} className="border-t border-line">
                <td className="px-5 py-2.5 text-ink-soft">3.2 Unregistered, {row.posName}</td>
                <td className="px-5 py-2.5 text-right tabular text-ink-soft">{m(row.taxableMinor)}</td>
                <td className="px-5 py-2.5 text-right tabular text-ink-soft">{m(row.igstMinor)}</td>
                <td colSpan={2} />
              </tr>
            ))}
            <tr className="border-t border-line">
              <td className="px-5 py-2.5">4(A)(5) Credit recorded on your bills</td>
              <td className="px-5 py-2.5 text-right tabular" colSpan={4}>{m(three.inputTaxCredit.recordedMinor)} across {three.inputTaxCredit.bills} bill{three.inputTaxCredit.bills === 1 ? "" : "s"}</td>
            </tr>
            <tr className="border-t-2 border-line font-semibold">
              <td className="px-5 py-3">Tax payable before credit</td>
              <td className="px-5 py-3" />
              <td className="px-5 py-3 text-right tabular">{m(three.payable.igstMinor)}</td>
              <td className="px-5 py-3 text-right tabular">{m(three.payable.cgstMinor)}</td>
              <td className="px-5 py-3 text-right tabular">{m(three.payable.sgstMinor)}</td>
            </tr>
          </tbody>
        </table>

        <ul className="space-y-1.5 border-t border-line px-5 py-4 text-xs text-ink-soft">
          {three.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </section>

      {suggestedLock(period.to, ws.profile?.lockedUpTo) ? (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-display text-lg">
            <Lock size={17} className="text-ink-faint" aria-hidden="true" />Once this is filed, close the books
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Filed and then edited is how a return stops matching the books. Closing to{" "}
            {formatDate(period.to, ws.profile?.country ?? "IN")} stops anything dated in {period.label} or
            earlier from being changed. Do it after the return has actually gone through, not before.
          </p>
          <button
            type="button" className="btn-ghost mt-3"
            onClick={() => { if (ws.profile) { store.saveProfile({ ...ws.profile, lockedUpTo: period.to }); setClosed(true); } }}
          >
            <Lock size={15} /> Close the books to {formatDate(period.to, ws.profile?.country ?? "IN")}
          </button>
        </section>
      ) : closed ? (
        <p className="rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm text-ok">
          The books are closed to {formatDate(ws.profile?.lockedUpTo ?? period.to, ws.profile?.country ?? "IN")}. Corrections from here are credit notes, not edits.
        </p>
      ) : null}

      <p className="text-sm text-ink-faint">
        Prepared, not filed. Upload the JSON to the government&apos;s offline utility, or hand the CSVs to whoever files for you, and let their checks run before anything is submitted. The figures come from the documents you have recorded here and nowhere else.
      </p>
    </div>
  );
}

function Section({ name, rows, taxable, tax, file, onSave, m }: {
  name: string; rows: number; taxable: number; tax: number;
  file?: { name: string; csv: string }; onSave: (name: string, body: string) => void; m: (minor: number) => string;
}) {
  return (
    <tr className={`border-t border-line ${rows ? "" : "text-ink-faint"}`}>
      <td className="px-5 py-2.5">{name}</td>
      <td className="px-5 py-2.5 text-right tabular">{rows || "—"}</td>
      <td className="px-5 py-2.5 text-right tabular">{rows ? m(taxable) : "—"}</td>
      <td className="px-5 py-2.5 text-right tabular">{rows ? m(tax) : "—"}</td>
      <td className="px-5 py-2.5 text-right">
        {file ? <button type="button" className="btn-quiet text-sm" onClick={() => onSave(file.name, file.csv)}>CSV</button> : null}
      </td>
    </tr>
  );
}

function Box({ label, split, m }: { label: string; split: { taxableMinor: number; igstMinor: number; cgstMinor: number; sgstMinor: number }; m: (minor: number) => string }) {
  return (
    <tr className="border-t border-line">
      <td className="px-5 py-2.5">{label}</td>
      <td className="px-5 py-2.5 text-right tabular">{m(split.taxableMinor)}</td>
      <td className="px-5 py-2.5 text-right tabular">{m(split.igstMinor)}</td>
      <td className="px-5 py-2.5 text-right tabular">{m(split.cgstMinor)}</td>
      <td className="px-5 py-2.5 text-right tabular">{m(split.sgstMinor)}</td>
    </tr>
  );
}

/** You file for the month just gone, so that is what the screen opens on. */
function lastMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
