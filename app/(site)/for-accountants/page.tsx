import { CalendarClock, Download, Eye, Lock, Users, Wallet } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "NXOne for Accountants and CAs - All Your Clients in One Login",
  description: "See every client's returns due, money owed and books in one login, and export to Tally in one click. Free for you and for your clients' accountant seat.",
  alternates: { canonical: "/for-accountants/" }
};

const POINTS = [
  { icon: Users, title: "Every client, one login", text: "Each business that gives you access appears in one list. No switching accounts, no asking for passwords." },
  { icon: CalendarClock, title: "What is due, and what is late", text: "GSTR-1, GSTR-3B, TDS and advance tax for every client, with the late ones at the top." },
  { icon: Download, title: "Tally in one click", text: "Sales, purchases, receipts and payments as Tally vouchers with the ledgers they need, for any month, quarter or year." },
  { icon: Wallet, title: "Money owed, at a glance", text: "What each client is owed and how much of it is overdue, so you know who to call before the quarter closes." },
  { icon: Eye, title: "See, never change", text: "An accountant seat can look and export. It cannot edit, delete or send anything, so clients say yes easily." },
  { icon: Lock, title: "Free, on every plan", text: "Your seat costs your clients nothing, and the practice view costs you nothing. Every time you open a client's books it shows in their history." }
];

const STEPS = [
  ["Sign in", "With your email. No password, and no card."],
  ["Ask your clients", "Type each client's email in Your clients. They get a request explaining exactly what you will be able to see."],
  ["They say yes", "If they do not use NXOne yet, the link sets them up for free. Their business appears in your list straight away."]
];

export default function Page() {
  return (
    <>
      <section className="wrap py-14 sm:py-20">
        <p className="chip">For chartered accountants and tax practitioners</p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.05] sm:text-5xl">All your clients&apos; books, in one login.</h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-soft">
          Your clients make their invoices in NXOne. You see what every one of them owes the government, what they are owed,
          and take their books into Tally, without chasing spreadsheets at the end of the month.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/practice/" className="btn-primary px-6 py-3 text-base">Open your client list</Link>
          <Link href="/sign-in/" className="btn-ghost px-6 py-3 text-base">Sign in</Link>
        </div>
      </section>

      <section className="wrap pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {POINTS.map((p) => (
            <div key={p.title} className="card p-5">
              <p.icon size={22} className="text-forest" aria-hidden="true" />
              <h2 className="mt-3 font-display text-lg">{p.title}</h2>
              <p className="mt-1 text-sm text-ink-soft">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap pb-16">
        <h2 className="font-display text-2xl">How it works</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="card p-5">
              <span className="font-display text-3xl text-forest">{i + 1}</span>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap pb-20">
        <h2 className="font-display text-2xl">Questions accountants ask</h2>
        <dl className="mt-4 max-w-3xl space-y-5">
          <div><dt className="font-semibold">Can I change a client&apos;s invoices?</dt><dd className="mt-1 text-ink-soft">No. The accountant seat is read and export only, which is what lets a client give access without worrying. If a client wants you to keep their books for them, they can make you a manager instead from People.</dd></div>
          <div><dt className="font-semibold">Does the Tally file work with TallyPrime?</dt><dd className="mt-1 text-ink-soft">It is standard Tally XML, imported through Import, Masters and then Import, Transactions. Customers and suppliers are bill-wise, and anything that could not be placed exactly is listed in a read-me for you to check.</dd></div>
          <div><dt className="font-semibold">How do you know a return is filed?</dt><dd className="mt-1 text-ink-soft">When a return is filed, NXOne asks the business to close its books for that period. Closed periods show as done, so what was filed and what the books say cannot drift apart.</dd></div>
          <div><dt className="font-semibold">What does it cost?</dt><dd className="mt-1 text-ink-soft">Nothing for you, and nothing for your clients to add you. Clients choose their own plan for their own needs.</dd></div>
        </dl>
      </section>
    </>
  );
}
