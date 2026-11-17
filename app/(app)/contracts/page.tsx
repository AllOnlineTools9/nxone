import Projects from "@/components/Projects";

export const metadata = { title: "Contracts" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Contracts</h1>
        <p className="mt-1 text-ink-soft">What each contract earned, against what it cost.</p>
      </header>
      <div className="mt-6"><Projects /></div>
    </div>
  );
}
