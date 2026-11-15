"use client";
import { Check, Copy, Mail, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { sendLinks } from "@/lib/documents/send";
import type { DocumentData, DocumentTotals } from "@/lib/documents/types";
import { kindConfig } from "@/lib/documents/kinds";

/**
 * Sending the document to the person who has to act on it.
 *
 * NXOne has no mail server and does not pretend to: these open the person's own email or
 * WhatsApp with the message already written, so it arrives from their address and a reply comes
 * back to them. The one thing a draft like this cannot do is carry the PDF, so that is said
 * first, in plain words, rather than discovered by a customer receiving an empty email.
 */
export default function SendBox({
  doc, totals, downloaded, onDownload
}: {
  doc: DocumentData;
  totals: DocumentTotals;
  /** Whether the PDF has been saved in this sitting, so the reminder can relax once it has. */
  downloaded: boolean;
  onDownload: () => void;
}) {
  const [copied, setCopied] = useState<"body" | "short" | null>(null);
  const links = sendLinks(doc, totals);
  const what = kindConfig(doc.kind).title.toLowerCase();

  const copy = async (which: "body" | "short") => {
    try {
      await navigator.clipboard.writeText(which === "body" ? links.text.body : links.text.short);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard blocked: the text is on screen to copy by hand */ }
  };

  return (
    <section className="no-print card p-5">
      <h2 className="flex items-center gap-2 font-display text-lg"><Send size={17} className="text-ink-faint" aria-hidden="true" />Send it</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {downloaded
          ? `Your PDF is saved. Attach it to whichever of these you use — the message is already written.`
          : `Save the PDF first, then attach it to one of these. The message is already written; the attachment is the one thing we cannot put in for you.`}
      </p>

      {links.noContact ? (
        <p className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">
          There is no email address or phone number on this {what}, so there is nowhere to send it.
          Add one to the customer above, or copy the message and send it yourself.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!downloaded ? (
          <button type="button" className="btn-primary" onClick={onDownload}>Save the PDF first</button>
        ) : null}

        {links.mail ? (
          <a className={downloaded ? "btn-primary" : "btn-ghost"} href={links.mail}>
            <Mail size={16} /> Write the email
          </a>
        ) : null}

        {links.whatsapp ? (
          <a className="btn-ghost" href={links.whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={16} /> Send on WhatsApp
          </a>
        ) : null}

        <button type="button" className="btn-quiet" onClick={() => copy("body")}>
          {copied === "body" ? <><Check size={15} className="text-ok" />Copied</> : <><Copy size={15} />Copy the message</>}
        </button>
        <button type="button" className="btn-quiet" onClick={() => copy("short")}>
          {copied === "short" ? <><Check size={15} className="text-ok" />Copied</> : <><Copy size={15} />Copy the short one</>}
        </button>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-ink-soft">See what it says</summary>
        <p className="mt-2 text-xs font-medium uppercase tracking-wider text-ink-faint">Subject</p>
        <p className="text-sm">{links.text.subject}</p>
        <p className="mt-3 text-xs font-medium uppercase tracking-wider text-ink-faint">Message</p>
        <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-sm">{links.text.body}</pre>
        <p className="mt-3 text-xs font-medium uppercase tracking-wider text-ink-faint">On WhatsApp</p>
        <p className="rounded-lg border border-line bg-canvas p-3 text-sm">{links.text.short}</p>
      </details>
    </section>
  );
}
