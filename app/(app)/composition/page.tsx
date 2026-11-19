import Composition from "@/components/Composition";

export const metadata = { title: "Composition scheme", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">GST scheme</h1>
        <p className="mt-1 text-ink-soft">Ordinary registration or the composition scheme, and the quarterly return that goes with it.</p>
      </header>
      <div className="mt-6"><Composition /></div>
    </div>
  );
}
