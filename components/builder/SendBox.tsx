"use client";
import { Check, Copy, Link2, Mail, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { sendLinks } from "@/lib/documents/send";
import { snapshotFor } from "@/lib/documents/share";
import { shareDocument, syncAvailable } from "@/lib/sync/api";
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
  doc, totals, downloaded, onDownload, documentId
}: {
  doc: DocumentData;
  totals: DocumentTotals;
  /** Set once saved, so a link can point at something that will still be here. */
  documentId?: string;
  /** Whether the PDF has been saved in this sitting, so the reminder can relax once it has. */
  downloaded: boolean;
  onDownload: () => void;
}) {
  const [copied, setCopied] = useState<"body" | "short" | "link" | null>(null);
  const [link, setLink] = useState("");
  const [sharing, setSharing] = useState(false);

  /**
   * A link the customer can open instead of an attachment. The snapshot is built here and
   * checked again on the server: what a customer sees is the document, and nothing else the
   * business knows about them.
   */
  const share = async () => {
    if (!documentId) return;
    setSharing(true);
    const result = await shareDocument({ documentId, number: doc.number, snapshot: snapshotFor(doc) });
    setSharing(false);
    if (result.ok) setLink(`${window.location.origin}/view/${result.data.token}/`);
  };
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
        {syncAvailable() && documentId ? (
          <button type="button" className="btn-quiet" onClick={share} disabled={sharing}>
            <Link2 size={15} />{sharing ? "Making a link" : link ? "Refresh the link" : "Share a link instead"}
          </button>
        ) : null}
        <button type="button" className="btn-quiet" onClick={() => copy("short")}>
          {copied === "short" ? <><Check size={15} className="text-ok" />Copied</> : <><Copy size={15} />Copy the short one</>}
        </button>
      </div>

      {link ? (
        <p className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm">
          <span className="block text-ink-soft">
            Anyone with this link can read this {what}. Nothing else of yours is behind it, and you
            can withdraw it later.
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all text-xs">{link}</code>
            <button
              type="button" className="btn-quiet text-sm"
              onClick={async () => {
                try { await navigator.clipboard.writeText(link); setCopied("link"); setTimeout(() => setCopied(null), 2000); } catch { /* on screen to copy */ }
              }}
            >{copied === "link" ? <><Check size={14} className="text-ok" />Copied</> : <><Copy size={14} />Copy</>}</button>
          </span>
        </p>
      ) : null}

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
