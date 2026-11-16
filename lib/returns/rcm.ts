/**
 * Reverse charge: the GST you owe on something you bought.
 *
 * Normally the seller collects the tax and hands it over. For certain supplies the law turns it
 * around: the buyer pays the tax to the government directly, and the supplier's bill carries no
 * GST at all. Freight, an advocate's fee, a director's sitting fee, a service bought from
 * abroad — all ordinary things for a small business.
 *
 * It catches people both ways at once, which is what makes it expensive. The tax is owed whether
 * or not anybody noticed, so missing it leaves an unpaid liability earning interest. And the
 * same amount is usually claimable back as credit, so missing it also means not claiming money
 * you were entitled to. One oversight, two losses.
 *
 * The categories below are read from published summaries rather than from the notifications
 * themselves, so none is marked published and every screen built on them says so.
 */

export interface RcmCategory {
  id: string;
  label: string;
  /** What it covers, in the words of somebody paying the bill. */
  describes: string;
  /** Whether the credit can normally be claimed back, which decides if it really costs anything. */
  creditable: boolean;
  /** Where the obligation comes from, as commonly cited. */
  basis: string;
  source: string;
  status: "published" | "unverified";
}

const SOURCE = "Published summaries of the reverse charge notifications under section 9(3) of the CGST Act (2026)";

export const RCM_CATEGORIES: RcmCategory[] = [
  {
    id: "gta",
    label: "Goods transport",
    describes: "A transporter's bill for moving goods, where they have not charged GST themselves.",
    creditable: true,
    basis: "Services of a goods transport agency",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "advocate",
    label: "Legal fees",
    describes: "An advocate or a firm of advocates. Not a company secretary or an accountant.",
    creditable: true,
    basis: "Legal services by an advocate",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "director",
    label: "Director's fees",
    describes: "Sitting fees or commission paid to a director who is not an employee.",
    creditable: true,
    basis: "Services by a director to the company",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "import-services",
    label: "Services bought from abroad",
    describes: "Software, advertising, consultancy or hosting billed from outside India.",
    creditable: true,
    basis: "Import of services",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "sponsorship",
    label: "Sponsorship",
    describes: "Sponsoring an event, a team or a programme.",
    creditable: true,
    basis: "Sponsorship services",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "vehicle-hire",
    label: "Hiring a vehicle with a driver",
    describes: "A car or bus hired with a driver from someone who does not charge GST.",
    creditable: false,
    basis: "Renting of a motor vehicle to a body corporate",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "security",
    label: "Security services",
    describes: "Security guards supplied by an agency that is not a company.",
    creditable: true,
    basis: "Security services to a registered person",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "government",
    label: "Services from a government body",
    describes: "A licence, a registration or a service billed by a government department.",
    creditable: true,
    basis: "Services supplied by central or state government",
    source: SOURCE,
    status: "unverified"
  },
  {
    id: "other",
    label: "Something else under reverse charge",
    describes: "Anything else your accountant has told you attracts reverse charge.",
    creditable: true,
    basis: "As advised",
    source: SOURCE,
    status: "unverified"
  }
];

export const rcmById = (id: string): RcmCategory | undefined => RCM_CATEGORIES.find((c) => c.id === id);

/** A bill under reverse charge, and what it means in money. */
export interface RcmLiability {
  expenseId: string;
  date: string;
  supplier: string;
  categoryId: string;
  label: string;
  /** The value of the supply, which is what the tax is worked out on. */
  taxableMinor: number;
  /** The tax owed to the government on this bill. */
  owedMinor: number;
  /** The same amount claimable back, when the credit is allowed. */
  claimableMinor: number;
  /** What it really costs: nothing when the credit can be claimed. */
  netCostMinor: number;
  creditable: boolean;
}

export interface RcmInput {
  id: string;
  date: string;
  supplier: string;
  netMinor: number;
  /** The reverse charge category, when the bill carries one. */
  rcmCategory?: string;
  /** The rate that would have applied had the supplier charged it. */
  rcmRate?: number;
}

/** A sensible default when nobody has said otherwise. Most services sit at eighteen per cent. */
export const DEFAULT_RCM_RATE = 0.18;

