import Shop from "@/components/Shop";

export const metadata = { title: "Shop billing", robots: { index: false, follow: true } };

export default function Page() {
  return <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6"><Shop /></div>;
}
