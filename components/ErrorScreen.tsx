"use client";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { reportError } from "@/lib/telemetry/report";

/**
 * What a page shows when it breaks. Work is kept on the device as it is typed, so the honest
 * thing to say is that nothing was lost, and to offer the two ways back.
 */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error, { digest: error.digest }); }, [error]);
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="font-display text-2xl">This page stopped working</h1>
      <p className="mt-3 text-ink-soft">
        Your work is saved on this device, so nothing has been lost. We have been told about the
        problem. Try the page again, or go back to your documents.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" className="btn-primary" onClick={reset}><RotateCcw size={16} />Try again</button>
        <Link href="/documents" className="btn-ghost">Your documents</Link>
      </div>
    </div>
  );
}
