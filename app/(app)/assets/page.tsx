import Assets from "@/components/Assets";

export const metadata = { title: "What you own", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">What you own</h1>
        <p className="mt-1 text-ink-soft">Equipment and the rest, spread over the years you use them.</p>
      </header>
      <div className="mt-6"><Assets /></div>
    </div>
  );
}
