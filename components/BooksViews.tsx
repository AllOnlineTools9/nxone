"use client";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import type { JournalEntry } from "@/lib/ledger/journal";
import { accountLedger, accountsInUse, dayBook, partnerAccounts, receiptsAndPayments, tradingAndPL, type TSide } from "@/lib/ledger/views";
import type { Period } from "@/lib/store/reports";

/**
 * The accountant's views of the books: one account's ledger, the day book, the receipts and
 * payments account, the two-sided trading and profit and loss account, and partners' accounts.
 */

type Props = { entries: JournalEntry[]; currency: string; period: Period; country: string };

const useMoney = (currency: string) => (minor: number) => formatMoney(fromMinor(minor, currency), currency === "INR" ? "en-IN" : "en-US");

export function LedgerView({ entries, currency, period, country }: Props) {
  const m = useMoney(currency);
  const accounts = useMemo(() => accountsInUse(entries, currency), [entries, currency]);
  const [code, setCode] = useState(() => accounts.find((a) => a.code === "1020")?.code ?? accounts[0]?.code ?? "1020");
  const [tForm, setTForm] = useState(false);
  const l = accountLedger(entries, code, currency, period.from, period.to);
  const show = (iso: string) => formatDate(iso, country);
  const bal = (minor: number) => `${m(Math.abs(minor))} ${minor === 0 ? "" : (minor > 0) === (l.normal === "debit") ? "Dr" : "Cr"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[16rem] text-sm">
          <span className="label">Account</span>
          <select className="field" value={code} onChange={(e) => setCode(e.target.value)}>
            {["asset", "liability", "equity", "income", "expense"].map((type) => (
              <optgroup key={type} label={{ asset: "What you own", liability: "What you owe", equity: "Capital", income: "Income", expense: "Costs" }[type]}>
                {accounts.filter((a) => a.type === type).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="flex gap-1.5" role="group" aria-label="Layout">
          {[[false, "Running balance"], [true, "T format"]].map(([v, label]) => (
            <button key={String(v)} type="button" aria-pressed={tForm === v} onClick={() => setTForm(v as boolean)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${tForm === v ? "border-forest bg-forest text-white" : "border-line bg-white text-ink-soft"}`}>{label as string}</button>
          ))}
        </div>
      </div>

      {!tForm ? (
        <section className="card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-canvas text-left">
              <tr><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Narration</th><th className="px-4 py-2.5 font-semibold">Against</th><th className="px-4 py-2.5 text-right font-semibold">Debit</th><th className="px-4 py-2.5 text-right font-semibold">Credit</th><th className="px-4 py-2.5 text-right font-semibold">Balance</th></tr>
            </thead>
            <tbody>
              <tr className="border-t border-line text-ink-soft"><td className="px-4 py-2">{show(period.from)}</td><td className="px-4 py-2" colSpan={4}>Opening balance</td><td className="px-4 py-2 text-right tabular">{bal(l.opening)}</td></tr>
              {l.rows.map((r) => (
                <tr key={r.entryId} className="border-t border-line">
                  <td className="px-4 py-2 tabular text-ink-soft">{show(r.date)}</td>
                  <td className="px-4 py-2">{r.narration}{r.memo ? <span className="text-ink-faint"> · {r.memo}</span> : null}</td>
                  <td className="px-4 py-2 text-ink-soft">{r.against}</td>
                  <td className="px-4 py-2 text-right tabular">{r.debit ? m(r.debit) : ""}</td>
                  <td className="px-4 py-2 text-right tabular">{r.credit ? m(r.credit) : ""}</td>
                  <td className="px-4 py-2 text-right tabular">{bal(r.balance)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold"><td className="px-4 py-2" colSpan={3}>Closing balance</td><td className="px-4 py-2 text-right tabular">{m(l.totalDebit)}</td><td className="px-4 py-2 text-right tabular">{m(l.totalCredit)}</td><td className="px-4 py-2 text-right tabular">{bal(l.closing)}</td></tr>
            </tbody>
          </table>
        </section>
      ) : (
        <TAccount
          title={`${l.name} account`}
          debit={[
            ...(l.opening > 0 === (l.normal === "debit") && l.opening ? [{ name: "To balance brought down", amount: Math.abs(l.opening) }] : []),
            ...l.rows.filter((r) => r.debit).map((r) => ({ name: `${show(r.date)} To ${r.against}`, amount: r.debit })),
            ...(l.closing && (l.closing > 0) !== (l.normal === "debit") ? [{ name: "To balance carried down", amount: Math.abs(l.closing) }] : [])
          ]}
          credit={[
            ...(l.opening && (l.opening > 0) !== (l.normal === "debit") ? [{ name: "By balance brought down", amount: Math.abs(l.opening) }] : []),
            ...l.rows.filter((r) => r.credit).map((r) => ({ name: `${show(r.date)} By ${r.against}`, amount: r.credit })),
            ...(l.closing && (l.closing > 0) === (l.normal === "debit") ? [{ name: "By balance carried down", amount: Math.abs(l.closing) }] : [])
          ]}
          m={m}
        />
      )}
    </div>
  );
}

/** Two sides, debit on the left and credit on the right, totalled at the bottom. */
export function TAccount({ title, debit, credit, m }: { title: string; debit: TSide[]; credit: TSide[]; m: (minor: number) => string }) {
  const sum = (s: TSide[]) => s.reduce((a, x) => a + x.amount, 0);
  const total = Math.max(sum(debit), sum(credit));
  const side = (label: string, rows: TSide[]) => (
    <div className="min-w-0 flex-1">
      <p className="border-b border-line bg-canvas px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <ul className="divide-y divide-line text-sm">
        {rows.map((r, i) => <li key={`${r.name}-${i}`} className="flex justify-between gap-3 px-4 py-2"><span>{r.name}</span><span className="tabular">{m(r.amount)}</span></li>)}
      </ul>
      <p className="flex justify-between border-t-2 border-ink px-4 py-2 text-sm font-semibold"><span>Total</span><span className="tabular">{m(total)}</span></p>
    </div>
  );
  return (
    <section className="card overflow-hidden">
      <h3 className="px-4 pt-4 font-display text-lg">{title}</h3>
      <div className="mt-3 flex flex-col divide-y divide-line sm:flex-row sm:divide-x sm:divide-y-0">
        {side("Dr", debit)}
        {side("Cr", credit)}
      </div>
    </section>
  );
}

export function DayBookView({ entries, currency, period, country }: Props) {
  const m = useMoney(currency);
  const days = dayBook(entries, currency, period.from, period.to);
  return (
    <section className="card overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-canvas text-left">
          <tr><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Particulars</th><th className="px-4 py-2.5 text-right font-semibold">Debit</th><th className="px-4 py-2.5 text-right font-semibold">Credit</th></tr>
        </thead>
        <tbody>
          {days.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-soft">Nothing in this period.</td></tr> : null}
          {days.map((d) => [
            <tr key={d.id} className="border-t-2 border-line">
              <td className="px-4 pt-2.5 tabular text-ink-soft">{formatDate(d.date, country)}</td>
              <td className="px-4 pt-2.5 font-medium" colSpan={3}>{d.narration}</td>
            </tr>,
            ...d.lines.map((l, i) => (
              <tr key={`${d.id}-${i}`}>
                <td />
                <td className={`px-4 py-1 ${l.credit ? "pl-10" : ""}`}>{l.debit ? "" : "To "}{l.name}{l.memo ? <span className="text-ink-faint"> · {l.memo}</span> : null}{l.debit ? " Dr" : ""}</td>
                <td className="px-4 py-1 text-right tabular">{l.debit ? m(l.debit) : ""}</td>
                <td className="px-4 py-1 text-right tabular">{l.credit ? m(l.credit) : ""}</td>
              </tr>
            ))
          ])}
        </tbody>
      </table>
    </section>
  );
}

export function ReceiptsPaymentsView({ entries, currency, period }: Props) {
  const m = useMoney(currency);
  const rp = receiptsAndPayments(entries, currency, period.from, period.to);
  return (
    <div className="space-y-3">
      <TAccount
        title="Receipts and payments account"
        debit={[{ name: "To opening cash and bank", amount: rp.opening }, ...rp.receipts.map((r) => ({ name: `To ${r.name}`, amount: r.amount }))]}
        credit={[...rp.payments.map((p) => ({ name: `By ${p.name}`, amount: p.amount })), { name: "By closing cash and bank", amount: rp.closing }]}
        m={m}
      />
      <p className="text-sm text-ink-faint">Only cash and bank, by what the money was for. Money moved between cash and the bank is left out, since it neither came in nor went out.</p>
    </div>
  );
}

export function TraditionalView({ entries, currency, period }: Props) {
  const m = useMoney(currency);
  const t = tradingAndPL(entries, currency, period.from, period.to);
  return (
    <div className="space-y-4">
      <TAccount title={`Trading account for ${period.label ?? "the period"}`} debit={t.trading.debit.map((x) => ({ ...x, name: `To ${x.name}` }))} credit={t.trading.credit.map((x) => ({ ...x, name: `By ${x.name}` }))} m={m} />
      <TAccount title={`Profit and loss account for ${period.label ?? "the period"}`} debit={t.pl.debit.map((x) => ({ ...x, name: `To ${x.name}` }))} credit={t.pl.credit.map((x) => ({ ...x, name: `By ${x.name}` }))} m={m} />
    </div>
  );
}

export function PartnersView({ entries, currency, period, partners }: Props & { partners: string[] }) {
  const m = useMoney(currency);
  const rows = partnerAccounts(entries, currency, partners, period.to);
  return (
    <section className="card overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-canvas text-left">
          <tr><th className="px-4 py-2.5 font-semibold">Partner</th><th className="px-4 py-2.5 text-right font-semibold">Capital put in</th><th className="px-4 py-2.5 text-right font-semibold">Drawings</th><th className="px-4 py-2.5 text-right font-semibold">Balance</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.partner} className="border-t border-line">
              <td className="px-4 py-2">{r.partner}</td>
              <td className="px-4 py-2 text-right tabular">{m(r.introduced)}</td>
              <td className="px-4 py-2 text-right tabular">{m(r.drawings)}</td>
              <td className="px-4 py-2 text-right tabular font-medium">{m(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-sm text-ink-faint">Profit is shared out as the partnership deed says, which NXOne does not hold, so add each partner&apos;s share at year end as an entry.</p>
    </section>
  );
}
