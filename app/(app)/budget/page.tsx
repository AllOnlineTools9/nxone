import Budget from "@/components/Budget";

export const metadata = { title: "Budget", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Budget</h1>
        <p className="mt-1 text-ink-soft">What you meant to spend, against what you are actually spending.</p>
      </header>
      <div className="mt-6"><Budget /></div>
    </div>
  );
}
