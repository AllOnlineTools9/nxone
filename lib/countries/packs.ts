import type { CountryPack } from "./types";

/**
 * Seed country packs. Rates below are the widely published headline rates and each carries its
 * source and the date it took effect. Before any of this is treated as authoritative for filing,
 * it should be checked against the regulator named in the source field.
 */

const commonFields = [
  { key: "sellerName", label: "Your business name", required: true },
  { key: "sellerAddress", label: "Your address", required: true },
  { key: "buyerName", label: "Customer name", required: true },
  { key: "number", label: "Invoice number", required: true },
  { key: "issueDate", label: "Invoice date", required: true }
];

export const INDIA: CountryPack = {
  code: "IN",
  name: "India",
  currency: "INR",
  locale: "en-IN",
  numberSystem: "indian",
  dateFormat: "dd/mm/yyyy",
  taxSystem: "GST",
  taxLabel: "GST",
  taxIdLabel: "GSTIN",
  taxIdPattern: "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$",
  invoiceTitle: "Tax Invoice",
  support: "supported",
  yearStartMonth: 4,
  features: ["gst-returns", "gst-scheme", "input-credit", "tds", "advance-tax", "e-invoicing", "e-way-bills", "hsn", "payroll", "tally", "hinglish"],
  notes: "GST splits into CGST and SGST within a state and becomes IGST between states. Since 22 September 2025 the usual rates are 5% and 18%, with 40% on luxury and sin goods. The old 12% and 28% rates stay available for invoices dated before that change.",
  regions: [
    { code: "AN", name: "Andaman and Nicobar Islands", kind: "ut" }, { code: "AP", name: "Andhra Pradesh" }, { code: "AR", name: "Arunachal Pradesh" },
    { code: "AS", name: "Assam" }, { code: "BR", name: "Bihar" }, { code: "CH", name: "Chandigarh", kind: "ut" }, { code: "CT", name: "Chhattisgarh" },
    { code: "DL", name: "Delhi" }, { code: "GA", name: "Goa" }, { code: "GJ", name: "Gujarat" }, { code: "HR", name: "Haryana" },
    { code: "HP", name: "Himachal Pradesh" }, { code: "JK", name: "Jammu and Kashmir" }, { code: "JH", name: "Jharkhand" },
    { code: "KA", name: "Karnataka" }, { code: "KL", name: "Kerala" }, { code: "LA", name: "Ladakh", kind: "ut" }, { code: "MP", name: "Madhya Pradesh" },
    { code: "MH", name: "Maharashtra" }, { code: "MN", name: "Manipur" }, { code: "ML", name: "Meghalaya" }, { code: "MZ", name: "Mizoram" },
    { code: "NL", name: "Nagaland" }, { code: "OR", name: "Odisha" }, { code: "PY", name: "Puducherry" }, { code: "PB", name: "Punjab" },
    { code: "RJ", name: "Rajasthan" }, { code: "SK", name: "Sikkim" }, { code: "TN", name: "Tamil Nadu" }, { code: "TG", name: "Telangana" },
    { code: "TR", name: "Tripura" }, { code: "UP", name: "Uttar Pradesh" }, { code: "UT", name: "Uttarakhand" }, { code: "WB", name: "West Bengal" },
    { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu", kind: "ut" }, { code: "LD", name: "Lakshadweep", kind: "ut" }
  ],
  requiredFields: [
    ...commonFields,
    { key: "sellerTaxId", label: "Your GSTIN", required: false, help: "Required if you are registered under GST." },
    { key: "buyerTaxId", label: "Customer GSTIN", required: false, help: "Required for business customers claiming input credit." },
    { key: "placeOfSupply", label: "Place of supply", required: true, help: "Decides whether CGST and SGST or IGST applies." },
    { key: "hsn", label: "HSN or SAC code", required: false, help: "Required above prescribed turnover limits." }
  ],
  taxRules: [
    { id: "in-gst-0", jurisdiction: "IN", label: "GST 0% (nil rated or exempt)", rate: 0, category: "zero", effectiveFrom: "2017-07-01", source: "GST Council rate schedules", version: 1, status: "published" },
    { id: "in-gst-5", jurisdiction: "IN", label: "GST 5%", rate: 5, category: "reduced", effectiveFrom: "2017-07-01", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "CGST", share: 0.5 }, { label: "SGST", share: 0.5 }], appliesWhen: "intra-region" },
    { id: "in-gst-18", jurisdiction: "IN", label: "GST 18%", rate: 18, category: "standard", effectiveFrom: "2017-07-01", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "CGST", share: 0.5 }, { label: "SGST", share: 0.5 }], appliesWhen: "intra-region" },
    { id: "in-gst-3", jurisdiction: "IN", label: "GST 3% (gold, silver, jewellery)", rate: 3, category: "special", effectiveFrom: "2017-07-01", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "CGST", share: 0.5 }, { label: "SGST", share: 0.5 }], appliesWhen: "intra-region" },
    // withdrawn by the 56th GST Council, effective 22 September 2025. Kept so older invoices still calculate correctly.
    { id: "in-gst-12", jurisdiction: "IN", label: "GST 12%", rate: 12, category: "reduced-old", effectiveFrom: "2017-07-01", effectiveUntil: "2025-09-22", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "CGST", share: 0.5 }, { label: "SGST", share: 0.5 }], appliesWhen: "intra-region" },
    { id: "in-gst-28", jurisdiction: "IN", label: "GST 28%", rate: 28, category: "higher-old", effectiveFrom: "2017-07-01", effectiveUntil: "2025-09-22", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "CGST", share: 0.5 }, { label: "SGST", share: 0.5 }], appliesWhen: "intra-region" },
    // introduced by the same reform for luxury and de-merit goods
    { id: "in-gst-40", jurisdiction: "IN", label: "GST 40% (luxury and sin goods)", rate: 40, category: "higher", effectiveFrom: "2025-09-22", source: "56th GST Council, effective 22 September 2025", version: 2, status: "published", components: [{ label: "CGST", share: 0.5 }, { label: "SGST", share: 0.5 }], appliesWhen: "intra-region" },
    { id: "in-igst-5", jurisdiction: "IN", label: "IGST 5%", rate: 5, category: "reduced-inter", effectiveFrom: "2017-07-01", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "IGST", share: 1 }], appliesWhen: "inter-region" },
    { id: "in-igst-18", jurisdiction: "IN", label: "IGST 18%", rate: 18, category: "standard-inter", effectiveFrom: "2017-07-01", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "IGST", share: 1 }], appliesWhen: "inter-region" },
    { id: "in-igst-3", jurisdiction: "IN", label: "IGST 3% (gold, silver, jewellery)", rate: 3, category: "special-inter", effectiveFrom: "2017-07-01", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "IGST", share: 1 }], appliesWhen: "inter-region" },
    { id: "in-igst-12", jurisdiction: "IN", label: "IGST 12%", rate: 12, category: "reduced-inter-old", effectiveFrom: "2017-07-01", effectiveUntil: "2025-09-22", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "IGST", share: 1 }], appliesWhen: "inter-region" },
    { id: "in-igst-28", jurisdiction: "IN", label: "IGST 28%", rate: 28, category: "higher-inter-old", effectiveFrom: "2017-07-01", effectiveUntil: "2025-09-22", source: "GST Council rate schedules", version: 1, status: "published", components: [{ label: "IGST", share: 1 }], appliesWhen: "inter-region" },
    { id: "in-igst-40", jurisdiction: "IN", label: "IGST 40% (luxury and sin goods)", rate: 40, category: "higher-inter", effectiveFrom: "2025-09-22", source: "56th GST Council, effective 22 September 2025", version: 2, status: "published", components: [{ label: "IGST", share: 1 }], appliesWhen: "inter-region" }
  ]
};

