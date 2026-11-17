import Forward from "@/components/Forward";

export const metadata = { title: "Contracts" };

/** Jobs were renamed contracts. The old address forwards rather than showing a 404. */
export default function Page() {
  return <Forward to="/contracts/" />;
}
