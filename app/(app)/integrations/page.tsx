import Integrations from "@/components/Integrations";

export const metadata = { title: "API and webhooks", robots: { index: false, follow: true } };

export default function Page() {
  return <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"><Integrations /></div>;
}
