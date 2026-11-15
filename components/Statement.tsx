"use client";
import { Check, Copy, Download, Mail, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { statementCsv, statementFor, statementLinks } from "@/lib/analysis/statement";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Everything one customer owes, ready to send.
 *
 * The chase list says who to chase and gives you nothing to send them. A total is arguable; six
 * dated lines with what was paid against each are not. The lines go in the message itself rather
 * than an attachment — a statement is short, and an email you have to open a file to understand
 * is an email that waits until tomorrow.
 */
export default function Statement() {
  const [ws] = useWorkspace();
  const ready = useHydrated();
  const [customer, setCustomer] = useState("");
  const [copied, setCopied] = useState(false);

  const owing = useMemo(() => {
    const names = new Map<string, number>();
    for (const d of ws.documents ?? []) {
      if (d.kind !== "invoice" || d.status === "cancelled") continue;
      names.set(d.clientName, (names.get(d.clientName) ?? 0) + (d.totalMinor - d.paidMinor));
    }
    return [...names.entries()].sort((a, b) => b[1] - a[1]);
  }, [ws.documents]);

  if (!ready) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const currency = ws.profile?.currency ?? "INR";
  const country = ws.profile?.country ?? "IN";
  const chosen = customer || owing[0]?.[0] || "";
  if (!chosen) {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg">Statement of account</h2>
        <p className="mt-1 text-sm text-ink-soft">Once you have invoiced somebody, their statement appears here.</p>
      </section>
    );
  }

  const statement = statementFor(ws.documents ?? [], chosen, { asOf: todayIso(), currency });
  const latest = (ws.documents ?? []).filter((d) => d.clientName === chosen).at(-1)?.doc.buyer;
  const links = statementLinks(
    statement,
    { businessName: ws.profile?.name || "This business", signatoryName: ws.profile?.signatoryName, country },
    { email: latest?.email, phone: latest?.phone }
  );
  const money = (minor: number) => formatMoney(fromMinor(minor, currency));

  const saveCsv = () => {
    const url = URL.createObjectURL(new Blob([statementCsv(statement)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement-${chosen.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${todayIso()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(links.text.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the text is on screen to copy by hand */ }
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">Statement of account</h2>
          <p className="mt-1 text-sm text-ink-soft">Everything {chosen} owes, as at {formatDate(statement.asOf, country)}.</p>
        </div>
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">Customer</span>
          <select className="field mt-1" value={chosen} onChange={(e) => setCustomer(e.target.value)}>
            {owing.map(([name, owed]) => (
              <option key={name} value={name}>{name}{owed > 0 ? ` — ${money(owed)} owed` : ""}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-ink-faint">
            <tr><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Number</th><th className="py-2 pr-4 text-right">Charged</th><th className="py-2 pr-4 text-right">Paid</th><th className="py-2 pr-4 text-right">Outstanding</th><th className="py-2">&nbsp;</th></tr>
          </thead>
          <tbody>
            {statement.lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="py-2 pr-4 tabular text-ink-soft">{formatDate(l.date, country)}</td>
                <td className="py-2 pr-4">{l.number}</td>
                <td className="py-2 pr-4 text-right tabular">{money(l.chargedMinor)}</td>
                <td className="py-2 pr-4 text-right tabular text-ink-soft">{l.paidMinor ? money(l.paidMinor) : "—"}</td>
                <td className="py-2 pr-4 text-right tabular font-medium">{l.outstandingMinor ? money(l.outstandingMinor) : "—"}</td>
                <td className="py-2 text-xs text-warn">{l.daysLate > 0 ? `${l.daysLate} days late` : ""}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line font-semibold">
              <td className="py-2 pr-4" colSpan={4}>Outstanding</td>
              <td className="py-2 pr-4 text-right tabular">{money(statement.outstandingMinor)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {statement.ageing.length > 1 ? (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
          {statement.ageing.map((a) => <li key={a.label}>{a.label}: <span className="tabular">{money(a.minor)}</span></li>)}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {links.mail ? <a className="btn-primary" href={links.mail}><Mail size={16} /> Email the statement</a> : null}
        {links.whatsapp ? <a className="btn-ghost" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Send on WhatsApp</a> : null}
        <button type="button" className="btn-quiet" onClick={copy}>
          {copied ? <><Check size={15} className="text-ok" />Copied</> : <><Copy size={15} />Copy it</>}
        </button>
        <button type="button" className="btn-quiet" onClick={saveCsv}><Download size={15} /> As a spreadsheet</button>
      </div>

      {!links.mail && !links.whatsapp ? (
        <p className="mt-3 text-sm text-ink-soft">
          There is no email address or phone number on {chosen}&apos;s documents, so there is nowhere to send this.
          Copy it, or add their details to the next invoice.
        </p>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-ink-soft">See what it says</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-sm">{links.text.body}</pre>
      </details>
    </section>
  );
}
