import AdvanceTax from "@/components/AdvanceTax";

export const metadata = { title: "Advance tax" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Advance tax</h1>
        <p className="mt-1 text-ink-soft">The year&apos;s income tax, paid in four goes before the year ends.</p>
      </header>
      <div className="mt-6"><AdvanceTax /></div>
    </div>
  );
}
