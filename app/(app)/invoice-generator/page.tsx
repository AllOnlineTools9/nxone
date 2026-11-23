import { AppSchema } from "@/components/StructuredData";
import Builder from "@/components/builder/Builder";

export const metadata = {
  title: "Free Invoice Generator - GST, VAT and Sales Tax",
  description: "Make an invoice with the right tax format for India, the UK, US, UAE, Singapore, Australia or Canada. Free, no sign-up, PDF in seconds."
};

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6">
      <AppSchema name="NXOne Invoice generator" path="/invoice-generator/" description={metadata.description} />
      <header className="max-w-3xl">
        <h1 className="text-2xl font-semibold sm:text-3xl">Invoice generator</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">Fill in the left, watch the right. Add your logo and bank details, pick the tax for each line, and download the PDF when it looks right. In India the HSN or SAC code fills in as you type what you sell.</p>
      </header>
      <div className="mt-5"><Builder kind="invoice" /></div>
    </div>
  );
}
