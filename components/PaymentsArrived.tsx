"use client";
import { BadgeIndianRupee, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { applyArrived, type Application, type Refusal } from "@/lib/payments/arrived";
import { paymentsApplied, paymentsArrived, syncAvailable } from "@/lib/sync/api";
import { formatMoney, fromMinor } from "@/lib/money";
import { store } from "@/lib/store/db";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Payments that came in through a link while nobody was watching.
 *
 * Checked once when a screen opens rather than on a timer: a business does not need to know
 * within thirty seconds, and a device that polls all day is a device with a flat battery.
 *
 * Anything that cannot be applied cleanly — an invoice already settled, an amount that would
 * overshoot, a cancelled invoice — is shown rather than forced through. Money appearing twice
 * in the books is worse than money appearing a day late.
 */
export default function PaymentsArrived() {
  const [, db] = useWorkspace();
  const ready = useHydrated();
  const [applied, setApplied] = useState<Application[]>([]);
  const [refused, setRefused] = useState<Refusal[]>([]);

  const money = useCallback(
    (minor: number) => formatMoney(fromMinor(minor, db.getProfile()?.currency ?? "INR")),
    [db]
  );

  useEffect(() => {
    if (!ready || !syncAvailable()) return;
    let stopped = false;

    (async () => {
      const result = await paymentsArrived();
      if (!result.ok || stopped || result.data.payments.length === 0) return;

      const { apply, refuse } = applyArrived(result.data.payments, db.documents(), money);
      for (const one of apply) {
        try {
          store.setStatus(one.documentId, one.status, one.paidMinor, one.paidOn);
        } catch (e) {
          // A closed period refuses the write, and says why. Better shown than swallowed.
          refuse.push({ documentId: one.documentId, why: e instanceof Error ? e.message : "That could not be recorded." });
        }
      }

      const recorded = apply.filter((a) => !refuse.some((r) => r.documentId === a.documentId));
      if (recorded.length > 0) await paymentsApplied(recorded.map((a) => a.documentId));
      if (stopped) return;
      setApplied(recorded);
      setRefused(refuse);
    })();

    return () => { stopped = true; };
  }, [ready, db, money]);

  if (applied.length === 0 && refused.length === 0) return null;

  return (
    <div className="space-y-3">
      {applied.length > 0 ? (
        <section className="rounded-lg border border-ok/30 bg-ok/5 p-4">
          <h2 className="flex items-center gap-2 font-medium text-ok">
            <BadgeIndianRupee size={17} aria-hidden="true" />
            {applied.length === 1 ? "A payment came in" : `${applied.length} payments came in`}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {applied.map((a) => <li key={a.documentId}>{a.describes}</li>)}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Already recorded against the invoice. Nothing to do.</p>
        </section>
      ) : null}

      {refused.length > 0 ? (
        <section className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <h2 className="flex items-center gap-2 font-medium text-warn">
            <TriangleAlert size={17} aria-hidden="true" />Worth a look
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {refused.map((r) => <li key={r.documentId}>{r.why}</li>)}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">
            These were left alone rather than guessed at. Money shown twice is harder to unpick than money shown late.
          </p>
        </section>
      ) : null}
    </div>
  );
}