export const UNITED_KINGDOM: CountryPack = {
  code: "GB",
  name: "United Kingdom",
  currency: "GBP",
  locale: "en-GB",
  numberSystem: "international",
  dateFormat: "dd/mm/yyyy",
  taxSystem: "VAT",
  taxLabel: "VAT",
  taxIdLabel: "VAT number",
  taxIdPattern: "^(GB)?[0-9]{9}([0-9]{3})?$",
  invoiceTitle: "VAT Invoice",
  support: "supported",
  notes: "VAT registration is required above the published turnover threshold. Below it, invoices should not show VAT.",
  requiredFields: [
    ...commonFields,
    { key: "sellerTaxId", label: "Your VAT number", required: false, help: "Required if you are VAT registered." },
    { key: "buyerAddress", label: "Customer address", required: true },
    { key: "supplyDate", label: "Date of supply (tax point)", required: false }
  ],
  taxRules: [
    { id: "gb-vat-20", jurisdiction: "GB", label: "VAT standard 20%", rate: 20, category: "standard", effectiveFrom: "2011-01-04", source: "HMRC VAT rates", version: 1, status: "published" },
    { id: "gb-vat-5", jurisdiction: "GB", label: "VAT reduced 5%", rate: 5, category: "reduced", effectiveFrom: "2011-01-04", source: "HMRC VAT rates", version: 1, status: "published" },
    { id: "gb-vat-0", jurisdiction: "GB", label: "VAT zero rated 0%", rate: 0, category: "zero", effectiveFrom: "2011-01-04", source: "HMRC VAT rates", version: 1, status: "published" },
    { id: "gb-vat-exempt", jurisdiction: "GB", label: "VAT exempt", rate: 0, category: "exempt", effectiveFrom: "2011-01-04", source: "HMRC VAT notice 701", version: 1, status: "published" }
  ]
};

