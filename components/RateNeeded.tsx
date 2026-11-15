"use client";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { unrated } from "@/lib/fx";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * The one thing a set of books must never do is leave money out without saying so.
 *
 * An invoice billed in another currency with no exchange rate cannot be added to anything — there
 * is no honest number to add. So rather than quietly excluding it and showing a total that looks
 * complete, every screen that adds money up carries this, naming what is missing and how much of
 * it there is.
 */
export default function RateNeeded() {
  const [ws, db] = useWorkspace();
  const ready = useHydrated();
  if (!ready) return null;

  const base = ws.profile?.currency;
  if (!base) return null;

  const missing = unrated(db.documents(), db.expenses(), base);
  if (!missing.totalDocuments) return null;

  const what = [
    missing.documents.length && `${missing.documents.length} invoice${missing.documents.length === 1 ? "" : "s"}`,
    missing.expenses.length && `${missing.expenses.length} bill${missing.expenses.length === 1 ? "" : "s"}`
  ].filter(Boolean).join(" and ");

  return (
    <div className="rounded-xl border border-warn/40 bg-warn/5 p-4">
      <div className="flex gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
        <div>
          <p className="font-medium">
            {what} in {missing.currencies.join(" and ")} {missing.totalDocuments === 1 ? "has" : "have"} no exchange rate
          </p>
          <p className="mt-0.5 text-sm text-ink-soft">
            Your books are kept in {base}, so nothing on this page counts {missing.totalDocuments === 1 ? "it" : "them"} until you say what the rate was.
            Open {missing.documents.length === 1 && !missing.expenses.length ? missing.documents[0].number : "each one"} and put in the rate your bank gave you.
          </p>
          <Link href={missing.expenses.length && !missing.documents.length ? "/expenses/" : "/documents/"} className="mt-2 inline-block text-sm font-medium underline">
            {missing.expenses.length && !missing.documents.length ? "Go to bills" : "Go to documents"}
          </Link>
        </div>
      </div>
    </div>
  );
}
