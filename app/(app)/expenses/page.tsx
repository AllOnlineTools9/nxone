import Expenses from "@/components/Expenses";
export const metadata = { title: "Money out", robots: { index: false, follow: true } };
export default function Page() {
  return <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6"><Expenses /></div>;
}
