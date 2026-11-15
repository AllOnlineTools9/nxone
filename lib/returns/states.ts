/**
 * The state codes a GST return is written in, and whether a GSTIN is real.
 *
 * A return does not say "Maharashtra", it says "27-Maharashtra", and the first two digits of every
 * GSTIN are the same code. That makes the code worth holding properly: it is what lets us catch a
 * customer's tax number that was typed with the wrong state before the return is filed rather than
 * after, when it becomes somebody else's missing credit.
 *
 * Source: the state codes published with the GST registration rules. Codes retired when states
 * merged are kept, because invoices from before the merger still carry them.
 */

export interface GstState {
  /** The two-letter code used everywhere else in NXOne. */
  region: string;
  /** The numeric code used on returns and in a GSTIN. */
  code: string;
  name: string;
  /** Retired codes stay readable but are never offered for new documents. */
  retired?: boolean;
}

export const GST_STATES: GstState[] = [
  { region: "JK", code: "01", name: "Jammu and Kashmir" },
  { region: "HP", code: "02", name: "Himachal Pradesh" },
  { region: "PB", code: "03", name: "Punjab" },
  { region: "CH", code: "04", name: "Chandigarh" },
  { region: "UT", code: "05", name: "Uttarakhand" },
  { region: "HR", code: "06", name: "Haryana" },
  { region: "DL", code: "07", name: "Delhi" },
  { region: "RJ", code: "08", name: "Rajasthan" },
  { region: "UP", code: "09", name: "Uttar Pradesh" },
  { region: "BR", code: "10", name: "Bihar" },
  { region: "SK", code: "11", name: "Sikkim" },
  { region: "AR", code: "12", name: "Arunachal Pradesh" },
  { region: "NL", code: "13", name: "Nagaland" },
  { region: "MN", code: "14", name: "Manipur" },
  { region: "MZ", code: "15", name: "Mizoram" },
  { region: "TR", code: "16", name: "Tripura" },
  { region: "ML", code: "17", name: "Meghalaya" },
  { region: "AS", code: "18", name: "Assam" },
  { region: "WB", code: "19", name: "West Bengal" },
  { region: "JH", code: "20", name: "Jharkhand" },
  { region: "OR", code: "21", name: "Odisha" },
  { region: "CT", code: "22", name: "Chhattisgarh" },
  { region: "MP", code: "23", name: "Madhya Pradesh" },
  { region: "GJ", code: "24", name: "Gujarat" },
  { region: "DD", code: "25", name: "Daman and Diu", retired: true },
  { region: "DN", code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { region: "MH", code: "27", name: "Maharashtra" },
  { region: "AP2", code: "28", name: "Andhra Pradesh (before the split)", retired: true },
  { region: "KA", code: "29", name: "Karnataka" },
  { region: "GA", code: "30", name: "Goa" },
  { region: "LD", code: "31", name: "Lakshadweep" },
  { region: "KL", code: "32", name: "Kerala" },
  { region: "TN", code: "33", name: "Tamil Nadu" },
  { region: "PY", code: "34", name: "Puducherry" },
  { region: "AN", code: "35", name: "Andaman and Nicobar Islands" },
  { region: "TG", code: "36", name: "Telangana" },
  { region: "AP", code: "37", name: "Andhra Pradesh" },
  { region: "LA", code: "38", name: "Ladakh" },
  { region: "OT", code: "97", name: "Other Territory" }
];

export const stateByRegion = (region?: string): GstState | undefined =>
  region ? GST_STATES.find((s) => !s.retired && s.region === region.toUpperCase()) : undefined;

export const stateByCode = (code?: string): GstState | undefined =>
  code ? GST_STATES.find((s) => s.code === code.padStart(2, "0")) : undefined;

/** How a place of supply is written on a return: "27-Maharashtra". */
export function placeOfSupply(region?: string): string {
  const state = stateByRegion(region);
  return state ? `${state.code}-${state.name}` : "";
}

/* ------------------------------------------------------------------ GSTINs */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The check digit built into a GSTIN. Each of the first fourteen characters is weighted one and
 * two by turn; the product is split into its quotient and remainder over thirty-six and both are
 * added, and the digit is whatever brings the total to a multiple of thirty-six.
 */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = ALPHABET.indexOf(first14[i]);
    if (value < 0) return "";
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

export type GstinProblem = "length" | "shape" | "state" | "checksum";

export interface GstinVerdict {
  valid: boolean;
  problem?: GstinProblem;
  /** Said to the person, in their terms. */
  says?: string;
  state?: GstState;
}

/**
 * Whether a tax number can be real. A GSTIN carries its own check digit, so a typo is caught here
 * rather than by a customer three months later wondering where their credit went.
 */
export function checkGstin(value: string | undefined, expectRegion?: string): GstinVerdict {
  const gstin = (value ?? "").trim().toUpperCase();
  if (gstin.length !== 15) return { valid: false, problem: "length", says: "A GSTIN is 15 characters." };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}[0-9A-Z]$/.test(gstin)) {
    return { valid: false, problem: "shape", says: "That is not the shape of a GSTIN: two digits, then a PAN, then three more characters." };
  }

  const state = stateByCode(gstin.slice(0, 2));
  if (!state) return { valid: false, problem: "state", says: `${gstin.slice(0, 2)} is not a state code.` };

  if (gstinCheckDigit(gstin.slice(0, 14)) !== gstin[14]) {
    return { valid: false, problem: "checksum", says: "The last character does not match the rest, so a character has been mistyped.", state };
  }

  if (expectRegion) {
    const expected = stateByRegion(expectRegion);
    if (expected && expected.code !== state.code) {
      return { valid: false, problem: "state", says: `This number is registered in ${state.name}, but the customer is recorded in ${expected.name}.`, state };
    }
  }

  return { valid: true, state };
}
