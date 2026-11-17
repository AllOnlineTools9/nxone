import SharedDocument from "@/components/SharedDocument";

export const metadata = { title: "Your document", robots: { index: false, follow: false } };

/**
 * One page serves every shared link. Links look like /view/<token>/; a rewrite in _redirects
 * serves this page for all of them while the address keeps its token, which the page then
 * reads. It lives outside /view/ on purpose: a rewrite whose target matched its own pattern
 * would be refused as a loop.
 */
export default function Page() {
  return <SharedDocument />;
}
