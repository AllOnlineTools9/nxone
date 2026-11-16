import Claims from "@/components/Claims";

export const metadata = { title: "Claims" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Claims</h1>
        <p className="mt-1 text-ink-soft">What your people spent, and what you owe them back.</p>
      </header>
      <div className="mt-6"><Claims /></div>
    </div>
  );
}
