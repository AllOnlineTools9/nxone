import Reports from "@/components/Reports";
import BooksPack from "@/components/BooksPack";
import TallyExport from "@/components/TallyExport";

export const metadata = { title: "Reports", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <Reports />
      <div className="mt-8"><BooksPack /></div>
      <div className="mt-6"><TallyExport /></div>
    </div>
  );
}
