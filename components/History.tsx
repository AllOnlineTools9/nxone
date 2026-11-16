"use client";
import { History as HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { describe, fieldName, materialChange } from "@/lib/store/audit";
import { formatDate } from "@/lib/format";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * What changed, and when.
 *
 * On one device the question is never who did it. It is what this invoice said before somebody
 * changed it, which comes up every time a figure is queried months later and nobody can
 * remember. Changes that move the books are marked, because those are the ones worth reading.
 */
export default function History({ recordId, limit }: { recordId?: string; limit?: number }) {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  const [onlyMaterial, setOnlyMaterial] = useState(false);

  const entries = useMemo(() => {
    const all = db.auditTrail();
    const forRecord = recordId ? all.filter((e) => e.recordId === recordId) : all;
    const filtered = onlyMaterial ? forRecord.filter((e) => materialChange(e.changes ?? [])) : forRecord;
    return limit ? filtered.slice(0, limit) : filtered;
  }, [db, recordId, onlyMaterial, limit]);

  if (!ready) return null;

  const country = ws.profile?.country ?? "IN";
  const when = (at: string) => {
    const date = formatDate(at.slice(0, 10), country);
    const time = at.slice(11, 16);
    return `${date} at ${time}`;
  };

  if (entries.length === 0) {
    return (
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <HistoryIcon size={17} className="text-ink-faint" aria-hidden="true" />History
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {onlyMaterial
            ? "Nothing has changed that would change the books."
            : "Nothing recorded yet. Every change from here is kept."}
        </p>
        {onlyMaterial ? (
          <button type="button" className="btn-quiet mt-3" onClick={() => setOnlyMaterial(false)}>Show everything</button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <HistoryIcon size={17} className="text-ink-faint" aria-hidden="true" />History
        </h2>
        <button type="button" className="btn-quiet text-sm" onClick={() => setOnlyMaterial(!onlyMaterial)}>
          {onlyMaterial ? "Show everything" : "Only what moves the books"}
        </button>
      </div>

      <ul className="mt-4 divide-y divide-line">
        {entries.map((entry) => (
          <li key={entry.id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm">{describe(entry)}</span>
              <span className="text-xs tabular text-ink-faint">{when(entry.at)}</span>
            </div>
            {entry.changes && entry.changes.length > 1 ? (
              <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                {entry.changes.map((c) => (
                  <li key={c.field}>
                    {fieldName(c.field)}: {c.from} → {c.to}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-ink-faint">
        The last {entries.length === 500 ? "500 changes" : "changes"} are kept on this device.
        Older history is dropped rather than filling the space your books need.
      </p>
    </section>
  );
}
