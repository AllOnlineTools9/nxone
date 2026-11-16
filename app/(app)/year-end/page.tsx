import YearEnd from "@/components/YearEnd";

export const metadata = { title: "Year end" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Year end</h1>
        <p className="mt-1 text-ink-soft">Finish a year, check what is usually wrong, and close it.</p>
      </header>
      <div className="mt-6"><YearEnd /></div>
    </div>
  );
}
