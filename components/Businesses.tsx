"use client";
import { Building2, Check, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EntitiesExport, entitiesExport } from "@/lib/store/entities";
import { useEntities, useHydrated, useWorkspace } from "@/lib/store/useStore";

/**
 * The businesses kept on this device.
 *
 * Each one's books can be taken out without opening it, which matters once there is more than
 * one: nobody should have to switch back and forth to take two backups. And nothing is removed
 * until its books have been downloaded — the files are on this device and nowhere else, so a
 * removal with no copy is a loss, not a tidy-up.
 */
export default function Businesses() {
  const list = useEntities();
  const [ws] = useWorkspace();
  const ready = useHydrated();
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  if (!ready) return null;

  const all = list.list();
  const active = list.active();

  const save = (text: string, fileName: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const downloadOne = (id: string, businessName: string) => {
    save(entitiesExport.one(id), EntitiesExport.fileName(businessName));
    setBackedUp(new Set([...backedUp, id]));
    setMessage(`${businessName || "That business"} has been downloaded.`);
  };

  const remove = (id: string, businessName: string) => {
    const result = list.remove(id);
    setRemoving(null);
    setMessage(result.removed
      ? `${businessName || "That business"} is off this device. The file you downloaded is now the only copy.`
      : result.reason ?? "");
    if (result.removed) router.push("/today/");
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg">Businesses on this device</h2>
        <button type="button" className="btn-ghost" onClick={() => { list.add(); router.push("/welcome/"); }}>
          <Plus size={16} /> Add another
        </button>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Each one keeps its own books, customers and accounts. Nothing is shared between them.
        {all.length < 2 ? " Your first set of books stays with this device; adding a second one lets you remove either." : ""}
      </p>

      {message ? <p className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm">{message}</p> : null}

      <ul className="mt-4 divide-y divide-line">
        {all.map((entity) => {
          const isActive = entity.id === active?.id;
          const label = (isActive ? ws.profile?.name : entity.name) || "Untitled business";
          return (
            <li key={entity.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 size={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
                  {renaming === entity.id ? (
                    <input
                      className="field w-56" value={name} autoFocus
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { list.rename(entity.id, name.trim()); setRenaming(null); } }}
                    />
                  ) : (
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{label}</span>
                      <span className="block text-xs text-ink-faint">
                        {isActive ? "Open now" : "Not open"}{entity.currency ? ` · ${entity.country} · ${entity.currency}` : ""}
                      </span>
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-1">
                  {renaming === entity.id ? (
                    <button type="button" className="btn-quiet text-sm" onClick={() => { list.rename(entity.id, name.trim()); setRenaming(null); }}>
                      <Check size={14} /> Done
                    </button>
                  ) : (
                    <>
                      {!isActive ? (
                        <button type="button" className="btn-quiet text-sm" onClick={() => { list.open(entity.id); router.push("/today/"); }}>Open</button>
                      ) : null}
                      <button type="button" className="btn-quiet text-sm" onClick={() => downloadOne(entity.id, label)}>
                        <Download size={14} /> Download
                      </button>
                      <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-ink"
                        aria-label={`Rename ${label}`} onClick={() => { setRenaming(entity.id); setName(entity.name); }}>
                        <Pencil size={15} />
                      </button>
                      {list.whyNotRemovable(entity.id) ? (
                        <span className="p-1.5 text-ink-faint" title={list.whyNotRemovable(entity.id)} aria-label={list.whyNotRemovable(entity.id)}>
                          <Trash2 size={15} className="opacity-30" />
                        </span>
                      ) : (
                        <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-bad"
                          aria-label={`Remove ${label}`} onClick={() => { setRemoving(entity.id); setMessage(""); }}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {removing === entity.id ? (
                <div className="mt-3 rounded-lg border border-bad/30 bg-bad/5 p-4">
                  <p className="text-sm font-medium">Remove {label} from this device?</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Its books are on this device and nowhere else. Removing it cannot be undone, so take the file first.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-primary" onClick={() => downloadOne(entity.id, label)}>
                      <Download size={15} /> Download its books
                    </button>
                    <button type="button" className="btn-ghost" disabled={!backedUp.has(entity.id)}
                      onClick={() => remove(entity.id, label)}>
                      {backedUp.has(entity.id) ? "Remove it" : "Download first"}
                    </button>
                    <button type="button" className="btn-quiet" onClick={() => setRemoving(null)}>Keep it</button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {all.length > 1 ? (
        <div className="mt-4 border-t border-line pt-4">
          <button type="button" className="btn-ghost" onClick={() => save(entitiesExport.all(), EntitiesExport.fileName("all-businesses"))}>
            <Download size={16} /> Download all {all.length} in one file
          </button>
          <p className="mt-2 text-xs text-ink-soft">
            One file holding every business on this device, for moving to another computer.
          </p>
        </div>
      ) : null}
    </section>
  );
}
