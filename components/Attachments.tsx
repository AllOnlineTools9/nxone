"use client";
import { Download, FileText, Loader2, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { describeSize, FileTooBig, VaultFull, vault, type Attachment } from "@/lib/files/vault";

/**
 * The paperwork beside the record it belongs to.
 *
 * Everything here is about being honest regarding where a file actually is. It is on this device
 * — not on a server, not on the owner's other phone — so the component says so once, plainly, and
 * marks any file whose bytes are not here rather than showing a button that would do nothing.
 */
export default function Attachments({
  attachments = [],
  onChange,
  label = "Paperwork",
  compact = false
}: {
  attachments?: Attachment[];
  onChange: (next: Attachment[]) => void;
  label?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [here, setHere] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: Record<string, boolean> = {};
      for (const file of attachments) found[file.id] = await vault.has(file.id);
      if (!cancelled) setHere(found);
    })();
    return () => { cancelled = true; };
  }, [attachments]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setProblem("");
    setBusy(true);
    const added: Attachment[] = [];
    for (const file of Array.from(files)) {
      try {
        added.push(await vault.add({ name: file.name, type: file.type, size: file.size, blob: file }));
      } catch (error) {
        if (error instanceof FileTooBig) setProblem(`${file.name} is ${describeSize(error.size)}. Files are kept on this device, so anything over 10 MB has to stay where it is.`);
        else if (error instanceof VaultFull) setProblem(`There is only ${describeSize(error.free)} left for paperwork on this device. Remove something first.`);
        else setProblem(`${file.name} could not be kept. ${error instanceof Error ? error.message : ""}`.trim());
      }
    }
    if (added.length) onChange([...attachments, ...added]);
    setBusy(false);
    if (input.current) input.current.value = "";
  };

  const open = async (file: Attachment) => {
    const blob = await vault.open(file.id);
    if (!blob) { setProblem(`${file.name} was added on another device, so its contents are not here.`); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const drop = async (id: string) => {
    await vault.remove(id);
    onChange(attachments.filter((f) => f.id !== id));
  };

  return (
    <div className={compact ? "" : "card p-5"}>
      {!compact ? (
        <>
          <h2 className="font-display text-lg">{label}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            The bill, the contract, the photo of what arrived. Kept on this device, beside the record rather than in a chat thread.
          </p>
        </>
      ) : null}

      {attachments.length ? (
        <ul className={`${compact ? "" : "mt-4"} space-y-2`}>
          {attachments.map((file) => {
            const missing = here[file.id] === false;
            return (
              <li key={file.id} className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
                <FileText size={15} className={`shrink-0 ${missing ? "text-ink-faint" : "text-ink-soft"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{file.name}</span>
                  <span className="block text-xs text-ink-faint">
                    {describeSize(file.size)}
                    {missing ? " · added on another device, not on this one" : ""}
                  </span>
                </span>
                {!missing ? (
                  <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-white hover:text-ink" onClick={() => void open(file)} aria-label={`Download ${file.name}`}>
                    <Download size={15} />
                  </button>
                ) : null}
                <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-white hover:text-bad" onClick={() => void drop(file.id)} aria-label={`Remove ${file.name}`}>
                  <X size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className={`${compact || attachments.length ? "mt-3" : "mt-4"} flex flex-wrap items-center gap-3`}>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
        <button type="button" className="btn-ghost" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
          Attach a file
        </button>
        {compact && !attachments.length ? <span className="text-xs text-ink-faint">Kept on this device</span> : null}
      </div>

      {problem ? <p className="mt-2 text-sm text-warn">{problem}</p> : null}
    </div>
  );
}
