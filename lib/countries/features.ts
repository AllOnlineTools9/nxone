import { PACKS, packFor } from "./packs";

/**
 * Which screens belong to which country.
 *
 * A business has one country, chosen when it is set up. Everything shared - invoices, expenses,
 * accounts, stock, customers, reports - works the same everywhere. What differs is the tax and
 * filing machinery around it: a business in the US should never be shown GST returns or e-way
 * bills, and a business in India should not be shown 1099s. Each country pack lists the
 * country-only features it has; this file maps those features to the screens that carry them.
 *
 * Adding a country-only screen is two lines: an entry in FEATURES and the feature in that
 * country's pack.
 */

export type Feature =
  | "gst-returns" | "gst-scheme" | "input-credit" | "tds" | "advance-tax"
  | "e-invoicing" | "e-way-bills" | "hsn" | "payroll" | "tally" | "hinglish";

export const FEATURES: Record<Feature, { name: string; routes: string[] }> = {
  "gst-returns": { name: "GST returns", routes: ["/gst-returns"] },
  "gst-scheme": { name: "The GST composition scheme", routes: ["/composition"] },
  "input-credit": { name: "GST input credit", routes: ["/input-credit"] },
  tds: { name: "TDS", routes: ["/tds"] },
  "advance-tax": { name: "Advance tax", routes: ["/advance-tax"] },
  "e-invoicing": { name: "E-invoicing (IRN)", routes: ["/e-invoicing"] },
  "e-way-bills": { name: "E-way bills", routes: ["/e-way-bills"] },
  hsn: { name: "HSN and SAC codes", routes: ["/hsn-code-finder"] },
  payroll: { name: "Payroll with PF, ESI and professional tax", routes: ["/payroll"] },
  tally: { name: "Export to Tally", routes: [] },
  hinglish: { name: "Entries typed in Hinglish", routes: [] }
};

/** Whether a business in this country has the feature. No country yet means nothing is hidden. */
export function hasFeature(country: string | undefined | null, feature: Feature): boolean {
  if (!country) return true;
  return (packFor(country).features ?? []).includes(feature);
}

const clean = (path: string) => {
  const p = path.replace(/\/+$/, "");
  return p === "" ? "/" : p;
};

/** The country-only feature a page belongs to, if it is one. */
export function featureForPath(pathname: string): Feature | undefined {
  const path = clean(pathname);
  for (const [feature, def] of Object.entries(FEATURES) as Array<[Feature, { routes: string[] }]>) {
    if (def.routes.some((r) => path === r || path.startsWith(`${r}/`))) return feature;
  }
  return undefined;
}

/** Names of the countries that have a feature, for "this is used in India" messages. */
export function countriesWith(feature: Feature): string[] {
  return PACKS.filter((p) => (p.features ?? []).includes(feature)).map((p) => p.name);
}

/** A page this business cannot use, or undefined when it can. */
export function blockedFor(country: string | undefined | null, pathname: string): Feature | undefined {
  const feature = featureForPath(pathname);
  return feature && !hasFeature(country, feature) ? feature : undefined;
}

/**
 * Whether the business's country (and with it the home currency) can still be changed.
 *
 * Once there are documents, they were issued under that country's tax: GST invoices with GSTINs
 * and CGST/SGST splits, or US invoices with sales tax. Moving the business to another country
 * would leave those documents in books that no longer understand them, and every report keyed
 * on the home currency would quietly lose them. So the country is fixed from the first document,
 * and work in another country is a separate business.
 */
export function countryLocked(profile: { country?: string } | undefined | null, documentCount: number): boolean {
  return Boolean(profile?.country) && documentCount > 0;
}

/** A country's name as it reads in a sentence: "the United States", "India". */
export const inSentence = (name: string) =>
  name === "Other country" ? "another country" : /^(United|Netherlands|Philippines|UAE)\b/.test(name) ? `the ${name}` : name;
