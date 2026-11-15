"use client";
import { CloudOff } from "lucide-react";
import { useEffect, useState } from "react";
import { entities } from "@/lib/store/entities";

/**
 * Keeping the app usable with no signal, and saying so.
 *
 * Two small jobs. It registers the service worker, which is what lets NXOne open at all when
 * there is nothing to reach. And when the signal goes, it says one sentence — because the thing a
 * person needs to know at that moment is not that the connection failed, but that their work is
 * still safe and they can carry on.
 *
 * It does nothing at all until the page has settled, so it never competes with the first paint.
 */
export default function Offline() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // The business that was open last time is opened again before anything reads the books.
    entities.restore();

    const goneOffline = () => setOffline(true);
    const backOnline = () => setOffline(false);
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    window.addEventListener("offline", goneOffline);
    window.addEventListener("online", backOnline);

    let cancelled = false;
    const register = () => {
      if (cancelled || !("serviceWorker" in navigator)) return;
      // A file:// or a preview without a secure origin cannot have one, and that is fine.
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    };
    // After load, so the first visit is not made slower by it.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("offline", goneOffline);
      window.removeEventListener("online", backOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 bg-ink px-4 py-2 text-center text-sm text-white">
      <CloudOff size={15} className="shrink-0" aria-hidden="true" />
      <span>No signal. Everything here still works and is saved on this device; anything you have an account for catches up when you are back.</span>
    </div>
  );
}
