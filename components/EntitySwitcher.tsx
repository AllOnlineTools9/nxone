"use client";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useEntities, useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * Which business you are in.
 *
 * It only appears once there is more than one, so somebody with a single business never has to
 * think about the idea at all. When there are two it is always visible, because the one way this
 * could do real harm is a customer invoiced from the wrong business, and that happens when the
 * screen is quiet about which set of books is open.
 */
export default function EntitySwitcher() {
  const list = useEntities();
  const [ws] = useWorkspace();
  const ready = useHydrated();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape); };
  }, [open]);

  if (!ready) return null;

  const all = list.list();
  const active = list.active();
  const name = ws.profile?.name || active?.name || "Untitled business";

  // One business needs no switcher; the second is what makes the question worth asking.
  if (all.length < 2) {
    return (
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink-soft hover:bg-canvas"
        onClick={() => { list.add(); router.push("/welcome/"); }}
      >
        <Plus size={15} className="shrink-0" aria-hidden="true" />
        <span>Add another business</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left hover:border-ink"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(!open)}
      >
        <Building2 size={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block text-[0.68rem] text-ink-faint">{all.length} businesses on this device</span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
      </button>

      {open ? (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
          {all.map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                role="option"
                aria-selected={entity.id === active?.id}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas"
                onClick={() => { list.open(entity.id); setOpen(false); router.push("/today/"); }}
              >
                <Check size={14} className={`shrink-0 ${entity.id === active?.id ? "text-forest" : "invisible"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entity.name || "Untitled business"}</span>
                  {entity.currency ? <span className="block text-[0.68rem] text-ink-faint">{entity.country} · {entity.currency}</span> : null}
                </span>
              </button>
            </li>
          ))}
          <li className="border-t border-line">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-soft hover:bg-canvas"
              onClick={() => { list.add(); setOpen(false); router.push("/welcome/"); }}
            >
              <Plus size={14} className="shrink-0" aria-hidden="true" />
              Add another business
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
