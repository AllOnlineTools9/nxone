/**
 * Country pack architecture.
 *
 * Nothing country-specific belongs in a component or a calculation. Everything lives here as data:
 * formats, tax regimes and the individual tax rules, each of which carries the dates it applies
 * between, the authority it came from and how far it has been verified. A document created in
 * March 2026 keeps March 2026's rules for ever, even after a rate changes.
 */

export type TaxSystem = "GST" | "VAT" | "SALES_TAX" | "CONSUMPTION_TAX" | "NONE";

/** How much we actually trust a rule. Shown in the UI, never guessed at. */
export type RuleStatus = "verified" | "published" | "draft";

export interface TaxRule {
  id: string;
  /** "IN", "GB", "US-CA": country, or country and region where the tax is set locally. */
  jurisdiction: string;
  /** Human label shown on documents, e.g. "GST 18%", "VAT standard rate". */
  label: string;
  /** Percentage, so 18 means 18%. */
  rate: number;
  /** "standard", "reduced", "zero", "exempt" and similar, used to pick a default per line. */
  category: string;
  /** ISO date this rule starts applying. */
  effectiveFrom: string;
  /** ISO date it stops, if known. */
  effectiveUntil?: string;
  /** Where the rate came from, so a user can check it. */
  source: string;
  version: number;
  status: RuleStatus;
  /** Split a single rate into named components on the document, e.g. CGST 9% + SGST 9%. */
  components?: Array<{ label: string; share: number }>;
  /** Only applies when buyer and seller are in the same region (intra-state GST). */
  appliesWhen?: "intra-region" | "inter-region" | "always";
}

export interface DocumentField {
  key: string;
  label: string;
  /** Legally required on a tax document in this country. */
  required: boolean;
  placeholder?: string;
  help?: string;
}

export type SupportLevel = "supported" | "partial" | "configuration-only";

export interface CountryPack {
  code: string;
  name: string;
  currency: string;
  locale: string;
  /** Indian grouping puts commas at lakh and crore; most others group in thousands. */
  numberSystem: "international" | "indian";
  dateFormat: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd";
  taxSystem: TaxSystem;
  /** What the tax is called on the document: "GST", "VAT", "Sales tax". */
  taxLabel: string;
  /** What the seller's tax number is called: "GSTIN", "VAT number", "EIN". */
  taxIdLabel: string;
  /** Regex the tax id should match, used for a gentle warning rather than a hard block. */
  taxIdPattern?: string;
  /** Title printed at the top of a tax document. */
  invoiceTitle: string;
  /** Fields this country expects on a compliant invoice. */
  requiredFields: DocumentField[];
  /**
   * Regions used for intra vs inter region tax. "ut" marks a union territory without its own
   * legislature, where the state half of GST is charged as UTGST instead of SGST.
   */
  regions?: Array<{ code: string; name: string; kind?: "state" | "ut" }>;
  /**
   * What the two region fields are called, where the defaults ("Your state", "Place of supply")
   * would read wrongly. In the US the tax follows where the customer receives the goods, so the
   * second field is the ship-to state.
   */
  regionLabels?: { seller: string; supply: string; printed: string; help?: string };
  taxRules: TaxRule[];
  /** Honest statement of how complete this pack is. Shown in the UI. */
  support: SupportLevel;
  /**
   * Screens and tools that only make sense in this country, such as GST returns or e-way bills.
   * Everything else (invoices, expenses, accounts, stock, reports) is shared by every country.
   * See lib/countries/features.ts.
   */
  features?: string[];
  /**
   * The month the business's tax year starts: 4 for India's April-to-March financial year, 1 for
   * the US calendar year. Reports, Books and Year end count "a year" from here. Unset means April,
   * which is how the app has always counted.
   */
  yearStartMonth?: number;
  notes?: string;
}

/** Rules in force on a given date, newest version first. */
export function rulesOn(pack: CountryPack, isoDate: string): TaxRule[] {
  return pack.taxRules
    .filter((r) => r.effectiveFrom <= isoDate && (!r.effectiveUntil || r.effectiveUntil > isoDate))
    .sort((a, b) => b.version - a.version);
}

export function ruleById(pack: CountryPack, id: string): TaxRule | undefined {
  return pack.taxRules.find((r) => r.id === id);
}

/** The rate a country treats as its default for ordinary goods and services on a date. */
export function standardRuleOn(pack: CountryPack, isoDate: string): TaxRule | undefined {
  return rulesOn(pack, isoDate).find((r) => r.category === "standard");
}
