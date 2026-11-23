"use client";
import { Globe2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FEATURES, blockedFor, countriesWith, inSentence } from "@/lib/countries/features";
import { packFor } from "@/lib/countries/packs";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Stands in for a page that belongs to another country - a business in the US opening the GST
 * returns page from an old link or a bookmark. The sidebar already hides these; this catches the
 * ways in that do not go through the sidebar.
 */
export default function CountryGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [ws] = useWorkspace();
  const ready = useHydrated();
  const country = ws.profile?.country;
  const blocked = ready ? blockedFor(country, pathname) : undefined;
  if (!blocked) return <>{children}</>;

  const here = inSentence(packFor(country).name);
  const where = countriesWith(blocked);
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <div className="card p-6">
        <Globe2 size={22} className="text-ink-faint" aria-hidden />
        <p className="mt-3 text-xs font-medium uppercase tracking-wider text-ink-faint">{FEATURES[blocked].name}</p>
        <h1 className="mt-1 font-display text-xl">Only for businesses in {where.join(" and ") || "another country"}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {ws.profile?.name || "This business"} is set up in {here}, so this page does not apply to it.
          Your invoices, expenses and accounts work the same in every country.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          If you also run a business in {where[0] ?? "another country"}, add it as another business and switch to it from the top of the menu.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/today/" className="btn-primary">Go to Today</Link>
          <Link href="/settings/" className="btn-ghost">Business details</Link>
        </div>
      </div>
    </div>
  );
}
