import Ask from "@/components/Ask";
export const metadata = { title: "Ask about your money", robots: { index: false, follow: true } };
export default function Page() {
  return <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6"><Ask /></div>;
}
