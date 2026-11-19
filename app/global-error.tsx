"use client";
import "./globals.css";
import ErrorScreen from "@/components/ErrorScreen";

/** When even the page's frame fails. It has to bring its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink"><ErrorScreen error={error} reset={reset} /></body>
    </html>
  );
}
