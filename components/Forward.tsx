"use client";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Sends an old address to its new one. The site is exported as static files, so this happens in
 * the browser; the link is there for the moment before it does, and for anyone without scripts.
 */
export default function Forward({ to }: { to: string }) {
  useEffect(() => { window.location.replace(to); }, [to]);
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-ink-soft">This page has moved.</p>
      <Link href={to} className="btn-primary mt-4 inline-flex">Go to the new page</Link>
    </div>
  );
}
