/**
 * How fast the things a business owns wear out — on paper, twice over.
 *
 * India measures this two different ways and a business has to keep both. The books use a useful
 * life: a laptop lasts three years, so a third of its cost is a cost each year. The tax
 * computation uses blocks of assets written down at a fixed percentage, where your laptop stops
 * being a laptop and becomes part of one pool of computers. The two give different answers on
 * purpose, and the difference between them is a real line in a tax computation.
 *
 * Keeping only the first would make the books look right and the tax return wrong. Keeping only
 * the second would hand an accountant figures that do not belong in a balance sheet. So both.
 *
 * Read from published summaries rather than from the schedules themselves, so nothing here is
 * marked published, and every screen built on it says so.
 */

export type Method = "straight-line" | "written-down";

export interface AssetClass {
  id: string;
  label: string;
  /** What belongs here, in the words somebody buying the thing would use. */
  describes: string;
  /** Schedule II of the Companies Act: the life the books are supposed to use, in years. */
  usefulLifeYears: number;
  /** The Income-tax rules: which block it joins, and the rate that block is written down at. */
  taxBlock: string;
  taxRate: number;
  /** What the books do by default. Most small businesses use the simpler one. */
  booksMethod: Method;
  source: string;
  status: "published" | "unverified";
}

const SOURCE = "Schedule II of the Companies Act 2013 and the Income-tax depreciation rates, as published in secondary summaries (2026)";

export const ASSET_CLASSES: AssetClass[] = [
  {
    id: "computers",
    label: "Computers and laptops",
    describes: "Laptops, desktops, servers, tablets, printers.",
    usefulLifeYears: 3,
    taxBlock: "Computers",
    taxRate: 0.40,
    booksMethod: "straight-line",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "software",
    label: "Software bought outright",
    describes: "A licence you own rather than rent. A monthly subscription is a cost, not an asset.",
    usefulLifeYears: 3,
    taxBlock: "Computers",
    taxRate: 0.40,
    booksMethod: "straight-line",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "furniture",
    label: "Furniture and fittings",
    describes: "Desks, chairs, shelving, air conditioning, the fit-out of a shop.",
    usefulLifeYears: 10,
    taxBlock: "Furniture and fittings",
    taxRate: 0.10,
    booksMethod: "straight-line",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "plant",
    label: "Plant and machinery",
    describes: "Machines, tools, equipment used to make or do the work.",
    usefulLifeYears: 15,
    taxBlock: "Plant and machinery",
    taxRate: 0.15,
    booksMethod: "straight-line",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "vehicles",
    label: "Vehicles",
    describes: "A car, a van, a two-wheeler used for the business.",
    usefulLifeYears: 8,
    taxBlock: "Motor vehicles",
    taxRate: 0.15,
    booksMethod: "written-down",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "buildings",
    label: "Buildings",
    describes: "Premises you own. Not rent, and not a deposit on a rented place.",
    usefulLifeYears: 30,
    taxBlock: "Buildings",
    taxRate: 0.10,
    booksMethod: "straight-line",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "intangible",
    label: "Trademarks, patents, goodwill",
    describes: "Something registered or bought that has no physical form.",
    usefulLifeYears: 10,
    taxBlock: "Intangible assets",
    taxRate: 0.25,
    booksMethod: "straight-line",
    source: SOURCE,
    status: "unverified"
  }
];

export const classById = (id: string): AssetClass | undefined => ASSET_CLASSES.find((c) => c.id === id);

/**
 * Whether a purchase is big enough and long-lived enough to be worth treating as an asset.
 *
 * There is no legal floor in India — a ₹2,000 kettle could in principle be depreciated over ten
 * years — but doing so is a waste of everybody's time, and most accountants write small things
 * off at once. This is a prompt, not a rule, so the number is deliberately a round one.
 */
export const WORTH_CAPITALISING_MINOR = 1_000_000;

/** Expense accounts where a large purchase is often really an asset somebody mis-filed. */
export const WATCH_ACCOUNTS: Record<string, string> = {
  "6100": "computers",
  "6040": "software",
  "6080": "plant"
};

export const ASSET_CAVEAT =
  "Useful lives and block rates here are read from published summaries rather than from the schedules themselves. The books figure and the tax figure are meant to differ; confirm both with whoever files your return.";
