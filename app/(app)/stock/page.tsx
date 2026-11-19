import Stock from "@/components/Stock";
export const metadata = { title: "Stock", robots: { index: false, follow: true } };
export default function Page() {
  return <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6"><Stock /></div>;
}
