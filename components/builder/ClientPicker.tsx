"use client";
import { Check, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { store } from "@/lib/store/db";
import type { Client } from "@/lib/store/types";
import type { DocumentData } from "@/lib/documents/types";
import { describeTerms, takesPaymentTerms } from "@/lib/customers/customers";
import { withCustomer } from "./state";

/**
 * Start typing a customer you have billed before and the rest of their details arrive with them.
 * A customer you have not saved is offered for saving, once, rather than nagged about.
 */
export default function ClientPicker({ doc, update }: { doc: DocumentData; update: (patch: Partial<DocumentData>) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** The customer just chosen, when choosing them set the due date, so that can be said. */
  const [picked, setPicked] = useState<Client | undefined>();
  const box = useRef<HTMLDivElement>(null);
  const results = store.findClients(query || doc.buyer.name, 6);
  const known = store.clients().some((c) => c.name.trim().toLowerCase() === doc.buyer.name.trim().toLowerCase());

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const choose = (c: Client) => {
    const next = withCustomer(doc, c);
    update({ buyer: next.buyer, placeOfSupply: next.placeOfSupply, dueDate: next.dueDate });
    setQuery(""); setOpen(false);
    setPicked(c.termsDays !== undefined && takesPaymentTerms(doc.kind) ? c : undefined);
  };

  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-2 focus-within:border-forest">
        <Search size={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
        <input
          className="w-full bg-transparent py-2 text-sm outline-none"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={results.length ? "Find a saved customer" : "No saved customers yet"}
          aria-label="Find a saved customer"
          autoComplete="off"
        />
      </div>

      {open && results.length > 0 ? (
        <ul className="absolute z-30 mt-1 max-h-72 w-full min-w-[18rem] overflow-auto rounded-lg border border-line bg-white shadow-card" role="listbox">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => choose(c)} className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-forest-pale">
                <span className="text-sm font-medium text-ink">{c.name}</span>
                <span className="text-xs text-ink-faint">{[c.taxId, c.email, c.address?.split("\n")[0]].filter(Boolean).join(" · ") || "No other details saved"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {doc.buyer.name.trim() ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-faint">
          <Check size={15} className="text-ok" aria-hidden="true" />
          {known
            ? picked
              ? `One of your customers. Due date set from their terms: ${describeTerms(picked.termsDays).toLowerCase()}.`
              : "One of your customers. Any details you change here are kept for next time."
            : "Saved to your customers when you save or download this."}
        </p>
      ) : null}
    </div>
  );
}
