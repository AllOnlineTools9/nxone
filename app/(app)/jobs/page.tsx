import Projects from "@/components/Projects";

export const metadata = { title: "Jobs" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <header>
        <h1 className="font-display text-3xl">Jobs</h1>
        <p className="mt-1 text-ink-soft">What each piece of work earned, against what it cost.</p>
      </header>
      <div className="mt-6"><Projects /></div>
    </div>
  );
}
