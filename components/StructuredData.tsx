import { BRAND, SITE_URL } from "@/lib/config";

/**
 * What search engines read to understand the product: a free web app, made by NXOne. Shown as
 * the price and rating details in results, and used to connect the brand name to the site.
 */
export function AppSchema({ name, path, description }: { name: string; path: string; description: string }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name,
    url: `${SITE_URL}${path}`,
    description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any (runs in the browser)",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: BRAND.name, url: SITE_URL }
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

/** The business behind the site, and the site itself, for the home page. */
export function SiteSchema() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: BRAND.name, url: SITE_URL, email: BRAND.email, logo: `${SITE_URL}/icon-512.png` },
      { "@type": "WebSite", "@id": `${SITE_URL}/#site`, name: BRAND.name, url: SITE_URL, publisher: { "@id": `${SITE_URL}/#org` } }
    ]
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
