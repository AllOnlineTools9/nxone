import Customers from "@/components/Customers";

export const metadata = { title: "Customers" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Customers</h1>
        <p className="mt-1 text-ink-soft">Everyone you bill, what they owe, and a new invoice for them in one click.</p>
      </header>
      <div className="mt-6"><Customers /></div>
    </div>
  );
}
