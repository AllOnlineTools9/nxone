"use client";
import { AlertTriangle, Check, Info, Plus, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EXAMPLES, EXAMPLES_WORLD, parseLines, type Draft, type Parsed, type Structure } from "@/lib/entries/parse";
import type { ManualEntry, VoucherType } from "@/lib/entries/types";
import { CHART, accountByCode } from "@/lib/ledger/accounts";
import type { JournalLine } from "@/lib/ledger/journal";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";
import { hasFeature } from "@/lib/countries/features";
import { packFor } from "@/lib/countries/packs";

/**
 * Other money: everything that is not an invoice or a bill. The owner putting money in or taking
 * it out, loans, deposits, tax paid, cash moved to the bank, and the adjustments made at year end.
 *
 * Typed as sentences, in English or Hinglish, one per line. Each is read into a draft entry that
 * shows exactly what it will do to the books, can be corrected, and is only posted when confirmed.
 */

type Card = { key: string; sentence: string; result: Parsed; draft?: Draft };

const VOUCHERS: Array<[VoucherType, string]> = [["payment", "Payment"], ["receipt", "Receipt"], ["contra", "Contra"], ["journal", "Journal"]];
const GROUPS: Array<[string, string]> = [["asset", "What you own"], ["liability", "What you owe"], ["equity", "Capital"], ["income", "Income"], ["expense", "Costs"]];

function AccountSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select className="field py-1.5" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {GROUPS.map(([type, name]) => (
        <optgroup key={type} label={name}>
          {CHART.filter((a) => a.type === type).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Debit and credit lines, editable, with a check that they balance. */
function LinesEditor({ lines, onChange, currency }: { lines: JournalLine[]; onChange: (l: JournalLine[]) => void; currency: string }) {
  const m = (minor: number) => formatMoney(fromMinor(minor, currency), "en-IN");
  const debits = lines.reduce((a, l) => a + (l.debit ?? 0), 0);
  const credits = lines.reduce((a, l) => a + (l.credit ?? 0), 0);
  const set = (i: number, patch: Partial<JournalLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const toMinor = (v: string) => Math.round((Number(v.replace(/,/g, "")) || 0) * 100);
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_7rem_7rem_8rem_auto] sm:items-center">
          <AccountSelect value={l.account} onChange={(v) => set(i, { account: v })} label={`Account ${i + 1}`} />
          <button type="button" className="rounded p-2 text-ink-faint hover:text-bad sm:order-last" aria-label="Remove line" onClick={() => onChange(lines.filter((_, j) => j !== i))}><X size={15} /></button>
          <input className="field py-1.5 tabular" inputMode="decimal" placeholder="Debit" aria-label="Debit" value={l.debit ? l.debit / 100 : ""} onChange={(e) => set(i, { debit: toMinor(e.target.value) || undefined, credit: undefined })} />
          <input className="field py-1.5 tabular" inputMode="decimal" placeholder="Credit" aria-label="Credit" value={l.credit ? l.credit / 100 : ""} onChange={(e) => set(i, { credit: toMinor(e.target.value) || undefined, debit: undefined })} />
          <input className="field py-1.5" placeholder="Name (optional)" aria-label="Name on this line" value={l.memo ?? ""} onChange={(e) => set(i, { memo: e.target.value || undefined })} />
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" className="btn-quiet text-sm" onClick={() => onChange([...lines, { account: "6900" }])}><Plus size={14} />Add a line</button>
        <span className={debits === credits && debits > 0 ? "text-ok" : "text-bad"}>
          Debits {m(debits)}, credits {m(credits)}{debits === credits && debits > 0 ? ", balanced" : ", must be equal"}
        </span>
      </div>
    </div>
  );
}

export default function Entries() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [text, setText] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [manual, setManual] = useState<{ date: string; narration: string; voucher: VoucherType; lines: JournalLine[] } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Year end and other pages open this one with a sentence to finish: /entries/?text=...
  useEffect(() => {
    const given = new URLSearchParams(window.location.search).get("text");
    if (given) setText(given);
  }, []);

  const profile = ws.profile;
  const currency = profile?.currency ?? "INR";
  const country = profile?.country ?? "IN";
  const structure: Structure = profile?.structure ?? "proprietorship";
  const partners = profile?.partners ?? [];
  // Hinglish, lakh, GST and TDS examples are for India; other countries get plain ones.
  const india = hasFeature(profile?.country, "hinglish");
  const pack = packFor(profile?.country);
  const today = todayIso();
  const m = (minor: number) => formatMoney(fromMinor(minor, currency), "en-IN");
  const saved = useMemo(() => (ready ? db.entries().slice().reverse() : []), [ws, ready]);

  if (!ready) return <div className="h-72 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;
  if (!profile) {
    return (
      <div className="card p-6">
        <h1 className="font-display text-2xl">Other money</h1>
        <p className="mt-2 text-ink-soft">Set up your business first.</p>
        <Link href="/welcome/" className="btn-primary mt-4">Set up your business</Link>
      </div>
    );
  }

  const read = () => {
    setMessage(""); setError("");
    const results = parseLines(text, { today, structure, partners });
    setCards(results.map((r, i) => ({ key: `${Date.now()}-${i}`, sentence: r.sentence, result: r.result, draft: r.result.ok ? r.result : undefined })));
  };

  const updateDraft = (key: string, patch: Partial<Draft>) =>
    setCards((c) => c.map((x) => (x.key === key && x.draft ? { ...x, draft: { ...x.draft, ...patch } } : x)));

  const post = (card: Card) => {
    const d = card.draft;
    if (!d) return;
    try {
      db.saveEntry({ date: d.date, narration: d.narration, voucher: d.voucher, lines: d.lines, sentence: card.sentence, template: d.template, party: d.party });
      setCards((c) => c.filter((x) => x.key !== card.key));
      setMessage(`Recorded: ${d.readAs}.`);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    }
  };

  const postAll = () => {
    let done = 0;
    for (const card of cards) {
      if (!card.draft) continue;
      try {
        db.saveEntry({ date: card.draft.date, narration: card.draft.narration, voucher: card.draft.voucher, lines: card.draft.lines, sentence: card.sentence, template: card.draft.template, party: card.draft.party });
        done++;
      } catch (e) {
        setError(`${card.sentence}: ${e instanceof Error ? e.message : "not recorded"}`);
        return;
      }
    }
    setCards((c) => c.filter((x) => !x.draft));
    setMessage(`Recorded ${done} entr${done === 1 ? "y" : "ies"}.`);
  };

  const saveManual = () => {
    if (!manual) return;
    try {
      db.saveEntry({ date: manual.date, narration: manual.narration.trim() || "Journal entry", voucher: manual.voucher, lines: manual.lines.filter((l) => l.debit || l.credit) });
      setManual(null);
      setMessage("Entry recorded.");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    }
  };

  const setStructure = (s: Structure) => db.saveProfile({ ...profile, structure: s });
  const setPartners = (list: string[]) => db.saveProfile({ ...profile, partners: list });
  const drafts = cards.filter((c) => c.draft).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl">Other money</h1>
        <p className="mt-1 max-w-3xl text-ink-soft">
          {india
            ? "Anything that is not an invoice or a bill: money you put in or took out, loans and EMIs, fixed deposits, GST and TDS paid, cash taken to the bank, and adjustments at year end. Say it in a sentence, in English or Hinglish."
            : `Anything that is not an invoice or a bill: money you put in or took out, loans and repayments, deposits, ${pack.taxLabel === "Sales tax" || pack.taxLabel === "Tax" ? pack.taxLabel.toLowerCase() : pack.taxLabel} paid, cash taken to the bank, and adjustments at year end. Say it in a sentence.`}{" "}
          You see exactly what it does to your books before anything is recorded.
        </p>
      </header>

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-soft">This business is</span>
          <select className="field w-auto py-1.5" value={structure} onChange={(e) => setStructure(e.target.value as Structure)} aria-label="How the business is owned">
            <option value="proprietorship">a proprietorship</option>
            <option value="partnership">a partnership or LLP</option>
            <option value="company">a company</option>
          </select>
          {structure === "partnership" ? (
            <input
              className="field min-w-[14rem] flex-1 py-1.5" placeholder="Partners, separated by commas: Rahul, Priya"
              defaultValue={partners.join(", ")} aria-label="Partners"
              onBlur={(e) => setPartners(e.target.value.split(",").map((p) => p.trim()).filter(Boolean))}
            />
          ) : null}
        </div>

        <label className="mt-4 block">
          <span className="sr-only">What happened</span>
          <textarea
            className="field min-h-[7rem] font-normal" value={text} onChange={(e) => setText(e.target.value)}
            placeholder={india ? "One per line, for example:\nPaid GST 42,300 for October\nTook 25k cash for home\nHDFC se 5 lakh ka loan liya" : "One per line, for example:\nTook 2,500 cash for personal use\nBank charges 25\nLoan of 100,000 from the bank credited"}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); read(); } }}
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={!text.trim()} onClick={read}><Sparkles size={16} />Read it</button>
          <button type="button" className="btn-quiet" onClick={() => setManual({ date: today, narration: "", voucher: "journal", lines: [{ account: "1020" }, { account: "3000" }] })}>
            Write the entry yourself
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(india ? EXAMPLES : EXAMPLES_WORLD).slice(0, 8).map((ex) => (
            <button key={ex} type="button" className="chip px-2.5 py-1 text-xs" onClick={() => setText((t) => (t.trim() ? `${t.trim()}\n${ex}` : ex))}>{ex}</button>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-faint">
          <Info size={13} className="mt-0.5 shrink-0" />
          Read on this device by fixed rules, never sent anywhere. Sales, bills, equipment and depreciation have their own screens, and it will point you there.
        </p>
      </section>

      {message ? <p role="status" className="rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm">{message}</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</p> : null}

      {manual ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Your entry</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_10rem_1fr]">
            <label className="block text-sm"><span className="label">Date</span><input type="date" className="field" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} /></label>
            <label className="block text-sm"><span className="label">Voucher</span>
              <select className="field" value={manual.voucher} onChange={(e) => setManual({ ...manual, voucher: e.target.value as VoucherType })}>{VOUCHERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="block text-sm"><span className="label">Narration</span><input className="field" value={manual.narration} onChange={(e) => setManual({ ...manual, narration: e.target.value })} placeholder="Being..." /></label>
          </div>
          <div className="mt-4"><LinesEditor lines={manual.lines} onChange={(lines) => setManual({ ...manual, lines })} currency={currency} /></div>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" onClick={saveManual}><Check size={16} />Record it</button>
            <button type="button" className="btn-quiet" onClick={() => setManual(null)}>Cancel</button>
          </div>
        </section>
      ) : null}

      {cards.length ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg">Check before recording</h2>
            {drafts > 1 ? <button type="button" className="btn-primary" onClick={postAll}><Check size={16} />Record all {drafts}</button> : null}
          </div>
          {cards.map((card) => (
            <div key={card.key} className="card p-4">
              <p className="text-sm text-ink-faint">&ldquo;{card.sentence}&rdquo;</p>
              {card.result.ok && card.draft ? (
                <>
                  <p className="mt-1 font-medium">{card.draft.readAs}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_10rem_1fr]">
                    <label className="block text-sm"><span className="label">Date</span><input type="date" className="field py-1.5" value={card.draft.date} onChange={(e) => updateDraft(card.key, { date: e.target.value })} /></label>
                    <label className="block text-sm"><span className="label">Voucher</span>
                      <select className="field py-1.5" value={card.draft.voucher} onChange={(e) => updateDraft(card.key, { voucher: e.target.value as VoucherType })}>{VOUCHERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    </label>
                    <label className="block text-sm"><span className="label">Narration</span><input className="field py-1.5" value={card.draft.narration} onChange={(e) => updateDraft(card.key, { narration: e.target.value })} /></label>
                  </div>
                  <div className="mt-3"><LinesEditor lines={card.draft.lines} onChange={(lines) => updateDraft(card.key, { lines })} currency={currency} /></div>
                  {card.draft.notes.length ? (
                    <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                      {card.draft.notes.map((n) => <li key={n} className="flex gap-1.5"><Info size={14} className="mt-0.5 shrink-0 text-ink-faint" />{n}</li>)}
                    </ul>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <button type="button" className="btn-primary" onClick={() => post(card)}><Check size={16} />Record it</button>
                    <button type="button" className="btn-quiet" onClick={() => setCards((c) => c.filter((x) => x.key !== card.key))}>Leave it</button>
                  </div>
                </>
              ) : !card.result.ok ? (
                <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
                  <p className="flex gap-1.5 text-sm"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />{card.result.says}</p>
                  <span className="flex gap-2">
                    {card.result.goTo ? <Link href={card.result.goTo.href} className="btn-ghost text-sm">{card.result.goTo.label}</Link> : null}
                    <button type="button" className="btn-quiet text-sm" onClick={() => setCards((c) => c.filter((x) => x.key !== card.key))}>Dismiss</button>
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-5">
          <h2 className="font-display text-lg">Recorded</h2>
          <Link href="/books/" className="btn-quiet text-sm">See them in your accounts</Link>
        </div>
        {saved.length === 0 ? <p className="p-5 text-sm text-ink-soft">Nothing recorded here yet.</p> : null}
        <ul className="divide-y divide-line">
          {(showAll ? saved : saved.slice(0, 30)).map((e: ManualEntry) => {
            const total = e.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
            return (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-[14rem] flex-1">
                  <p className="font-medium">{e.narration}</p>
                  <p className="text-sm text-ink-soft">
                    {formatDate(e.date, country)} · {e.voucher}
                    {" · "}
                    {e.lines.map((l) => `${l.debit ? "Dr" : "Cr"} ${accountByCode(l.account)?.name ?? l.account}${l.memo ? ` (${l.memo})` : ""}`).join(", ")}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <span className="tabular font-medium">{m(total)}</span>
                  <button type="button" className="rounded p-2 text-ink-faint hover:text-bad" aria-label={`Delete ${e.narration}`}
                    onClick={() => { if (confirm(`Delete "${e.narration}" from the books?`)) { try { db.deleteEntry(e.id); } catch (err) { setError(err instanceof Error ? err.message : "Could not delete."); } } }}>
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {saved.length > 30 && !showAll ? <button type="button" className="btn-quiet m-4 text-sm" onClick={() => setShowAll(true)}>Show all {saved.length}</button> : null}
      </section>
    </div>
  );
}
