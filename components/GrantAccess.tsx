"use client";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { returnHereAfterSignIn } from "@/components/SignIn";
import { useWorkspace } from "@/lib/store/useStore";
import { accessRequestInfo, declineAccess, grantAccess, syncAvailable, whoAmI, type Account } from "@/lib/sync/api";

/**
 * Where a business owner answers an accountant's request for access. Saying yes adds the
 * accountant as an accountant seat: free, able to see and export, unable to change anything.
 */
type Info = { from: string; businessName: string | null; note: string | null; state: string };

export default function GrantAccess() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"granted" | "declined" | null>(null);
  const [ws] = useWorkspace();

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(t);
    if (!t || !syncAvailable()) return;
    accessRequestInfo(t).then((r) => (r.ok ? setInfo(r.data) : setError(r.error)));
    whoAmI().then((r) => setAccount(r.ok ? r.data : null));
  }, []);

  if (!syncAvailable()) return <p className="card p-6 text-ink-soft">Accounts are not switched on for this copy of NXOne.</p>;
  if (!token) return <p className="card p-6 text-ink-soft">This link is not complete. Open it from the email again.</p>;
  if (error) return <p className="card p-6 text-bad">{error}</p>;
  if (!info || account === undefined) return <p className="flex items-center gap-2 p-6 text-ink-soft"><Loader2 size={18} className="animate-spin" />Checking the link</p>;

  // The name the business gave itself on this device, else the account's name for it.
  const business = ws.profile?.name || account?.organisations.find((o) => o.id === account.orgId)?.name;

  if (done === "granted") {
    return (
      <div className="card p-6">
        <h2 className="flex items-center gap-2 font-display text-xl"><Check className="text-ok" size={20} />{info.from} can now see your books</h2>
        <p className="mt-2 text-ink-soft">They can look and export for filing, and cannot change or send anything. To remove them, go to People.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/team/" className="btn-ghost">People</Link>
          <Link href="/dashboard/" className="btn-primary">Go to your money</Link>
        </div>
      </div>
    );
  }
  if (done === "declined") return <p className="card p-6">You said no. {info.from} has not been given anything.</p>;
  if (info.state !== "pending") {
    return (
      <p className="card p-6 text-ink-soft">
        {info.state === "accepted" ? "This request has already been accepted." : info.state === "expired" ? `This request has expired. Ask ${info.from} to send it again.` : "This request was declined or withdrawn."}
      </p>
    );
  }

  const answer = async (yes: boolean) => {
    setBusy(true); setError("");
    const r = yes ? await grantAccess(token) : await declineAccess(token);
    setBusy(false);
    if (r.ok) setDone(yes ? "granted" : "declined");
    else setError(r.error);
  };

  return (
    <div className="card max-w-xl p-6">
      <h2 className="font-display text-xl">{info.from} would like to see {info.businessName ? `the books of ${info.businessName}` : "your books"}</h2>
      {info.note ? <blockquote className="mt-3 border-l-2 border-line pl-3 text-ink-soft">{info.note}</blockquote> : null}
      <ul className="mt-4 space-y-2 text-sm">
        <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-ok" />They can see your invoices, bills, customers and returns, and export them for filing and for Tally.</li>
        <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-ok" />They cannot change, delete or send anything.</li>
        <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-ok" />It is free on every plan, and you can remove them at any time from People.</li>
      </ul>

      {account ? (
        <>
          <p className="mt-4 text-sm text-ink-soft">You are signed in as {account.user.email}{business ? <>, for <strong>{business}</strong></> : null}.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void answer(true)}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Give access
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void answer(false)}>No thanks</button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-soft">Sign in as the business owner to answer. New to NXOne? Signing in creates your free account.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/sign-in/" className="btn-primary" onClick={() => returnHereAfterSignIn(`/grant-access/?token=${encodeURIComponent(token)}`)}>Sign in to answer</Link>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void answer(false)}>No thanks</button>
          </div>
        </>
      )}
    </div>
  );
}
