"use client";
import { AlertTriangle, Check, Download, Info } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { todayIso } from "@/lib/format";
import { applicability, buildEInvoice, eligibility } from "@/lib/einvoice/schema";
import { validateEInvoice, verdictOf, type Problem } from "@/lib/einvoice/validate";
import { formatMoney, fromMinor } from "@/lib/money";
import { profitAndLoss } from "@/lib/ledger/statements";
import { ledgerFor } from "@/lib/ledger/posting";
import { openingOf } from "@/lib/ledger/opening";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Registering invoices with the government portal.
 *
 * Above a turnover threshold a B2B invoice is not a valid invoice until the portal has given it a
 * number, and the customer cannot claim credit on one that was never registered. This prepares
 * what the portal takes and checks it first, because the portal's own refusals come one at a time
 * and an invoice with three faults otherwise takes three attempts to fix.
 *
 * Nothing is registered from here. That needs credentials this has none of, and claiming
 * otherwise would be worse than useless — somebody would believe their invoices were filed.
 */
export default function EInvoicing() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const currency = ws.profile?.currency ?? "INR";
  const today = todayIso();

  const prepared = useMemo(() => {
    if (!ready) return [];
    const documents = db.documents();
    return documents
      .filter((d) => eligibility(d).eligible)
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
      .slice(0, 200)
      .map((d) => {
        const payload = buildEInvoice(d, ws.profile, documents);
        const problems: Problem[] = payload ? validateEInvoice(payload) : [{
          field: "currency", severity: "stop" as const,
          says: "This invoice is in another currency with no exchange rate, so it cannot be written in rupees."
        }];
        return { document: d, payload, problems, verdict: verdictOf(problems) };
      });
  }, [ws, db, ready]);

  const turnover = useMemo(() => {
    if (!ready) return 0;
    const ledger = ledgerFor(db.documents(), db.expenses(), currency, openingOf(ws.profile));
    const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) >= 4 ? 0 : 1);
    return profitAndLoss(ledger, currency, `${year}-04-01`, `${year + 1}-03-31`).totalIncome.minor;
  }, [ws, db, currency, today, ready]);

  if (!ready) return <div className="h-72 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  if ((ws.profile?.country ?? "IN").toUpperCase() !== "IN") {
    return (
      <div className="card p-6">
        <h1 className="text-2xl font-semibold">E-invoicing</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">This is the Indian invoice registration portal, and your business is set elsewhere.</p>
      </div>
    );
  }

  const m = (minor: number) => formatMoney(fromMinor(minor, currency), "en-IN");
  const rule = applicability(turnover, today);
  const registered = prepared.filter((p) => p.document.einvoice);
  const waiting = prepared.filter((p) => !p.document.einvoice);
  const blocked = waiting.filter((p) => !p.verdict.ready);
  const shown = showAll ? waiting : waiting.slice(0, 25);

  const save = (name: string, body: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    const good = waiting.filter((p) => p.payload && p.verdict.ready).map((p) => p.payload);
    if (good.length) save(`e-invoices-${today}.json`, JSON.stringify(good, null, 2));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">E-invoicing</h1>
        <p className="mt-1 max-w-2xl text-ink-soft">
          The B2B invoices that go to the registration portal, prepared and checked. Nothing is registered from here.
        </p>
      </div>

      <section className={`rounded-xl border p-5 ${rule.required ? "border-forest bg-forest-pale" : "border-line bg-white"}`}>
        <h2 className="font-display text-lg">{rule.required ? "You have to register your B2B invoices" : "You do not have to register invoices"}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {rule.says} Your sales this financial year come to {m(turnover)}, and the threshold goes on any year from 2017-18, so check the earlier ones too if you are near it.
        </p>
        <p className="mt-2 text-xs text-ink-faint">From {rule.threshold.source}, effective {rule.threshold.effectiveFrom}.</p>
      </section>

      {blocked.length ? (
        <section className="rounded-xl border border-bad/30 bg-bad/5 p-4">
          <div className="flex gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden="true" />
            <div>
              <p className="font-medium">{blocked.length} invoice{blocked.length === 1 ? "" : "s"} the portal would refuse</p>
              <p className="mt-0.5 text-sm text-ink-soft">
                Open one below to see exactly what it would object to. Fixing it here saves the back and forth, because the portal reports one fault at a time.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="font-display text-lg">Waiting to be registered</h2>
            <p className="text-sm text-ink-soft">{waiting.length} invoice{waiting.length === 1 ? "" : "s"}, {waiting.length - blocked.length} ready to go.</p>
          </div>
          <button type="button" className="btn-primary" onClick={downloadAll} disabled={waiting.length === blocked.length}>
            <Download size={16} /> All the ready ones
          </button>
        </div>

        {waiting.length ? (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead className="bg-canvas text-left">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Invoice</th>
                <th className="px-5 py-2.5 font-semibold">Customer</th>
                <th className="px-5 py-2.5 text-right font-semibold">Value</th>
                <th className="px-5 py-2.5 font-semibold">State</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ document, payload, problems, verdict }) => (
                <>
                  <tr key={document.id} className="border-t border-line">
                    <td className="px-5 py-2.5">
                      <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setOpen(open === document.id ? null : document.id)}>
                        {document.number}
                      </button>
                      <span className="block text-xs text-ink-faint">{document.issueDate}</span>
                    </td>
                    <td className="px-5 py-2.5">{document.clientName}</td>
                    <td className="px-5 py-2.5 text-right tabular">{m(document.totalMinor)}</td>
                    <td className="px-5 py-2.5">
                      {verdict.ready
                        ? <span className="inline-flex items-center gap-1.5 text-ink-soft"><Check size={14} className="text-forest" /> Ready</span>
                        : <span className="inline-flex items-center gap-1.5 text-bad"><AlertTriangle size={14} /> {problems.filter((p) => p.severity === "stop").length} to fix</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {payload ? (
                        <button type="button" className="btn-quiet text-sm" onClick={() => save(`${document.number}.json`, JSON.stringify(payload, null, 2))}>JSON</button>
                      ) : null}
                    </td>
                  </tr>
                  {open === document.id ? (
                    <tr key={`${document.id}-detail`} className="border-t border-line bg-canvas/50">
                      <td colSpan={5} className="px-5 py-4">
                        {problems.length ? (
                          <ul className="space-y-2">
                            {problems.map((problem) => (
                              <li key={problem.field + problem.says} className="flex gap-2.5 text-sm">
                                {problem.severity === "stop"
                                  ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-bad" aria-hidden="true" />
                                  : <Info size={15} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />}
                                <span>
                                  {problem.says}
                                  <span className="ml-1.5 text-xs text-ink-faint">{problem.field}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-ink-soft">Nothing here the portal should object to.</p>
                        )}
                        <Link href="/documents/" className="mt-3 inline-block text-sm font-medium underline">Open the invoice</Link>
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-soft">
            Nothing waiting. Only invoices to customers with a GSTIN are registered — counter sales and anything to somebody unregistered never go to the portal.
          </p>
        )}

        {waiting.length > shown.length ? (
          <button type="button" className="w-full border-t border-line py-2.5 text-sm text-ink-soft hover:bg-canvas" onClick={() => setShowAll(true)}>
            Show all {waiting.length}
          </button>
        ) : null}
      </section>

      {registered.length ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Already registered</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {registered.map(({ document }) => (
              <li key={document.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="font-medium">{document.number}</span>
                <span className="truncate font-mono text-xs text-ink-soft">{document.einvoice?.irn}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-sm text-ink-faint">
        Prepared, not registered. Upload the JSON through the portal or your usual agent, and put the number it returns back on the invoice. Registering from here would need credentials from the portal, and NXOne has none — telling you an invoice was filed when it was not would be worse than not offering it at all.
      </p>
    </div>
  );
}
