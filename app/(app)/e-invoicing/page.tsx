import EInvoicing from "@/components/EInvoicing";
export const metadata = { title: "E-invoicing", robots: { index: false, follow: true } };
export default function Page() {
  return <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6"><EInvoicing /></div>;
}
