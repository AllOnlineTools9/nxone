import History from "@/components/History";

export const metadata = { title: "History" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">History</h1>
        <p className="mt-1 text-ink-soft">What changed in your books, and when.</p>
      </header>
      <div className="mt-6"><History /></div>
    </div>
  );
}
