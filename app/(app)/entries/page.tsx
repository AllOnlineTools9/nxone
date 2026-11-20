import Entries from "@/components/Entries";

export const metadata = { title: "Other money", robots: { index: false, follow: true } };

export default function Page() {
  return <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"><Entries /></div>;
}
