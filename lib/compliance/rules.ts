/**
 * Filing deadlines, as data rather than code.
 *
 * Same discipline as the tax rules: every obligation carries where it came from, the dates it
 * applies between and how far it has been verified. Deadlines move, exemptions apply, and a
 * calendar that silently goes stale is worse than no calendar, so each one is shown with its
 * source and a reminder to check it.
 */

export type Frequency = "monthly" | "quarterly" | "half-yearly" | "yearly";

/** What a business has to be signed up to before an obligation applies to it. */
export type Registration = "gst" | "vat" | "tds" | "payroll" | "income-tax" | "sales-tax" | "contractors" | "none";

export interface ObligationRule {
  id: string;
  jurisdiction: string;
  name: string;
  /** Said plainly, for someone who does not already know what the form is. */
  plain: string;
  frequency: Frequency;
  /** Day of the month it is due, counted from the end of the period it covers. */
  dueDay: number;
  /** Months after the period ends. 1 means the month after. */
  monthsAfterPeriod: number;
  requires: Registration;
  /** Only applies above or below a turnover, where that matters. */
  appliesWhen?: string;
  source: string;
  effectiveFrom: string;
  effectiveUntil?: string;
  status: "verified" | "published" | "draft";
  /** For a yearly obligation, the month the period ends in. */
  periodEndMonth?: number;
  /**
   * Due on fixed days of the year rather than a set time after each period, such as US estimated
   * tax (15 April, 15 June, 15 September, 15 January). "covers" names the period, with {year} for
   * the year the date falls in and {prev} for the year before.
   */
  dates?: Array<{ month: number; day: number; covers: string }>;
  /** A due date on a Saturday or Sunday moves to the Monday, as the IRS does. */
  nextBusinessDay?: boolean;
}