/**
 * The United States. Sales tax is set by each state, and most add county, city and district taxes
 * on top, so the combined rate depends on the street address. The pack carries every state's own
 * rate, dated, and lets the seller enter the combined rate where local tax applies. A rate service
 * would give the exact combined rate per address; until one is connected, the honest default is
 * the state rate plus a clear prompt to add local tax.
 *
 * California, Utah and Virginia charge a statewide local add-on everywhere (1.25%, 1.25% and 1%);
 * it is included in their state rate here, as the Tax Foundation does, because no buyer escapes it.
 */
const US_STATES = [
    { code: "AL", name: "Alabama" },
    { code: "AK", name: "Alaska" },
    { code: "AZ", name: "Arizona" },
    { code: "AR", name: "Arkansas" },
    { code: "CA", name: "California" },
    { code: "CO", name: "Colorado" },
    { code: "CT", name: "Connecticut" },
    { code: "DE", name: "Delaware" },
    { code: "DC", name: "District of Columbia" },
    { code: "FL", name: "Florida" },
    { code: "GA", name: "Georgia" },
    { code: "HI", name: "Hawaii" },
    { code: "ID", name: "Idaho" },
    { code: "IL", name: "Illinois" },
    { code: "IN", name: "Indiana" },
    { code: "IA", name: "Iowa" },
    { code: "KS", name: "Kansas" },
    { code: "KY", name: "Kentucky" },
    { code: "LA", name: "Louisiana" },
    { code: "ME", name: "Maine" },
    { code: "MD", name: "Maryland" },
    { code: "MA", name: "Massachusetts" },
    { code: "MI", name: "Michigan" },
    { code: "MN", name: "Minnesota" },
    { code: "MS", name: "Mississippi" },
    { code: "MO", name: "Missouri" },
    { code: "MT", name: "Montana" },
    { code: "NE", name: "Nebraska" },
    { code: "NV", name: "Nevada" },
    { code: "NH", name: "New Hampshire" },
    { code: "NJ", name: "New Jersey" },
    { code: "NM", name: "New Mexico" },
    { code: "NY", name: "New York" },
    { code: "NC", name: "North Carolina" },
    { code: "ND", name: "North Dakota" },
    { code: "OH", name: "Ohio" },
    { code: "OK", name: "Oklahoma" },
    { code: "OR", name: "Oregon" },
    { code: "PA", name: "Pennsylvania" },
    { code: "RI", name: "Rhode Island" },
    { code: "SC", name: "South Carolina" },
    { code: "SD", name: "South Dakota" },
    { code: "TN", name: "Tennessee" },
    { code: "TX", name: "Texas" },
    { code: "UT", name: "Utah" },
    { code: "VT", name: "Vermont" },
    { code: "VA", name: "Virginia" },
    { code: "WA", name: "Washington" },
    { code: "WV", name: "West Virginia" },
    { code: "WI", name: "Wisconsin" },
    { code: "WY", name: "Wyoming" }
];

