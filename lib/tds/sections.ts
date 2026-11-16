/**
 * Tax deducted at source on what you pay your suppliers.
 *
 * A business paying a contractor, a landlord or a professional is supposed to hold back a slice
 * of the payment and hand it to the government itself. Miss it and the cost is not just the tax:
 * the expense can be disallowed, so you pay tax on money you actually spent, plus interest and a
 * late-filing fee. It is the most common thing a small business gets wrong, because nothing in
 * the act of paying a bill reminds you.
 *
 * Every rule here carries the date it applies from and where it came from. None is marked
 * published, because all of it was read from commentary rather than from the department's own
 * notification — these figures decide what somebody pays, so the screen says so and tells people
 * to confirm with their accountant rather than presenting it as settled.
 */

export type DeducteeType = "individual" | "other";
export type ThresholdBasis = "single-or-annual" | "annual" | "monthly";

export interface TdsSection {
  /** The section everybody still calls it by. */
  id: string;
  label: string;
  /** What it covers, in the words somebody paying a bill would use. */
  describes: string;
  /** The payment code under the Income-tax Act 2025, which replaced the 1961 Act's sections. */
  newCode?: string;
  rate: { individual: number; other: number };
  threshold: {
    basis: ThresholdBasis;
    /** A single payment above this is enough on its own. */
    singleMinor?: number;
    /** Payments to one supplier across the year, or one month where the basis says so. */
    aggregateMinor?: number;
  };
  /** The rate when the supplier has given no PAN. */
  noPanRate: number;
  appliesFrom: string;
  source: string;
  status: "published" | "unverified";
}

const CRORE = 10_000_000_00; // minor units

export const TDS_SECTIONS: TdsSection[] = [
  {
    id: "194C",
    label: "Contractors",
    describes: "Work done to your order: building, fabrication, printing, catering, transport, advertising, a sub-contractor.",
    newCode: "1023 / 1024",
    rate: { individual: 0.01, other: 0.02 },
    threshold: { basis: "single-or-annual", singleMinor: 3_000_000, aggregateMinor: 10_000_000 },
    noPanRate: 0.20,
    appliesFrom: "2025-04-01",
    source: "TDS rate charts for FY 2026-27 (secondary sources, April 2026)",
    status: "unverified"
  },
  {
    id: "194J-professional",
    label: "Professional fees",
    describes: "A lawyer, an accountant, a doctor, an architect, a consultant, a designer.",
    newCode: "1027",
    rate: { individual: 0.10, other: 0.10 },
    threshold: { basis: "annual", aggregateMinor: 5_000_000 },
    noPanRate: 0.20,
    appliesFrom: "2025-04-01",
    source: "Threshold raised from ₹30,000 to ₹50,000 with effect from 1 April 2025 (secondary sources)",
    status: "unverified"
  },
  {
    id: "194J-technical",
    label: "Technical services",
    describes: "Technical work, a call centre, royalty on software.",
    newCode: "1026",
    rate: { individual: 0.02, other: 0.02 },
    threshold: { basis: "annual", aggregateMinor: 5_000_000 },
    noPanRate: 0.20,
    appliesFrom: "2025-04-01",
    source: "TDS rate charts for FY 2026-27 (secondary sources, April 2026)",
    status: "unverified"
  },
  {
    id: "194I-building",
    label: "Rent of premises",
    describes: "Rent for an office, a shop, a godown, furniture or fittings.",
    newCode: "1009",
    rate: { individual: 0.10, other: 0.10 },
    threshold: { basis: "monthly", aggregateMinor: 5_000_000 },
    noPanRate: 0.20,
    appliesFrom: "2025-04-01",
    source: "Monthly basis of ₹50,000 (some sources state it as ₹6,00,000 a year — worth confirming)",
    status: "unverified"
  },
  {
    id: "194I-equipment",
    label: "Rent of plant or machinery",
    describes: "Hired equipment, machinery, vehicles.",
    newCode: "1008",
    rate: { individual: 0.02, other: 0.02 },
    threshold: { basis: "monthly", aggregateMinor: 5_000_000 },
    noPanRate: 0.20,
    appliesFrom: "2025-04-01",
    source: "Monthly basis of ₹50,000 (some sources state it as ₹6,00,000 a year — worth confirming)",
    status: "unverified"
  },
  {
    id: "194H",
    label: "Commission or brokerage",
    describes: "A commission on a sale, an agent's cut, brokerage.",
    newCode: "1006",
    rate: { individual: 0.02, other: 0.02 },
    threshold: { basis: "annual", aggregateMinor: 2_000_000 },
    noPanRate: 0.20,
    appliesFrom: "2024-10-01",
    source: "Rate halved from 5% to 2% from October 2024; threshold raised to ₹20,000 (secondary sources)",
    status: "unverified"
  },
  {
    id: "194Q",
    label: "Purchase of goods",
    describes: "Buying goods, once your own turnover is past ₹10 crore.",
    rate: { individual: 0.001, other: 0.001 },
    threshold: { basis: "annual", aggregateMinor: 50 * CRORE / 10 },
    noPanRate: 0.05,
    appliesFrom: "2021-07-01",
    source: "Applies only where the buyer's turnover exceeded ₹10 crore last year (secondary sources)",
    status: "unverified"
  }
];

