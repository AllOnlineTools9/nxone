"use client";
import { Check, Copy, Loader2, Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { sendLinks } from "@/lib/documents/send";
import { snapshotFor } from "@/lib/documents/share";
import { shareDocument, syncAvailable } from "@/lib/sync/api";
import type { DocumentData, DocumentTotals } from "@/lib/documents/types";
import { kindConfig } from "@/lib/documents/kinds";

/**
 * Sending the document: WhatsApp or email, and nothing else to decide.
 *
 * Neither a WhatsApp message nor an email draft can carry an attachment, which used to mean
 * saving the PDF and attaching it by hand. So when you are signed in, each message carries a link
 * to the document instead, which the customer opens on their phone with nothing to attach. When
 * you are not, the PDF is saved for you as the message opens, and the screen says to attach it.
 */
export default function SendBox({
  doc, totals, onDownload, documentId, ensureSaved
}: {
  doc: DocumentData;
  totals: DocumentTotals;
  /** Not used for the decision any more, kept so the builder's call stays the same shape. */
  downloaded?: boolean;
  onDownload: () => void | Promise<void>;
  /** Set once saved, so a link can point at something that will still be here. */
  documentId?: string;
  /** Saves the document as sent and returns its id, for a link to point at. */
  ensureSaved?: () => string | undefined;
}) {
  const [busy, setBusy] = useState<"whatsapp" | "email" | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const what = kindConfig(doc.kind).title.toLowerCase();
  const preview = sendLinks(doc, totals);

  const send = async (channel: "whatsapp" | "email") => {
    // WhatsApp opens in a new tab, and a browser only allows that inside the click itself. The
    // link is made after a network call, so the tab is opened now and pointed at it after.
    const tab = channel === "whatsapp" ? window.open("", "_blank") : null;
    setBusy(channel);
    setNote("");

    let id = documentId;
    try {
      id = id ?? ensureSaved?.();
    } catch (e) {
      tab?.close();
      setBusy(null);
      setNote(e instanceof Error ? e.message : "This could not be saved, so it cannot be sent yet.");
      return;
    }

    let viewUrl: string | undefined;
    if (syncAvailable() && id) {
      const shared = await shareDocument({ documentId: id, number: doc.number, snapshot: snapshotFor(doc) });
      if (shared.ok) viewUrl = `${window.location.origin}/view/${shared.data.token}/`;
    }

    // No link means not signed in, or the API could not be reached: fall back to the PDF.
    if (!viewUrl) await onDownload();

    const links = sendLinks(doc, totals, "en-IN", viewUrl);
    if (channel === "whatsapp") {
      if (tab) tab.location.href = links.whatsapp;
      else window.location.href = links.whatsapp;
    } else {
      window.location.href = links.mail;
    }

    const to = channel === "whatsapp"
      ? (links.hasPhone ? "" : " Choose who to send it to in WhatsApp.")
      : (links.hasEmail ? "" : " Add their email address in the To line.");
    setNote(viewUrl
      ? `The message has a link to this ${what}, so there is nothing to attach.${to}`
      : `Sign in and the message will carry a link instead. For now the PDF is saved: attach it to the message.${to}`);
    setBusy(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview.text.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* on screen to copy by hand */ }
  };

  return (
    <section className="no-print card p-5">
      <h2 className="font-display text-lg">Send it</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {syncAvailable()
          ? `The message is written for you, with a link to the ${what} so there is nothing to attach.`
          : `The message is written for you. Attach the PDF, which is saved as it opens.`}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button" onClick={() => send("whatsapp")} disabled={busy !== null}
          className="btn-primary justify-center py-3 text-base"
        >
          {busy === "whatsapp" ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={18} />}
          WhatsApp
        </button>
        <button
          type="button" onClick={() => send("email")} disabled={busy !== null}
          className="btn-ghost justify-center py-3 text-base"
        >
          {busy === "email" ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
          Email
        </button>
      </div>

      <p className="mt-2 text-xs text-ink-faint">
        {preview.hasPhone ? `WhatsApp goes to ${doc.buyer.phone}. ` : "No phone number on this, so WhatsApp will ask who to send it to. "}
        {preview.hasEmail ? `Email goes to ${doc.buyer.email}.` : "No email address on this, so you will fill one in."}
      </p>

      {note ? <p className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm">{note}</p> : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-ink-soft">See the message</summary>
        <p className="mt-2 text-xs font-medium uppercase tracking-wider text-ink-faint">Email - {preview.text.subject}</p>
        <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-sm">{preview.text.body}</pre>
        <p className="mt-3 text-xs font-medium uppercase tracking-wider text-ink-faint">WhatsApp</p>
        <p className="rounded-lg border border-line bg-canvas p-3 text-sm">{preview.text.short}</p>
        <p className="mt-2 text-xs text-ink-faint">The link to the {what} is added when you send.</p>
        <button type="button" className="btn-quiet mt-2 text-sm" onClick={copy}>
          {copied ? <><Check size={14} className="text-ok" />Copied</> : <><Copy size={14} />Copy the email text</>}
        </button>
      </details>
    </section>
  );
}
