import Purchasing from "@/components/Purchasing";

export const metadata = { title: "Orders and bills", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Orders and bills</h1>
        <p className="mt-1 text-ink-soft">What you agreed to pay, against what you were asked for.</p>
      </header>
      <div className="mt-6"><Purchasing /></div>
    </div>
  );
}
