import GrantAccess from "@/components/GrantAccess";

export const metadata = { title: "Accountant access", robots: { index: false, follow: false } };

export default function Page() {
  return <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6"><GrantAccess /></div>;
}
