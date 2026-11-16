import Today from "@/components/Today";
import PaymentsArrived from "@/components/PaymentsArrived";
export const metadata = { title: "Today" };
export default function Page() {
  return <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"><div className="mb-4"><PaymentsArrived /></div><Today /></div>;
}
