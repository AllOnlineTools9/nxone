import Tds from "@/components/Tds";

export const metadata = { title: "TDS", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Tax held back</h1>
        <p className="mt-1 text-ink-soft">What you must deduct from suppliers, when it is due, and the 26Q behind it.</p>
      </header>
      <div className="mt-6"><Tds /></div>
    </div>
  );
}
