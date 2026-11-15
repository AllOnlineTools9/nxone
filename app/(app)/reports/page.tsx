import Reports from "@/components/Reports";
import BooksPack from "@/components/BooksPack";

export const metadata = { title: "Reports" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6">
      <Reports />
      <div className="mt-8"><BooksPack /></div>
    </div>
  );
}
