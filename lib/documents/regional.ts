import { packFor } from "../countries/packs";
import { ruleById, rulesOn, type CountryPack, type TaxRule } from "../countries/types";
import type { DocumentData } from "./types";

/**
 * Tax rules that belong to one region of a country, such as each US state's sales tax rate.
 *
 * India's regions decide whether a rate splits into CGST and SGST or stays IGST; that is handled
 * by counterpartRuleId. This is the other kind: a country whose regions each have their own rate,
 * where moving an invoice to another state has to move every line to that state's rate.
 */

/** Whether this country's rates are set region by region. */
export const hasRegionalRates = (pack: CountryPack) =>
  Boolean(pack.regions?.length) && pack.taxRules.some((r) => isRegional(pack, r));

const isRegional = (pack: CountryPack, r: TaxRule) => r.jurisdiction.startsWith(`${pack.code}-`);

/** The region whose rate applies: where the customer receives it, or else where the seller is. */
export const taxRegion = (doc: Pick<DocumentData, "placeOfSupply" | "seller">) => doc.placeOfSupply || doc.seller.region || "";

/** The region's own rate on a date, if the country has one for it. */
export function regionalRule(country: string, isoDate: string, region: string | undefined): TaxRule | undefined {
  if (!region) return undefined;
  const pack = packFor(country);
  return rulesOn(pack, isoDate).find((r) => r.jurisdiction === `${pack.code}-${region}` && r.category === "standard-region");
}

/**
 * The rule a line should carry once the invoice's region is known or changes. A line already on
 * a region's rate moves to the new region's rate; a line still on the "enter your rate" default
 * with nothing entered takes the region's rate too. Anything the seller chose on purpose - not
 * taxable, exempt, a combined rate they typed - is left exactly as it is.
 */
export function regionalRuleId(country: string, isoDate: string, ruleId: string | undefined, region: string | undefined, override?: number): string | undefined {
  const pack = packFor(country);
  if (!hasRegionalRates(pack) || !region || !ruleId) return ruleId;
  const current = ruleById(pack, ruleId);
  if (!current) return ruleId;
  const movable = isRegional(pack, current) || (current.status === "draft" && !override);
  if (!movable) return ruleId;
  return regionalRule(country, isoDate, region)?.id ?? ruleId;
}

/** Every line moved to the invoice's region, after the customer or either state changes. */
export function withRegionalRates<T extends DocumentData>(doc: T): T {
  if (!hasRegionalRates(packFor(doc.country))) return doc;
  const region = taxRegion(doc);
  return { ...doc, items: doc.items.map((i) => ({ ...i, taxRuleId: regionalRuleId(doc.country, doc.issueDate, i.taxRuleId, region, i.taxRateOverride) })) };
}

/**
 * The rules worth offering on a line: the country-wide ones and the invoice region's own, rather
 * than all fifty-one states. The line's current rule always stays in the list so a choice made
 * earlier never silently disappears from the select.
 */
export function rulesToOffer(pack: CountryPack, rules: TaxRule[], region: string | undefined, currentId?: string): TaxRule[] {
  if (!hasRegionalRates(pack)) return rules;
  return rules.filter((r) => !isRegional(pack, r) || r.jurisdiction === `${pack.code}-${region}` || r.id === currentId);
}
