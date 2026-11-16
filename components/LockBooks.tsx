"use client";
import { Lock, LockOpen, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { describeMove, endOfPreviousMonth, wouldClose } from "@/lib/books/lock";
import { formatDate, todayIso } from "@/lib/format";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Closing the books to a date.
 *
 * The day you file a return, that period has to stop moving, or the return and the books drift
 * apart and nobody finds out until a notice arrives. Moving the lock forward is routine and
 * needs no ceremony. Moving it back reopens a filed period, so it says what it is reopening
 * and makes the person agree to that in particular, rather than to a generic "are you sure".
 */
export default function LockBooks() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [proposed, setProposed] = useState("");
  const [message, setMessage] = useState("");

  if (!ready || !ws.profile) return null;

  const country = ws.profile.country ?? "IN";
  const show = (iso: string) => formatDate(iso, country);
  const current = ws.profile.lockedUpTo;
  const target = proposed || current || endOfPreviousMonth(todayIso());
  const move = describeMove(current, target, show);
  const closing = wouldClose([...db.documents(), ...db.expenses()], target, current);

  const apply = (to?: string) => {
    store.saveProfile({ ...ws.profile!, lockedUpTo: to });
    setProposed("");
    setMessage(to ? `The books are closed to ${show(to)}.` : "The books are open again. Nothing is locked.");
  };

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-display text-lg">
        {current ? <Lock size={17} className="text-ink-faint" aria-hidden="true" /> : <LockOpen size={17} className="text-ink-faint" aria-hidden="true" />}
        Closing the books
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        {current
          ? `Everything dated on or before ${show(current)} is closed: it cannot be edited, deleted or paid into. That is what keeps what you filed and what your books say in agreement.`
          : "Nothing is closed yet. Once you have filed a return for a period, close the books to the end of it, so a later edit cannot put your books out of step with what you filed."}
      </p>

      {message ? <p className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm">{message}</p> : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">Close the books up to</span>
          <input type="date" className="field mt-1" value={target} onChange={(e) => setProposed(e.target.value)} />
        </label>
        <button type="button" className="btn-primary" onClick={() => apply(target)} disabled={target === current}>
          {current ? "Move the lock" : "Close the books"}
        </button>
        {current ? (
          <button type="button" className="btn-quiet" onClick={() => apply(undefined)}>Open everything again</button>
        ) : null}
      </div>

      {target !== current ? (
        move.direction === "back" ? (
          <p className="mt-3 flex gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {move.warning}
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">
            {closing === 0
              ? "Nothing new falls inside that date."
              : `This closes ${closing} ${closing === 1 ? "record" : "records"} that can be edited today.`}
          </p>
        )
      ) : null}

      <p className="mt-4 text-xs text-ink-faint">
        A closed period is corrected the way an accountant corrects one: a credit note or an
        adjustment dated today, not an edit to what was filed.
      </p>
    </section>
  );
}