export const sectionById = (id: string): TdsSection | undefined => TDS_SECTIONS.find((s) => s.id === id);

/** The expense accounts that usually attract each section, so the screen can suggest one. */
export const SUGGESTED_FOR_ACCOUNT: Record<string, string> = {
  "6010": "194I-building",
  "6050": "194C",
  "6070": "194J-professional",
  "6080": "194C"
};

/**
 * The Indian financial year a date falls in, which is what the thresholds are measured over.
 * April to March, named for both years the way everybody writes it.
 */
export function financialYearOf(iso: string): { from: string; to: string; label: string } {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return {
    from: `${start}-04-01`,
    to: `${start + 1}-03-31`,
    label: `${start}-${String((start + 1) % 100).padStart(2, "0")}`
  };
}

/**
 * When the tax has to reach the government: the seventh of the month after it was deducted,
 * except for March, which gets until the end of April.
 */
export function depositBy(deductedOn: string): string {
  const [y, m] = deductedOn.split("-").map(Number);
  if (m === 3) return `${y}-04-30`;
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, "0")}-07`;
}

export interface Quarter { id: "Q1" | "Q2" | "Q3" | "Q4"; from: string; to: string; label: string; dueOn: string }

/** The quarter a deduction belongs to, and when its 26Q is due. */
export function quarterOf(iso: string): Quarter {
  const [y, m] = iso.split("-").map(Number);
  const fy = financialYearOf(iso);
  const start = Number(fy.from.slice(0, 4));
  const table: Array<{ id: Quarter["id"]; months: number[]; dueMonth: number; dueYearOffset: number; dueDay: number }> = [
    { id: "Q1", months: [4, 5, 6], dueMonth: 7, dueYearOffset: 0, dueDay: 31 },
    { id: "Q2", months: [7, 8, 9], dueMonth: 10, dueYearOffset: 0, dueDay: 31 },
    { id: "Q3", months: [10, 11, 12], dueMonth: 1, dueYearOffset: 1, dueDay: 31 },
    { id: "Q4", months: [1, 2, 3], dueMonth: 5, dueYearOffset: 1, dueDay: 31 }
  ];
  const row = table.find((q) => q.months.includes(m))!;
  const firstMonth = row.months[0];
  const lastMonth = row.months[row.months.length - 1];
  const yearOf = (month: number) => (month >= 4 ? start : start + 1);
  const lastDay = new Date(Date.UTC(yearOf(lastMonth), lastMonth, 0)).getUTCDate();

  return {
    id: row.id,
    from: `${yearOf(firstMonth)}-${String(firstMonth).padStart(2, "0")}-01`,
    to: `${yearOf(lastMonth)}-${String(lastMonth).padStart(2, "0")}-${lastDay}`,
    label: `${row.id} ${fy.label}`,
    dueOn: `${start + row.dueYearOffset}-${String(row.dueMonth).padStart(2, "0")}-${row.dueDay}`
  };
}

/** Everything in this file is read from commentary, so anything shown from it says so. */
export const TDS_CAVEAT =
  "These rates and limits are read from published rate charts rather than from the department's own notification, and the law changed section numbering in 2025. Confirm with whoever files your returns before you rely on a figure.";
