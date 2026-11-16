import InputCredit from "@/components/InputCredit";

export const metadata = { title: "Input credit" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Input credit</h1>
        <p className="mt-1 text-ink-soft">What the portal says you can claim, against what you have claimed.</p>
      </header>
      <div className="mt-6"><InputCredit /></div>
    </div>
  );
}