export const OBLIGATIONS: ObligationRule[] = [
  /* ---------- India ---------- */
  {
    id: "in-gstr1-monthly", jurisdiction: "IN", name: "GSTR-1",
    plain: "The details of everything you sold last month",
    frequency: "monthly", dueDay: 11, monthsAfterPeriod: 1, requires: "gst",
    appliesWhen: "Monthly filers, generally above the QRMP turnover limit",
    source: "GST portal, return filing dates", effectiveFrom: "2021-01-01", status: "published"
  },
  {
    id: "in-gstr3b-monthly", jurisdiction: "IN", name: "GSTR-3B",
    plain: "The summary return, and the month's tax payment",
    frequency: "monthly", dueDay: 20, monthsAfterPeriod: 1, requires: "gst",
    appliesWhen: "Monthly filers",
    source: "GST portal, return filing dates", effectiveFrom: "2021-01-01", status: "published"
  },
  {
    id: "in-gstr1-quarterly", jurisdiction: "IN", name: "GSTR-1 (QRMP)",
    plain: "Quarterly sales details, for smaller businesses on the QRMP scheme",
    frequency: "quarterly", dueDay: 13, monthsAfterPeriod: 1, requires: "gst",
    appliesWhen: "QRMP scheme, broadly turnover up to five crore",
    source: "GST portal, QRMP scheme", effectiveFrom: "2021-01-01", status: "published"
  },
  {
    id: "in-gstr3b-quarterly", jurisdiction: "IN", name: "GSTR-3B (QRMP)",
    plain: "Quarterly summary return and payment",
    frequency: "quarterly", dueDay: 22, monthsAfterPeriod: 1, requires: "gst",
    appliesWhen: "QRMP scheme. The date is 22nd or 24th depending on your state",
    source: "GST portal, QRMP scheme", effectiveFrom: "2021-01-01", status: "published"
  },
  {
    id: "in-tds-payment", jurisdiction: "IN", name: "TDS payment",
    plain: "Paying over the tax you deducted from suppliers or salaries",
    frequency: "monthly", dueDay: 7, monthsAfterPeriod: 1, requires: "tds",
    appliesWhen: "March has its own later date",
    source: "Income Tax Department, TDS due dates", effectiveFrom: "2020-04-01", status: "published"
  },
  {
    id: "in-tds-return", jurisdiction: "IN", name: "TDS return",
    plain: "The quarterly statement of tax deducted",
    frequency: "quarterly", dueDay: 31, monthsAfterPeriod: 1, requires: "tds",
    source: "Income Tax Department, TDS due dates", effectiveFrom: "2020-04-01", status: "published"
  },
  {
    id: "in-pf-esi", jurisdiction: "IN", name: "PF and ESI",
    plain: "Provident fund and employee insurance for last month's payroll",
    frequency: "monthly", dueDay: 15, monthsAfterPeriod: 1, requires: "payroll",
    source: "EPFO and ESIC", effectiveFrom: "2020-04-01", status: "published"
  },
  {
    id: "in-gstr9", jurisdiction: "IN", name: "GSTR-9",
    plain: "The annual GST return",
    frequency: "yearly", dueDay: 31, monthsAfterPeriod: 9, requires: "gst", periodEndMonth: 3,
    appliesWhen: "Generally required above the prescribed turnover",
    source: "GST portal, annual return", effectiveFrom: "2021-04-01", status: "published"
  },

  /* ---------- United Kingdom ---------- */
  {
    id: "gb-vat-return", jurisdiction: "GB", name: "VAT return",
    plain: "Your quarterly VAT return and payment",
    frequency: "quarterly", dueDay: 7, monthsAfterPeriod: 2, requires: "vat",
    appliesWhen: "One calendar month and seven days after the period ends",
    source: "HMRC, VAT return deadlines", effectiveFrom: "2019-04-01", status: "published"
  },

  /* ---------- United Arab Emirates ---------- */
  {
    id: "ae-vat-return", jurisdiction: "AE", name: "VAT return",
    plain: "Your VAT return and payment",
    frequency: "quarterly", dueDay: 28, monthsAfterPeriod: 1, requires: "vat",
    source: "Federal Tax Authority", effectiveFrom: "2018-01-01", status: "published"
  },

  /* ---------- Singapore ---------- */
  {
    id: "sg-gst-return", jurisdiction: "SG", name: "GST return",
    plain: "Your quarterly GST return and payment",
    frequency: "quarterly", dueDay: 30, monthsAfterPeriod: 1, requires: "gst",
    source: "IRAS, filing due dates", effectiveFrom: "2019-01-01", status: "published"
  },

  /* ---------- Australia ---------- */
  {
    id: "au-bas", jurisdiction: "AU", name: "Business activity statement",
    plain: "Your quarterly BAS and GST payment",
    frequency: "quarterly", dueDay: 28, monthsAfterPeriod: 1, requires: "gst",
    source: "Australian Taxation Office, BAS due dates", effectiveFrom: "2019-01-01", status: "published"
  },
  /* ---------- United States (federal) ---------- */
  {
    id: "us-estimated-tax", jurisdiction: "US", name: "Estimated tax (Form 1040-ES)",
    plain: "Your quarterly payment towards this year's income and self-employment tax",
    frequency: "yearly", dueDay: 15, monthsAfterPeriod: 0, requires: "income-tax",
    appliesWhen: "Owners who expect to owe $1,000 or more for the year. The four periods are not equal quarters.",
    dates: [
      { month: 4, day: 15, covers: "January to March {year}" },
      { month: 6, day: 15, covers: "April and May {year}" },
      { month: 9, day: 15, covers: "June to August {year}" },
      { month: 1, day: 15, covers: "September to December {prev}" }
    ],
    nextBusinessDay: true,
    source: "IRS, Form 1040-ES", effectiveFrom: "2000-01-01", status: "published"
  },
  {
    id: "us-1040", jurisdiction: "US", name: "Income tax return (Form 1040 with Schedule C)",
    plain: "The yearly return for a sole proprietor or single-member LLC, and any tax still owed",
    frequency: "yearly", dueDay: 15, monthsAfterPeriod: 0, requires: "income-tax",
    appliesWhen: "Sole proprietors and single-member LLCs. C corporations file Form 1120 on the same date.",
    dates: [{ month: 4, day: 15, covers: "Tax year {prev}" }], nextBusinessDay: true,
    source: "IRS, Form 1040 and Form 1120 instructions", effectiveFrom: "2000-01-01", status: "published"
  },
  {
    id: "us-1065-1120s", jurisdiction: "US", name: "Partnership or S corporation return (Form 1065 or 1120-S)",
    plain: "The business's yearly return, and a Schedule K-1 for each partner or shareholder",
    frequency: "yearly", dueDay: 15, monthsAfterPeriod: 0, requires: "income-tax",
    appliesWhen: "Partnerships, multi-member LLCs and S corporations on the calendar year",
    dates: [{ month: 3, day: 15, covers: "Tax year {prev}" }], nextBusinessDay: true,
    source: "IRS, Form 1065 and Form 1120-S instructions", effectiveFrom: "2000-01-01", status: "published"
  },
  {
    id: "us-1099-nec", jurisdiction: "US", name: "Form 1099-NEC",
    plain: "A form to each contractor you paid, and a copy to the IRS",
    frequency: "yearly", dueDay: 31, monthsAfterPeriod: 0, requires: "contractors",
    appliesWhen: "Anyone you paid $600 or more in 2025, or $2,000 or more from 2026 payments onwards",
    dates: [{ month: 1, day: 31, covers: "Payments in {prev}" }], nextBusinessDay: true,
    source: "IRS, Form 1099-NEC instructions; One Big Beautiful Bill Act threshold", effectiveFrom: "2020-01-01", status: "published"
  },
  {
    id: "us-941", jurisdiction: "US", name: "Form 941",
    plain: "Your quarterly payroll return: income tax withheld, Social Security and Medicare",
    frequency: "quarterly", dueDay: 31, monthsAfterPeriod: 1, requires: "payroll",
    appliesWhen: "Last day of the month after each quarter. The tax itself is usually deposited monthly or twice a week.",
    nextBusinessDay: true,
    source: "IRS, Form 941 instructions", effectiveFrom: "2000-01-01", status: "published"
  },
  {
    id: "us-w2-940", jurisdiction: "US", name: "W-2s and Form 940",
    plain: "A W-2 to each employee and the Social Security Administration, and the yearly federal unemployment tax return",
    frequency: "yearly", dueDay: 31, monthsAfterPeriod: 0, requires: "payroll",
    dates: [{ month: 1, day: 31, covers: "Wages paid in {prev}" }], nextBusinessDay: true,
    source: "IRS, Form W-2 and Form 940 instructions", effectiveFrom: "2000-01-01", status: "published"
  },
  {
    id: "us-sales-tax", jurisdiction: "US", name: "State sales tax return",
    plain: "The sales tax you collected, filed and paid to each state you are registered in",
    frequency: "monthly", dueDay: 20, monthsAfterPeriod: 1, requires: "sales-tax",
    appliesWhen: "Many states use the 20th of the month after, but each state sets its own date and may give you quarterly or yearly filing. Check the date on your permit.",
    nextBusinessDay: true,
    source: "State revenue departments", effectiveFrom: "2000-01-01", status: "draft"
  }
];

export const obligationsFor = (country: string, isoDate: string) =>
  OBLIGATIONS.filter((o) => o.jurisdiction === country.toUpperCase()
    && o.effectiveFrom <= isoDate && (!o.effectiveUntil || o.effectiveUntil > isoDate));
