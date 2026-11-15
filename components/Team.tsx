"use client";
import { Loader2, Mail, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatMoney, fromMinor } from "@/lib/money";
import {
  invitePerson, removeMember, revokeInvite, setMemberRole, syncAvailable, team,
  type TeamRole, type TeamView
} from "@/lib/sync/api";

/**
 * The people who can see this business.
 *
 * Everything that costs money is said before it is done: the price of the next seat is on the
 * invite button itself, not in the receipt afterwards. And removing somebody says plainly what it
 * does and does not do — their copy on their own laptop is theirs, and we cannot reach it.
 */
export default function Team() {
  const [view, setView] = useState<TeamView | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await team();
    if (result.ok) setView(result.data);
    else setProblem(result.status === 401 ? "" : result.error);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!syncAvailable()) {
    return (
      <div className="card p-6">
        <h1 className="text-2xl font-semibold">People</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Working together needs an account, and accounts are not switched on in this copy of NXOne. Everything else works on this device as it always has.
        </p>
      </div>
    );
  }

  if (loading) return <div className="h-64 animate-pulse rounded-xl border border-line bg-white/60" aria-hidden="true" />;

  if (!view) {
    return (
      <div className="card p-6">
        <h1 className="text-2xl font-semibold">People</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          {problem || "Sign in to see who has access to this business and to invite anybody else."}
        </p>
        <Link href="/sign-in/" className="btn-primary mt-4">Sign in</Link>
      </div>
    );
  }

  const m = (minor: number) => formatMoney(fromMinor(minor, view.seats.currency), "en-IN");
  const mine = view.you.can.manageTeam;
  const owner = view.you.role === "owner";

  const act = async (run: () => Promise<{ ok: true; data: { team: TeamView; note?: string } } | { ok: false; error: string }>) => {
    setBusy(true); setMessage(""); setProblem("");
    const result = await run();
    if (result.ok) { setView(result.data.team); if (result.data.note) setMessage(result.data.note); }
    else setProblem(result.error);
    setBusy(false);
  };

  const send = async () => {
    if (!email.trim()) return;
    setBusy(true); setMessage(""); setProblem("");
    const result = await invitePerson(email.trim(), role);
    if (result.ok) {
      setView(result.data.team);
      setMessage(result.data.sent
        ? `Invitation sent to ${email.trim()}. It expires in a week.`
        : `Invitation made for ${email.trim()}, but the email could not be sent. Ask them to check later, or send it again.`);
      setEmail("");
    } else setProblem(result.error);
    setBusy(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">People</h1>
        <p className="mt-1 max-w-2xl text-ink-soft">
          Who can see and change {view.organisation.name || "this business"}. Everyone signs in with their own email, and the books stay one set of books.
        </p>
      </div>

      {message ? <p className="rounded-xl border border-forest bg-forest-pale p-4 text-sm">{message}</p> : null}
      {problem ? <p className="rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm text-bad">{problem}</p> : null}

      {/* ---- who is here ---- */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
          <h2 className="font-display text-lg">On this business</h2>
          <p className="text-sm text-ink-soft">
            {view.counts.used} of {view.counts.included} included seat{view.counts.included === 1 ? "" : "s"} used
            {view.counts.extra > 0 ? `, ${view.counts.extra} paid for beyond that` : ""}
          </p>
        </div>

        <table className="mt-3 w-full border-collapse text-sm">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Person</th>
              <th className="px-5 py-2.5 font-semibold">Can do</th>
              <th className="px-5 py-2.5 font-semibold">Last seen</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {view.members.map((person) => (
              <tr key={person.userId} className="border-t border-line">
                <td className="px-5 py-3">
                  <span className="font-medium">{person.name || person.email}</span>
                  {person.isYou ? <span className="ml-2 text-xs text-ink-faint">you</span> : null}
                  {person.name ? <span className="block text-xs text-ink-soft">{person.email}</span> : null}
                </td>
                <td className="px-5 py-3">
                  {owner && !person.isYou ? (
                    <select className="field w-44" value={person.role} disabled={busy}
                      onChange={(e) => act(() => setMemberRole(person.userId, e.target.value as TeamRole))}>
                      {view.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  ) : (
                    <span>{view.roles.find((r) => r.id === person.role)?.name ?? person.role}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-ink-soft">{person.lastSeenAt ? whenWas(person.lastSeenAt) : "Not yet"}</td>
                <td className="px-5 py-3 text-right">
                  {mine && !person.isYou ? (
                    <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-canvas hover:text-bad" disabled={busy}
                      aria-label={`Remove ${person.email}`} onClick={() => act(() => removeMember(person.userId))}>
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {view.pending.length ? (
          <div className="border-t border-line bg-canvas/50 px-5 py-4">
            <h3 className="text-sm font-semibold">Asked, not yet joined</h3>
            <ul className="mt-2 space-y-2">
              {view.pending.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <Mail size={14} className="mr-1.5 inline text-ink-faint" aria-hidden="true" />
                    {invite.email}
                    <span className="text-ink-soft"> · {view.roles.find((r) => r.id === invite.role)?.name} · expires {whenWas(invite.expiresAt)}</span>
                  </span>
                  {mine ? (
                    <button type="button" className="btn-quiet text-sm" disabled={busy} onClick={() => act(() => revokeInvite(invite.id))}>
                      Take it back
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-soft">An invitation holds a seat until it is taken up or taken back, so two people cannot be given the same one.</p>
          </div>
        ) : null}
      </section>

      {/* ---- ask somebody ---- */}
      {mine ? (
        <section className="card p-5">
          <h2 className="font-display text-lg">Ask somebody to join</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            They get an email with a link. Opening it signs them in — there is no password to choose or share.
          </p>

          {!view.seats.allowed ? (
            <div className="mt-4 rounded-xl border border-line bg-canvas p-4">
              <p className="text-sm">{view.seats.message}</p>
              <Link href="/pricing/" className="btn-primary mt-3">See Business</Link>
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Their email</span>
                  <input type="email" className="field w-72" value={email} placeholder="anita@example.com"
                    onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">What they can do</span>
                  <select className="field w-56" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                    {view.roles.filter((r) => r.id !== "owner" || owner).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
                <button type="button" className="btn-primary" onClick={send} disabled={busy || !email.trim()}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                  Send the invitation
                </button>
              </div>

              <p className="mt-2 text-sm text-ink-soft">
                {view.roles.find((r) => r.id === role)?.describes}
              </p>
              <p className={`mt-3 border-t border-line pt-3 text-sm ${view.seats.addsMonthlyMinor > 0 ? "" : "text-ink-soft"}`}>
                {view.seats.addsMonthlyMinor > 0 ? (
                  <>
                    This person adds <strong className="tabular">{m(view.seats.addsMonthlyMinor)}</strong> a month, taking your bill to{" "}
                    <strong className="tabular">{m(view.seats.monthlyCostMinor)}</strong>. {view.seats.message}
                  </>
                ) : view.seats.message}
              </p>
            </>
          )}
        </section>
      ) : (
        <section className="card p-5">
          <h2 className="font-display text-lg">Your access</h2>
          <p className="mt-1 text-sm text-ink-soft">
            You are {view.roles.find((r) => r.id === view.you.role)?.name?.toLowerCase()} here. {view.roles.find((r) => r.id === view.you.role)?.describes} Only an owner or a manager can add people.
          </p>
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-display text-lg">What each one means</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {view.roles.map((r) => (
            <div key={r.id} className="flex flex-wrap gap-x-2">
              <dt className="font-medium">{r.name}</dt>
              <dd className="text-ink-soft">{r.describes}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-line pt-3 text-sm text-ink-soft">
          Taking somebody off stops them seeing anything new and stops their device syncing. What is already saved on their own machine stays there, because it is on their machine and we cannot reach into it.
        </p>
      </section>
    </div>
  );
}

/** Dates people can read without doing arithmetic. */
function whenWas(ms: number): string {
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  if (days > -30) return `${-days} days ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