export const UNITED_STATES: CountryPack = {
  code: "US",
  name: "United States",
  currency: "USD",
  locale: "en-US",
  numberSystem: "international",
  dateFormat: "mm/dd/yyyy",
  taxSystem: "SALES_TAX",
  taxLabel: "Sales tax",
  taxIdLabel: "EIN",
  // An EIN is nine digits, written 12-3456789. A sole proprietor may have none and use an SSN,
  // which never belongs on an invoice, so the field stays optional.
  taxIdPattern: "^\\d{2}-?\\d{7}$",
  invoiceTitle: "Invoice",
  support: "supported",
  // Most small US businesses file on the calendar year.
  yearStartMonth: 1,
  notes: "Each state sets its own sales tax rate and most add county and city tax on top. Pick the customer's state and the state rate fills in; if local tax applies where they receive the goods, choose the combined rate and enter it. Many services are not taxable, and a customer with a resale or exemption certificate pays none.",
  regions: US_STATES,
  regionLabels: {
    seller: "Your state",
    supply: "Customer's state (ship-to)",
    printed: "Ship-to state",
    help: "Sales tax usually follows where the customer receives the goods or service. The state rate leaves out county and city tax; to include it, choose \"Combined state and local rate\" on the line and enter the total."
  },
  requiredFields: [
    ...commonFields,
    { key: "sellerTaxId", label: "EIN (optional)", required: false },
    { key: "buyerAddress", label: "Customer address", required: false },
    { key: "placeOfSupply", label: "Customer's state", required: false }
  ],
  taxRules: [
    { id: "us-custom", jurisdiction: "US", label: "Combined state and local rate (enter it)", rate: 0, category: "standard", effectiveFrom: "2000-01-01", source: "Your state's sales tax rate lookup for the delivery address", version: 1, status: "draft" },
    { id: "us-none", jurisdiction: "US", label: "Not taxable 0%", rate: 0, category: "zero", effectiveFrom: "2000-01-01", source: "n/a", version: 1, status: "published" },
    { id: "us-exempt", jurisdiction: "US", label: "Exempt customer or resale 0%", rate: 0, category: "exempt", effectiveFrom: "2000-01-01", source: "Keep the customer's resale or exemption certificate on file", version: 1, status: "published" },
    { id: "us-st-al", jurisdiction: "US-AL", label: "Alabama 4% (state rate)", rate: 4, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ak", jurisdiction: "US-AK", label: "Alaska: no state sales tax, but local sales tax may apply", rate: 0, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-az", jurisdiction: "US-AZ", label: "Arizona 5.6% (state rate)", rate: 5.6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ar", jurisdiction: "US-AR", label: "Arkansas 6.5% (state rate)", rate: 6.5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ca", jurisdiction: "US-CA", label: "California 7.25% statewide (state rate)", rate: 7.25, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-co", jurisdiction: "US-CO", label: "Colorado 2.9% (state rate)", rate: 2.9, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ct", jurisdiction: "US-CT", label: "Connecticut 6.35% (state rate)", rate: 6.35, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-de", jurisdiction: "US-DE", label: "Delaware: no sales tax", rate: 0, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-dc", jurisdiction: "US-DC", label: "District of Columbia 6%", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", effectiveUntil: "2027-10-01", source: "DC Office of Tax and Revenue; the rise to 7% was moved from 1 Oct 2026 to 1 Oct 2027", version: 1, status: "published" },
    { id: "us-st-dc-7", jurisdiction: "US-DC", label: "District of Columbia 7%", rate: 7, category: "standard-region", effectiveFrom: "2027-10-01", source: "DC Office of Tax and Revenue, FY2026 Budget Support Act", version: 2, status: "published" },
    { id: "us-st-fl", jurisdiction: "US-FL", label: "Florida 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ga", jurisdiction: "US-GA", label: "Georgia 4% (state rate)", rate: 4, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-hi", jurisdiction: "US-HI", label: "Hawaii general excise tax 4%", rate: 4, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-id", jurisdiction: "US-ID", label: "Idaho 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-il", jurisdiction: "US-IL", label: "Illinois 6.25% (state rate)", rate: 6.25, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-in", jurisdiction: "US-IN", label: "Indiana 7% (state rate)", rate: 7, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ia", jurisdiction: "US-IA", label: "Iowa 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ks", jurisdiction: "US-KS", label: "Kansas 6.5% (state rate)", rate: 6.5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ky", jurisdiction: "US-KY", label: "Kentucky 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-la", jurisdiction: "US-LA", label: "Louisiana 5% (state rate)", rate: 5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-me", jurisdiction: "US-ME", label: "Maine 5.5% (state rate)", rate: 5.5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-md", jurisdiction: "US-MD", label: "Maryland 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ma", jurisdiction: "US-MA", label: "Massachusetts 6.25% (state rate)", rate: 6.25, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-mi", jurisdiction: "US-MI", label: "Michigan 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-mn", jurisdiction: "US-MN", label: "Minnesota 6.875% (state rate)", rate: 6.875, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ms", jurisdiction: "US-MS", label: "Mississippi 7% (state rate)", rate: 7, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-mo", jurisdiction: "US-MO", label: "Missouri 4.225% (state rate)", rate: 4.225, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-mt", jurisdiction: "US-MT", label: "Montana: no sales tax", rate: 0, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ne", jurisdiction: "US-NE", label: "Nebraska 5.5% (state rate)", rate: 5.5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-nv", jurisdiction: "US-NV", label: "Nevada 6.85% (state rate)", rate: 6.85, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-nh", jurisdiction: "US-NH", label: "New Hampshire: no sales tax", rate: 0, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-nj", jurisdiction: "US-NJ", label: "New Jersey 6.625% (state rate)", rate: 6.625, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-nm", jurisdiction: "US-NM", label: "New Mexico 4.875% (state rate)", rate: 4.875, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ny", jurisdiction: "US-NY", label: "New York 4% (state rate)", rate: 4, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-nc", jurisdiction: "US-NC", label: "North Carolina 4.75% (state rate)", rate: 4.75, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-nd", jurisdiction: "US-ND", label: "North Dakota 5% (state rate)", rate: 5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-oh", jurisdiction: "US-OH", label: "Ohio 5.75% (state rate)", rate: 5.75, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ok", jurisdiction: "US-OK", label: "Oklahoma 4.5% (state rate)", rate: 4.5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-or", jurisdiction: "US-OR", label: "Oregon: no sales tax", rate: 0, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-pa", jurisdiction: "US-PA", label: "Pennsylvania 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ri", jurisdiction: "US-RI", label: "Rhode Island 7% (state rate)", rate: 7, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-sc", jurisdiction: "US-SC", label: "South Carolina 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-sd", jurisdiction: "US-SD", label: "South Dakota 4.2% (state rate)", rate: 4.2, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-tn", jurisdiction: "US-TN", label: "Tennessee 7% (state rate)", rate: 7, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-tx", jurisdiction: "US-TX", label: "Texas 6.25% (state rate)", rate: 6.25, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-ut", jurisdiction: "US-UT", label: "Utah 6.1% statewide (state rate)", rate: 6.1, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-vt", jurisdiction: "US-VT", label: "Vermont 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-va", jurisdiction: "US-VA", label: "Virginia 5.3% statewide (state rate)", rate: 5.3, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-wa", jurisdiction: "US-WA", label: "Washington 6.5% (state rate)", rate: 6.5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-wv", jurisdiction: "US-WV", label: "West Virginia 6% (state rate)", rate: 6, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-wi", jurisdiction: "US-WI", label: "Wisconsin 5% (state rate)", rate: 5, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" },
    { id: "us-st-wy", jurisdiction: "US-WY", label: "Wyoming 4% (state rate)", rate: 4, category: "standard-region", effectiveFrom: "2025-01-01", source: "Tax Foundation, state rates as of 1 July 2026, and the state revenue department", version: 1, status: "published" }
  ]
};

export const UAE: CountryPack = {
  code: "AE",
  name: "United Arab Emirates",
  currency: "AED",
  locale: "en-AE",
  numberSystem: "international",
  dateFormat: "dd/mm/yyyy",
  taxSystem: "VAT",
  taxLabel: "VAT",
  taxIdLabel: "TRN",
  taxIdPattern: "^[0-9]{15}$",
  invoiceTitle: "Tax Invoice",
  support: "supported",
  requiredFields: [...commonFields, { key: "sellerTaxId", label: "Your TRN", required: false, help: "Required if registered for VAT." }, { key: "buyerAddress", label: "Customer address", required: true }],
  taxRules: [
    { id: "ae-vat-5", jurisdiction: "AE", label: "VAT 5%", rate: 5, category: "standard", effectiveFrom: "2018-01-01", source: "Federal Tax Authority", version: 1, status: "published" },
    { id: "ae-vat-0", jurisdiction: "AE", label: "VAT zero rated 0%", rate: 0, category: "zero", effectiveFrom: "2018-01-01", source: "Federal Tax Authority", version: 1, status: "published" },
    { id: "ae-vat-exempt", jurisdiction: "AE", label: "VAT exempt", rate: 0, category: "exempt", effectiveFrom: "2018-01-01", source: "Federal Tax Authority", version: 1, status: "published" }
  ]
};

export const SINGAPORE: CountryPack = {
  code: "SG",
  name: "Singapore",
  currency: "SGD",
  locale: "en-SG",
  numberSystem: "international",
  dateFormat: "dd/mm/yyyy",
  taxSystem: "GST",
  taxLabel: "GST",
  taxIdLabel: "GST registration number",
  invoiceTitle: "Tax Invoice",
  support: "supported",
  requiredFields: [...commonFields, { key: "sellerTaxId", label: "Your GST registration number", required: false }, { key: "buyerAddress", label: "Customer address", required: true }],
  taxRules: [
    { id: "sg-gst-7", jurisdiction: "SG", label: "GST 7%", rate: 7, category: "standard", effectiveFrom: "2007-07-01", effectiveUntil: "2023-01-01", source: "IRAS", version: 1, status: "published" },
    { id: "sg-gst-8", jurisdiction: "SG", label: "GST 8%", rate: 8, category: "standard", effectiveFrom: "2023-01-01", effectiveUntil: "2024-01-01", source: "IRAS", version: 2, status: "published" },
    { id: "sg-gst-9", jurisdiction: "SG", label: "GST 9%", rate: 9, category: "standard", effectiveFrom: "2024-01-01", source: "IRAS", version: 3, status: "published" },
    { id: "sg-gst-0", jurisdiction: "SG", label: "GST zero rated 0%", rate: 0, category: "zero", effectiveFrom: "2007-07-01", source: "IRAS", version: 1, status: "published" }
  ]
};

export const AUSTRALIA: CountryPack = {
  code: "AU",
  name: "Australia",
  currency: "AUD",
  locale: "en-AU",
  numberSystem: "international",
  dateFormat: "dd/mm/yyyy",
  taxSystem: "GST",
  taxLabel: "GST",
  taxIdLabel: "ABN",
  taxIdPattern: "^[0-9]{11}$",
  invoiceTitle: "Tax Invoice",
  support: "supported",
  requiredFields: [...commonFields, { key: "sellerTaxId", label: "Your ABN", required: true, help: "An Australian tax invoice must show the supplier's ABN." }],
  taxRules: [
    { id: "au-gst-10", jurisdiction: "AU", label: "GST 10%", rate: 10, category: "standard", effectiveFrom: "2000-07-01", source: "Australian Taxation Office", version: 1, status: "published" },
    { id: "au-gst-0", jurisdiction: "AU", label: "GST free 0%", rate: 0, category: "zero", effectiveFrom: "2000-07-01", source: "Australian Taxation Office", version: 1, status: "published" }
  ]
};

export const CANADA: CountryPack = {
  code: "CA",
  name: "Canada",
  currency: "CAD",
  locale: "en-CA",
  numberSystem: "international",
  dateFormat: "yyyy-mm-dd",
  taxSystem: "GST",
  taxLabel: "GST/HST",
  taxIdLabel: "GST/HST number",
  invoiceTitle: "Invoice",
  support: "partial",
  notes: "Federal GST applies everywhere. Several provinces combine it into HST, and others add a separate provincial tax. Pick the rate for the province where the supply takes place.",
  requiredFields: [...commonFields, { key: "sellerTaxId", label: "Your GST/HST number", required: false }, { key: "placeOfSupply", label: "Province of supply", required: false }],
  taxRules: [
    { id: "ca-gst-5", jurisdiction: "CA", label: "GST 5%", rate: 5, category: "standard", effectiveFrom: "2008-01-01", source: "Canada Revenue Agency", version: 1, status: "published" },
    { id: "ca-hst-13", jurisdiction: "CA-ON", label: "HST 13% (Ontario)", rate: 13, category: "standard-region", effectiveFrom: "2010-07-01", source: "Canada Revenue Agency", version: 1, status: "published" },
    { id: "ca-hst-15", jurisdiction: "CA-NS", label: "HST 15% (Atlantic provinces)", rate: 15, category: "standard-region", effectiveFrom: "2016-07-01", source: "Canada Revenue Agency", version: 1, status: "published" },
    { id: "ca-gst-0", jurisdiction: "CA", label: "Zero rated 0%", rate: 0, category: "zero", effectiveFrom: "2008-01-01", source: "Canada Revenue Agency", version: 1, status: "published" }
  ]
};

/** A last-resort pack for countries without their own: no tax assumptions, user enters a rate. */
export const GENERIC: CountryPack = {
  code: "XX",
  name: "Other country",
  currency: "USD",
  locale: "en-US",
  numberSystem: "international",
  dateFormat: "yyyy-mm-dd",
  taxSystem: "NONE",
  taxLabel: "Tax",
  taxIdLabel: "Tax number",
  invoiceTitle: "Invoice",
  support: "configuration-only",
  notes: "No tax rules are configured for this country yet. Enter the rate that applies to you, and check it against your own tax authority.",
  requiredFields: commonFields,
  taxRules: [
    { id: "xx-none", jurisdiction: "XX", label: "No tax", rate: 0, category: "zero", effectiveFrom: "2000-01-01", source: "n/a", version: 1, status: "published" },
    { id: "xx-custom", jurisdiction: "XX", label: "Tax (enter your rate)", rate: 0, category: "standard", effectiveFrom: "2000-01-01", source: "Your tax authority", version: 1, status: "draft" }
  ]
};

export const PACKS: CountryPack[] = [INDIA, UNITED_STATES, UNITED_KINGDOM, UAE, SINGAPORE, AUSTRALIA, CANADA, GENERIC];
/** Falls back rather than throwing: a document with a missing country should still calculate. */
export const packFor = (code: string | undefined | null): CountryPack =>
  (code ? PACKS.find((p) => p.code === String(code).toUpperCase()) : undefined) ?? GENERIC;
