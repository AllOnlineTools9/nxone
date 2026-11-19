/** Brand and site configuration. Change the brand here only. */
export const BRAND = {
  name: "NXOne",
  wordmark: "NXOne",
  tagline: "Run your business money in one place",
  email: "hello@nxone.io",
  themeColor: "#101828"
} as const;

/**
 * The business behind NXOne, as payment providers and India's data protection law expect a
 * site to show it. FILL THESE IN before applying to Razorpay. Anything left empty is simply not
 * shown, so the pages never display a placeholder to visitors.
 */
export const LEGAL_ENTITY = {
  /** The registered name: a company, an LLP, or the owner's own name for a sole proprietorship. */
  name: "",
  /** Registered address, one line per entry. */
  address: [] as string[],
  /** Optional. Shown on the Contact page if set. */
  phone: "",
  /** Courts whose jurisdiction applies to the terms, usually the city of the registered office. */
  jurisdictionCity: "",
  /** The person who answers privacy complaints (India's DPDP Act). Email defaults to the main one. */
  grievanceOfficer: { name: "", email: "" }
};

const clean = (u: string | undefined) => (u || "").trim().replace(/\/+$/, "");
export const SITE_URL = clean(process.env.NEXT_PUBLIC_SITE_URL) || (process.env.NODE_ENV === "production" ? "https://nxone.io" : "http://localhost:3000");
/** Static builds serve every page as a folder, so addresses carry a trailing slash and so must we. */
const TRAILING = process.env.STATIC === "1";

export function absoluteUrl(p: string): string {
  const path = p.startsWith("/") ? p : `/${p}`;
  if (!TRAILING || path === "/" || path.includes(".") || path.includes("?")) return `${SITE_URL}${path}`;
  return `${SITE_URL}${path.endsWith("/") ? path : `${path}/`}`;
}

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "";
export const GSC_VERIFICATION = process.env.NEXT_PUBLIC_GSC_VERIFICATION || "";
