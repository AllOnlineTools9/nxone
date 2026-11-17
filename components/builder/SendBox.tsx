"use client";
import { Check, Copy, Loader2, Mail, MessageCircle, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sendLinks, sendMessage } from "@/lib/documents/send";
import { snapshotFor } from "@/lib/documents/share";
import { buildPdf, documentFileName } from "@/lib/documents/pdf";
import { blobToBase64 } from "@/lib/files/base64";
import { shareDocument, syncAvailable } from "@/lib/sync/api";
import type { DocumentData, DocumentTotals } from "@/lib/documents/types";
import { kindConfig } from "@/lib/documents/kinds";

/**
 * Sending the document: WhatsApp or email, from the person's own apps and accounts.
 *
 * A web page cannot attach a file to an email draft or a WhatsApp message. What it can do, where
 * the device has one, is open the share sheet with the PDF already in it: the person picks Gmail,
 * Outlook, Mail or WhatsApp, and that app opens with the PDF attached, sending from their own
 * account. Phones have it, and so do most Windows and Mac browsers.
 *
 * Where there is no share sheet, the message opens written for them with a link the customer
 * can view and download from (when signed in), and the PDF is saved to attach by hand.
 */

type Channel = "whatsapp" | "email";

/** Whether this browser can hand a PDF to another app. */
function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File(["%PDF-"], "test.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

/** A phone. WhatsApp on a computer keeps the link, since the share sheet there rarely offers it. */
const isPhone = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);

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
  const [busy, setBusy] = useState<Channel | null>(null);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareFiles, setShareFiles] = useState(false);
  const [phone, setPhone] = useState(false);
  /** The PDF for the document as it is now, made ahead so the share sheet can open on the tap. */
  const ready = useRef<{ doc: DocumentData; file: File } | null>(null);
  /** The customer link from an earlier send, so a later message can carry it without waiting. */
  const knownLink = useRef<{ id: string; url: string } | null>(null);

  const what = kindConfig(doc.kind).title.toLowerCase();
  const preview = sendLinks(doc, totals);

  useEffect(() => {
    setShareFiles(canShareFiles());
    setPhone(isPhone());
  }, []);

  // A browser only opens the share sheet inside the tap itself, and making a PDF takes longer
  // than it allows. So the PDF is made quietly while the document is edited.
  useEffect(() => {
    if (!shareFiles) return;
    const timer = setTimeout(async () => {
      try {
        const blob = await buildPdf(doc);
        ready.current = { doc, file: new File([blob], documentFileName(doc), { type: "application/pdf" }) };
      } catch { ready.current = null; }
    }, 700);
    return () => clearTimeout(timer);
  }, [doc, shareFiles]);

  /** Saves it as sent. A closed period or similar refuses, and says why. */
  const save = (): { ok: true; id?: string } | { ok: false } => {
    try {
      return { ok: true, id: documentId ?? ensureSaved?.() };
    } catch (e) {
      setNote(e instanceof Error ? e.message : "This could not be saved, so it cannot be sent yet.");
      setFailed(true);
      return { ok: false };
    }
  };

  /** A link to the document, with its PDF, for the customer to open. Undefined when signed out. */
  const shareLink = async (id: string | undefined, pdf?: Blob): Promise<string | undefined> => {
    if (!syncAvailable() || !id) return undefined;
    const encoded = pdf ? await blobToBase64(pdf).catch(() => undefined) : undefined;
    const shared = await shareDocument({ documentId: id, number: doc.number, snapshot: snapshotFor(doc), pdf: encoded });
    if (!shared.ok) return undefined;
    const url = `${window.location.origin}/view/${shared.data.token}/`;
    knownLink.current = { id, url };
    return url;
  };

  const start = (channel: Channel) => { setBusy(channel); setNote(""); setFailed(false); };

  /**
   * The share sheet, with the PDF attached. Returns false when it could not be tried, so the
   * caller falls back to a written message.
   */
  const shareWithPdf = (channel: Channel): boolean => {
    const file = ready.current?.doc === doc ? ready.current.file : null;
    if (!file) return false;

    setNote(""); setFailed(false);
    const saved = save();
    if (!saved.ok) return true;
    const id = saved.id;
    const link = id && knownLink.current?.id === id ? knownLink.current.url : undefined;
    const text = sendMessage(doc, totals, "en-IN", link, { attached: true });

    try {
      // Called before anything is awaited, so the browser still counts it as the tap.
      const shared = channel === "email"
        ? navigator.share({ files: [file], title: text.subject, text: text.body })
        : navigator.share({ files: [file], text: text.short });
      shared
        .then(() => {
          setNote(channel === "email"
            ? "Your email app has the PDF attached. Add who it is to and send it from there."
            : "Sent with the PDF attached.");
          // The link page gets the same PDF, for anyone who opens it later.
          void shareLink(id, file);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return; // they closed the sheet
          setNote("The share sheet did not open. Use the option below to send it another way.");
          setFailed(true);
        });
      return true;
    } catch {
      return false;
    }
  };

  /** No share sheet: the message opens written for them, with a link, and the PDF is saved. */
  const writtenMessage = async (channel: Channel) => {
    // WhatsApp opens in a new tab, and a browser only allows that inside the click itself.
    const tab = channel === "whatsapp" ? window.open("", "_blank") : null;
    start(channel);
    const saved = save();
    if (!saved.ok) { tab?.close(); setBusy(null); return; }

    const pdf = syncAvailable() ? await buildPdf(doc).catch(() => undefined) : undefined;
    const viewUrl = await shareLink(saved.id, pdf);
    // Email always gets the PDF saved, because the person attaches it from their own account.
    if (!viewUrl || channel === "email") await onDownload();

    const links = sendLinks(doc, totals, "en-IN", viewUrl);
    if (channel === "whatsapp") {
      if (tab) tab.location.href = links.whatsapp; else window.location.href = links.whatsapp;
      const pick = links.hasPhone ? "" : " Choose who to send it to in WhatsApp.";
      setNote(viewUrl
        ? `The message has a link where they can view and download the PDF.${pick}`
        : `The PDF is saved: attach it to the message.${pick}`);
    } else {
      window.location.href = links.mail;
      setNote(`The PDF is saved to your downloads: drag it into the email to attach it.${viewUrl ? " The email also has a link where they can view and download it." : ""}`);
    }
    setBusy(null);
  };

  const send = (channel: Channel) => {
    // WhatsApp uses the share sheet only on a phone; email uses it wherever it exists.
    const sheet = channel === "email" ? shareFiles : shareFiles && phone;
    if (sheet && shareWithPdf(channel)) return;
    void writtenMessage(channel);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview.text.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* on screen to copy by hand */ }
  };

  const intro = shareFiles
    ? phone
      ? "Pick WhatsApp or your email app and it opens with the PDF attached, sent from your own account."
      : "Email opens your email app with the PDF attached, sent from your own account. WhatsApp sends a link where they can view and download the PDF."
    : "The message opens written for you in your own email or WhatsApp. The PDF is saved for you to attach.";

  return (
    <section className="no-print card p-5">
      <h2 className="font-display text-lg">Send it</h2>
      <p className="mt-1 text-sm text-ink-soft">{intro}</p>

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
        {shareFiles
          ? <><Paperclip size={12} className="inline" aria-hidden="true" /> The PDF is attached for you. You choose who it goes to in the app that opens.</>
          : <>
              {preview.hasPhone ? `WhatsApp goes to ${doc.buyer.phone}. ` : "No phone number on this, so WhatsApp will ask who to send it to. "}
              {preview.hasEmail ? `Email goes to ${doc.buyer.email}.` : "No email address on this, so you will fill one in."}
            </>}
      </p>

      {note ? (
        <p role="status" className={`mt-3 rounded-lg border p-3 text-sm ${failed ? "border-bad/30 bg-bad/5 text-bad" : "border-line bg-canvas"}`}>{note}</p>
      ) : null}

      {shareFiles ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <button type="button" className="btn-quiet text-sm" onClick={() => void writtenMessage("email")} disabled={busy !== null}>
            My email app is not in the list
          </button>
          {phone ? (
            <button type="button" className="btn-quiet text-sm" onClick={() => void writtenMessage("whatsapp")} disabled={busy !== null}>
              Send a link on WhatsApp instead
            </button>
          ) : null}
        </div>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-ink-soft">See the message</summary>
        <p className="mt-2 text-xs font-medium uppercase tracking-wider text-ink-faint">Email - {preview.text.subject}</p>
        <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-sm">{preview.text.body}</pre>
        <p className="mt-3 text-xs font-medium uppercase tracking-wider text-ink-faint">WhatsApp</p>
        <p className="rounded-lg border border-line bg-canvas p-3 text-sm">{preview.text.short}</p>
        <p className="mt-2 text-xs text-ink-faint">A line saying the PDF is attached, or a link to the {what}, is added when you send.</p>
        <button type="button" className="btn-quiet mt-2 text-sm" onClick={copy}>
          {copied ? <><Check size={14} className="text-ok" />Copied</> : <><Copy size={14} />Copy the email text</>}
        </button>
      </details>
    </section>
  );
}
