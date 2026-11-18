"use client";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** The site's pages on a phone, where the header has no room to list them. */
export default function MobileNav({ items }: { items: Array<{ href: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const box = useRef<HTMLDivElement>(null);

  // Closes on moving to another page, on a tap outside, and on Escape.
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} className="relative md:hidden">
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-2.5 text-ink hover:bg-white" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open ? (
        <nav aria-label="Main" className="card absolute right-0 top-full z-50 mt-2 w-60 p-2">
          <ul>
            {items.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="block rounded-lg px-3 py-3 text-base font-medium text-ink hover:bg-canvas">{n.label}</Link>
              </li>
            ))}
            <li className="mt-1 border-t border-line pt-1">
              <Link href="/dashboard" className="block rounded-lg px-3 py-3 text-base font-medium text-ink hover:bg-canvas">Open the app</Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
