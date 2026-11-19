import Join from "@/components/Join";
export const metadata = { title: "Join a business", robots: { index: false, follow: true } };
export default function Page() {
  return <div className="mx-auto w-full max-w-[90rem] px-4 py-10 sm:px-6"><Join /></div>;
}
