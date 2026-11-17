"use client";
import { Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { store } from "@/lib/store/db";
import { syncAvailable } from "@/lib/sync/api";
import { sync } from "@/lib/sync/engine";
import { useHydrated } from "@/lib/store/useStore";

type Stage = "reading" | "choose" | "joining" | "done" | "error";

/**
 * Taking up an invitation.
 *
 * The delicate part is not the token. It is that this device may already hold somebody's own
 * work, and joining a business means this device starts syncing into that business's books. So
 * the question is asked plainly, before anything is sent, and the answer that throws work away is
 * only ever offered next to a backup.
 */
export default function Join() {
  const [stage, setStage] = useState<Stage>("reading");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [joined, setJoined] = useState<{ org: string; email: string; role: string } | null>(null);
  const [bringMyWork, setBringMyWork] = useState(true);
  const ready = useHydrated();

  useEffect(() => {
    const found = new URLSearchParams(window.location.search).get("token");
    if (!found) { setStage("error"); setMessage("This page needs the link from your invitation email."); return; }
    setToken(found);
    setStage("choose");
  }, []);

  if (!syncAvailable()) {
    return (
      <Shell title="Invitations are not switched on">
        <p>This copy of NXOne works entirely on this device. Accounts and shared books arrive when the service behind them is connected.</p>
      </Shell>
    );
  }

  if (!ready || stage === "reading") return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  const existing = {
    documents: store.documents().length,
    expenses: store.expenses().length,
    clients: store.clients().length
  };
  const hasWork = existing.documents + existing.expenses + existing.clients > 0;

  const backup = () => {
    const blob = new Blob([store.export()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nxone-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const join = async () => {
    setStage("joining");
    const result = await sync.acceptInvite(token, { bringMyWork: hasWork ? bringMyWork : true });
    if (result.ok) {
      setJoined({ org: result.data.organisation.name, email: result.data.user.email, role: result.data.role });
      setStage("done");
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      setStage("error");
      setMessage(result.error);
    }
  };

  if (stage === "done" && joined) {
    return (
      <Shell title={`You are in ${joined.org || "the business"}`}>
        <p>Signed in as {joined.email}. Your access is {joined.role === "readonly" ? "view only" : joined.role}.</p>
        <p>
          {bringMyWork && hasWork
            ? "What was already on this device is being added to the business books as it syncs."
            : "This device started clean and is filling up with the business books now."}
        </p>
        <Link href="/today/" className="btn-primary mt-4">Start</Link>
      </Shell>
    );
  }

  if (stage === "error") {
    return (
      <Shell title="That invitation did not work">
        <p>{message}</p>
        <p className="text-ink-soft">Invitations last a week and work once. Whoever sent it can send another from their People screen.</p>
        <Link href="/" className="btn-ghost mt-4">Back to NXOne</Link>
      </Shell>
    );
  }

  return (
    <Shell title="Join a business on NXOne">
      <p>
        Opening this signs you in with the address the invitation was sent to. There is no password to choose.
      </p>

      {hasWork ? (
        <div className="mt-4 rounded-xl border border-line bg-canvas p-4 text-sm text-ink">
          <h2 className="font-semibold">There is already work on this device</h2>
          <p className="mt-1 text-ink-soft">
            {[existing.documents && `${existing.documents} document${existing.documents === 1 ? "" : "s"}`,
              existing.expenses && `${existing.expenses} expense${existing.expenses === 1 ? "" : "s"}`,
              existing.clients && `${existing.clients} customer${existing.clients === 1 ? "" : "s"}`]
              .filter(Boolean).join(", ")} saved here. Joining means this device syncs with the business you are joining, so decide what happens to it.
          </p>

          <div className="mt-3 space-y-2">
            <label className="flex gap-2.5">
              <input type="radio" className="mt-1" name="work" checked={bringMyWork} onChange={() => setBringMyWork(true)} />
              <span>
                <span className="font-medium">Bring it with me.</span>{" "}
                <span className="text-ink-soft">It becomes part of the business books, and everybody there will see it.</span>
              </span>
            </label>
            <label className="flex gap-2.5">
              <input type="radio" className="mt-1" name="work" checked={!bringMyWork} onChange={() => setBringMyWork(false)} />
              <span>
                <span className="font-medium">Keep it out of it.</span>{" "}
                <span className="text-ink-soft">This device is cleared and filled with the business books instead. Take a backup first - it is the only copy.</span>
              </span>
            </label>
          </div>

          {!bringMyWork ? (
            <button type="button" className="btn-ghost mt-3" onClick={backup}>
              <Download size={16} /> Download a backup first
            </button>
          ) : null}
        </div>
      ) : null}

      <button type="button" className="btn-primary mt-5" onClick={join} disabled={stage === "joining"}>
        {stage === "joining" ? <Loader2 size={16} className="animate-spin" /> : null}
        {hasWork && !bringMyWork ? "Clear this device and join" : "Join"}
      </button>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mx-auto max-w-xl space-y-3 p-6">
      <h1 className="font-display text-xl">{title}</h1>
      {children}
    </div>
  );
}