export function liabilitiesFor(expenses: RcmInput[], from: string, to: string): RcmLiability[] {
  return expenses
    .filter((e) => e.rcmCategory && e.date >= from && e.date <= to)
    .map((e) => {
      const category = rcmById(e.rcmCategory!);
      const rate = e.rcmRate ?? DEFAULT_RCM_RATE;
      const owed = Math.round(e.netMinor * rate);
      const creditable = category?.creditable ?? true;
      return {
        expenseId: e.id,
        date: e.date,
        supplier: e.supplier,
        categoryId: e.rcmCategory!,
        label: category?.label ?? "Reverse charge",
        taxableMinor: e.netMinor,
        owedMinor: owed,
        claimableMinor: creditable ? owed : 0,
        netCostMinor: creditable ? 0 : owed,
        creditable
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface RcmSummary {
  liabilities: RcmLiability[];
  /** 3.1(d) of the 3B: the value of inward supplies on which tax is payable by you. */
  taxableMinor: number;
  /** What has to be paid in cash: reverse charge cannot be settled with credit. */
  owedMinor: number;
  /** 4(A)(3) of the 3B: the credit that comes back. */
  claimableMinor: number;
  /** What it actually costs, once the credit is taken into account. */
  netCostMinor: number;
  notes: string[];
}

export function rcmSummary(expenses: RcmInput[], from: string, to: string): RcmSummary {
  const liabilities = liabilitiesFor(expenses, from, to);
  const owed = liabilities.reduce((sum, l) => sum + l.owedMinor, 0);
  const claimable = liabilities.reduce((sum, l) => sum + l.claimableMinor, 0);

  const notes: string[] = [];
  if (owed > 0) {
    notes.push("Reverse charge has to be paid in cash. It cannot be settled against the credit you hold, even when the same amount comes straight back as credit.");
  }
  const blocked = liabilities.filter((l) => !l.creditable);
  if (blocked.length > 0) {
    notes.push(`${blocked.length} of these ${blocked.length === 1 ? "is" : "are"} not claimable back, so the tax is a real cost rather than a wash.`);
  }

  return {
    liabilities,
    taxableMinor: liabilities.reduce((sum, l) => sum + l.taxableMinor, 0),
    owedMinor: owed,
    claimableMinor: claimable,
    netCostMinor: liabilities.reduce((sum, l) => sum + l.netCostMinor, 0),
    notes
  };
}

/**
 * Bills that look like they should have been marked and were not.
 *
 * Deliberately a suggestion rather than a rule: it reads the supplier's name and the account,
 * and both can be wrong. But a transport bill with no GST on it is worth a second look, because
 * the alternative is finding out at an assessment.
 */
export interface RcmSuspicion {
  expenseId: string;
  supplier: string;
  date: string;
  netMinor: number;
  suggests: string;
  says: string;
}

const HINTS: Array<{ match: RegExp; category: string }> = [
  { match: /transport|logistic|carrier|freight|courier|packers/i, category: "gta" },
  { match: /advocate|legal|law\b|counsel/i, category: "advocate" },
  { match: /security|guard/i, category: "security" },
  { match: /sponsor/i, category: "sponsorship" }
];

export function possiblyReverseCharge(
  expenses: Array<RcmInput & { taxMinor: number; supplierGstin?: string; description?: string }>
): RcmSuspicion[] {
  const out: RcmSuspicion[] = [];

  for (const expense of expenses) {
    if (expense.rcmCategory) continue;
    // A bill that already carries GST was charged by the supplier, so reverse charge does not arise.
    if (expense.taxMinor > 0) continue;

    const text = `${expense.supplier} ${expense.description ?? ""}`;
    const hint = HINTS.find((h) => h.match.test(text));
    if (!hint) continue;

    out.push({
      expenseId: expense.id,
      supplier: expense.supplier,
      date: expense.date,
      netMinor: expense.netMinor,
      suggests: hint.category,
      says: `${expense.supplier} looks like ${rcmById(hint.category)?.label.toLowerCase()}, and the bill carries no GST. That is usually reverse charge: you owe the tax yourself, and you can usually claim the same amount back. Left unmarked, you owe it anyway and claim nothing.`
    });
  }

  return out.sort((a, b) => b.netMinor - a.netMinor);
}

export const RCM_CAVEAT =
  "Which supplies attract reverse charge is read from published summaries rather than from the notifications themselves, and the list changes. Check with whoever files your returns before relying on a category here.";
