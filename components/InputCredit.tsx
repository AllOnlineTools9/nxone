"use client";
import { AlertTriangle, CheckCircle2, Mail, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { NotATwoB, chaseMessage, readTwoB, reconcile, type MatchState, type Reconciliation, type TwoBFile } from "@/lib/returns/gstr2b";
import Link from "next/link";
import { possiblyReverseCharge } from "@/lib/returns/rcm";
import { formatDate, mailtoLink } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Matching what you claimed against what the government says you may claim.
 *
 * This is the only GST screen that is not about your own records: it is about whether your
 * suppliers filed. The number that matters is the one at risk - tax you have claimed on bills
 * your supplier has not declared - because that is money you will have to give back, with
 * interest, if nobody chases it before the month closes.
 */

const LABELS: Record<MatchState, { title: string; tone: "ok" | "warn" | "bad" | "plain" }> = {
  matched: { title: "Agreed with the portal", tone: "ok" },
  "different-amount": { title: "Different amounts", tone: "bad" },
  "only-in-your-books": { title: "Your supplier has not filed these", tone: "bad" },
  "only-on-the-portal": { title: "On the portal, not in your books", tone: "warn" },
  "credit-note-not-recorded": { title: "Credit notes you have not recorded", tone: "bad" },
  "cannot-be-claimed": { title: "The portal says these cannot be claimed", tone: "warn" },
  "no-gstin": { title: "Cannot be matched yet", tone: "plain" }
};

const ORDER: MatchState[] = ["only-in-your-books", "different-amount", "credit-note-not-recorded", "only-on-the-portal", "cannot-be-claimed", "no-gstin", "matched"];

export default function InputCredit() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [file, setFile] = useState<TwoBFile | undefined>();
  const [error, setError] = useState("");
  const [open, setOpen] = useState<MatchState | undefined>("only-in-your-books");

  const purchases = useMemo(() => db.expenses().map((e) => ({
    id: e.id, date: e.date, supplier: e.supplier, supplierGstin: e.supplierGstin,
    reference: e.reference, netMinor: e.netMinor, taxMinor: e.taxMinor
  })), [ws]);

  const result: Reconciliation | undefined = useMemo(
    () => (file ? reconcile(file.invoices, purchases) : undefined),
    [file, purchases]
  );

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  // A composition dealer files CMP-08, not these, and claims no credit at all. Showing them
  // regular-scheme figures would invite a return nobody on this scheme may file.
  if (ws.profile?.gstScheme === "composition") {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg">This does not apply on the composition scheme</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          You file CMP-08 each quarter instead, and claim no input credit - that is the trade for
          the lower rate on turnover.
        </p>
        <Link href="/composition" className="btn-ghost mt-3 inline-flex">Go to the quarterly return</Link>
      </section>
    );
  }

  // Not registered at all: there is no return to file and no credit to claim.
  if (ws.profile?.gstScheme === "unregistered") {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg">You are not registered for GST</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          So there are no GST returns to file and no input credit to claim, and your invoices go
          out without GST. If your turnover passes the registration limit, register, then change
          your scheme and this will apply.
        </p>
        <Link href="/composition" className="btn-ghost mt-3 inline-flex">Change your GST scheme</Link>
      </section>
    );
  }


  const missed = possiblyReverseCharge(db.expenses().map((e) => ({
    id: e.id, date: e.date, supplier: e.supplier, description: e.description,
    netMinor: e.netMinor, taxMinor: e.taxMinor, rcmCategory: e.rcmCategory, supplierGstin: e.supplierGstin
  })));

  const currency = ws.profile?.currency ?? "INR";
  const country = ws.profile?.country ?? "IN";
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));
  const date = (iso: string) => (iso ? formatDate(iso, country) : "-");

  const read = async (chosen: File | undefined) => {
    if (!chosen) return;
    setError("");
    try {
      setFile(readTwoB(await chosen.text()));
    } catch (e) {
      setFile(undefined);
      setError(e instanceof NotATwoB ? e.message : "That file could not be read.");
    }
  };

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="font-display text-lg">Input credit, checked against the portal</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Your supplier charged you GST, but you can only claim it back once they have actually
          filed. Download GSTR-2B for the month from the GST portal as JSON, and this will tell you
          what agrees, what is missing, and who to chase.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="btn-primary cursor-pointer">
            <Upload size={16} /> Choose your GSTR-2B file
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => read(e.target.files?.[0])} />
          </label>
          {file ? (
            <span className="text-sm text-ink-soft">
              {file.period ? `For ${file.period}` : "Period not stated"}
              {file.generatedOn ? `, generated ${date(file.generatedOn)}` : ""} · {file.invoices.length} entries
            </span>
          ) : null}
        </div>

        {error ? <p role="alert" className="mt-3 rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</p> : null}

        {file && file.gstin && ws.profile?.taxId && file.gstin !== ws.profile.taxId ? (
          <p className="mt-3 flex gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            This statement is for {file.gstin}, and your GSTIN is {ws.profile.taxId}. Check you downloaded the right business.
          </p>
        ) : null}

        {file?.skipped.length ? (
          <p className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">
            Not included here: {file.skipped.map((s) => `${s.count} from ${s.section} (${s.why})`).join(", ")}.
            Those need handling separately.
          </p>
        ) : null}
      </section>

      {missed.length > 0 ? (
        <section className="card border-warn/30 bg-warn/5 p-5">
          <h2 className="flex items-center gap-2 font-display text-lg text-warn">
            <AlertTriangle size={17} aria-hidden="true" />
            {missed.length === 1 ? "A bill may be under reverse charge" : `${missed.length} bills may be under reverse charge`}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            Where reverse charge applies, you owe the GST yourself and the supplier's bill carries
            none. Left unmarked it catches you twice: the tax is owed whether or not anybody
            noticed, and the credit you were entitled to goes unclaimed.
          </p>
          <ul className="mt-3 space-y-2">
            {missed.slice(0, 6).map((s) => (
              <li key={s.expenseId} className="border-t border-warn/20 pt-2 text-sm">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{s.supplier}</span>
                  <span className="tabular text-ink-soft">{date(s.date)} · {money(s.netMinor)}</span>
                </span>
                <span className="mt-0.5 block text-ink-soft">{s.says}</span>
              </li>
            ))}
          </ul>
          <Link href="/expenses" className="mt-3 inline-block text-sm underline">Mark them on the bills</Link>
        </section>
      ) : null}

      {result ? (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <Figure label="Available on the portal" value={money(result.availableMinor)} />
            <Figure label="Claimed in your books" value={money(result.claimedMinor)} />
            <Figure label="At risk" value={money(result.atRiskMinor)} tone={result.atRiskMinor > 0 ? "bad" : "ok"} />
            <Figure
              label={result.creditNotesMinor < 0 ? "Credit notes to record" : "Yours, not yet recorded"}
              // Shown without its sign: the label says which way it goes, and "-₹900.00" under
              // "Credit notes to record" reads as an error rather than as a reduction.
              value={money(result.creditNotesMinor < 0 ? Math.abs(result.creditNotesMinor) : result.unrecordedMinor)}
              tone={result.creditNotesMinor < 0 ? "bad" : result.unrecordedMinor > 0 ? "warn" : "ok"}
            />
          </section>

          {result.atRiskMinor > 0 ? (
            <section className="card p-5">
              <h3 className="flex items-center gap-2 font-display text-lg">
                <AlertTriangle size={17} className="text-bad" aria-hidden="true" />Worth a message today
              </h3>
              <p className="mt-1 text-sm text-ink-soft">
                {money(result.atRiskMinor)} of credit is held up by {result.chase.length}{" "}
                {result.chase.length === 1 ? "supplier" : "suppliers"} who have not filed these bills.
              </p>
              <ul className="mt-3 divide-y divide-line">
                {result.chase.map((s) => (
                  <li key={s.gstin ?? s.supplier} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      <span className="block font-medium">{s.supplier}</span>
                      <span className="block text-xs text-ink-faint">
                        {s.missing} {s.missing === 1 ? "bill" : "bills"} · {money(s.taxMinor)} of credit · {s.gstin}
                      </span>
                    </span>
                    <a
                      className="btn-ghost"
                      href={mailtoLink("", ...(() => {
                        const m = chaseMessage(s, result.rows, ws.profile?.name ?? "Our business", file?.period ?? "this period", money, date);
                        return [m.subject, m.body] as [string, string];
                      })())}
                    >
                      <Mail size={15} /> Write to them
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm text-ok">
              <CheckCircle2 size={16} aria-hidden="true" /> Every bill you have recorded appears on the portal. Nothing is at risk.
            </p>
          )}

          {ORDER.filter((state) => result.counts[state] > 0).map((state) => {
            const rows = result.rows.filter((r) => r.state === state);
            const label = LABELS[state];
            return (
              <section key={state} className="card overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                  onClick={() => setOpen(open === state ? undefined : state)}
                  aria-expanded={open === state}
                >
                  <span className="font-display text-lg">{label.title}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${
                    label.tone === "bad" ? "bg-bad/10 text-bad" : label.tone === "warn" ? "bg-warn/10 text-warn" : label.tone === "ok" ? "bg-ok/10 text-ok" : "bg-canvas text-ink-soft"
                  }`}>{rows.length}</span>
                </button>

                {open === state ? (
                  <div className="border-t border-line">
                    <p className="px-5 py-3 text-sm text-ink-soft">{rows[0].advice}</p>
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-canvas text-left">
                        <tr>
                          <th className="px-5 py-2 font-semibold">Supplier</th>
                          <th className="px-5 py-2 font-semibold">Bill</th>
                          <th className="px-5 py-2 font-semibold">Date</th>
                          <th className="px-5 py-2 text-right font-semibold">Portal</th>
                          <th className="px-5 py-2 text-right font-semibold">Your books</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={`${row.number}-${i}`} className="border-t border-line">
                            <td className="px-5 py-2">{row.supplier}</td>
                            <td className="px-5 py-2">{row.number || "-"}</td>
                            <td className="px-5 py-2 tabular text-ink-soft">{date(row.date)}</td>
                            <td className="px-5 py-2 text-right tabular">{row.portalTaxMinor === undefined ? "-" : money(row.portalTaxMinor)}</td>
                            <td className={`px-5 py-2 text-right tabular ${row.differenceMinor ? "font-semibold text-bad" : ""}`}>
                              {row.booksTaxMinor === undefined ? "-" : money(row.booksTaxMinor)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            );
          })}

          <p className="text-sm text-ink-faint">
            Matching is on the supplier&apos;s GSTIN and the bill number, ignoring punctuation and
            padding. A purchase with neither cannot be matched, which is why both are worth
            recording on every bill.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone = "plain" }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "plain" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-1 font-display text-2xl tabular ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{value}</p>
    </div>
  );
}
