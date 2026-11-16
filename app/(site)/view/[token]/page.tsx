import SharedDocument from "@/components/SharedDocument";

export const metadata = { title: "Your document" };

/**
 * Static export needs a known set of paths. The real token is read from the address in the
 * browser, so one placeholder page serves every link.
 */
export function generateStaticParams() {
  return [{ token: "shared" }];
}

export default function Page() {
  return <SharedDocument />;
}
