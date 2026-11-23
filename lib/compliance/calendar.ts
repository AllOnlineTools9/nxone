import { obligationsFor, type Frequency, type ObligationRule, type Registration } from "./rules";

/**
 * Turning the rules into dates. Nobody should have to work out that the GSTR-3B for May is due on
 * the 20th of June, so the calendar does it from what the business is registered for.
 */

export interface Deadline {
  id: string;
  rule: ObligationRule;
  /** The period it covers, in words a person would use. */
  period: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  daysAway: number;
  state: "overdue" | "due-soon" | "upcoming";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The periods of a given frequency that end within the window we care about. */
function periodsEndingBetween(frequency: Frequency, fromIso: string, toIso: string, financialYearStart = 4) {
  const out: Array<{ start: string; end: string; label: string }> = [];
  const [fy, fm] = fromIso.split("-").map(Number);

  for (let i = -12; i <= 18; i++) {
    const anchor = new Date(Date.UTC(fy, fm - 1 + i, 1));
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth() + 1;

    if (frequency === "monthly") {
      out.push({ start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${lastDayOf(year, month)}`, label: `${MONTHS[month - 1]} ${year}` });
    } else if (frequency === "quarterly") {
      // quarters are counted from the financial year start, which is April in India
      const offset = (month - financialYearStart + 12) % 12;
      if (offset % 3 !== 2) continue;
      const startMonth = month - 2;
      const start = new Date(Date.UTC(year, startMonth - 1, 1));
      out.push({
        start: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-01`,
        end: `${year}-${pad(month)}-${lastDayOf(year, month)}`,
        label: `${MONTHS[start.getUTCMonth()]} to ${MONTHS[month - 1]} ${year}`
      });
    } else if (frequency === "yearly") {
      if (month !== ((financialYearStart + 11) % 12 || 12)) continue;
      out.push({
        start: `${year - 1}-${pad(financialYearStart)}-01`,
        end: `${year}-${pad(month)}-${lastDayOf(year, month)}`,
        label: `FY ${year - 1}-${String(year).slice(2)}`
      });
    }
  }

  return out.filter((p) => p.end >= fromIso && p.end <= toIso);
}

/** A Saturday or Sunday moves to the Monday after. Public holidays are not counted. */
function weekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function dueDateFor(rule: ObligationRule, periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + rule.monthsAfterPeriod, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  const day = Math.min(rule.dueDay, lastDayOf(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The calendar for a business. Registrations decide what applies: a business not deducting TDS
 * should never see a TDS deadline, since an irrelevant reminder trains people to ignore all of them.
 */
export function calendarFor(opts: {
  country: string;
  registrations: Registration[];
  today: string;
  /** How far back to show things already missed, and how far forward to look. */
  backDays?: number;
  aheadDays?: number;
  /** Whether the business files GST quarterly under QRMP. */
  quarterlyGst?: boolean;
}): Deadline[] {
  const { country, registrations, today, backDays = 60, aheadDays = 120, quarterlyGst = false } = opts;
  const from = shift(today, -backDays - 400);
  const to = shift(today, aheadDays);

  const rules = obligationsFor(country, today).filter((r) => {
    if (!registrations.includes(r.requires)) return false;
    if (country.toUpperCase() === "IN" && r.requires === "gst" && r.frequency !== "yearly") {
      return quarterlyGst ? r.id.endsWith("quarterly") : r.id.endsWith("monthly");
    }
    return true;
  });

  const deadlines: Deadline[] = [];

  const push = (rule: ObligationRule, label: string, start: string, end: string, due: string, key = end) => {
    const dueDate = rule.nextBusinessDay ? weekday(due) : due;
    const daysAway = daysBetween(today, dueDate);
    if (daysAway < -backDays || daysAway > aheadDays) return;
    deadlines.push({
      id: `${rule.id}:${key}`, rule, period: label, periodStart: start, periodEnd: end, dueDate, daysAway,
      state: daysAway < 0 ? "overdue" : daysAway <= 14 ? "due-soon" : "upcoming"
    });
  };

  for (const rule of rules) {
    // Fixed days of the year, such as US estimated tax.
    if (rule.dates?.length) {
      const year = Number(today.slice(0, 4));
      for (const y of [year - 1, year, year + 1]) {
        for (const d of rule.dates) {
          const due = `${y}-${pad(d.month)}-${pad(d.day)}`;
          const label = d.covers.replace("{year}", String(y)).replace("{prev}", String(y - 1));
          push(rule, label, due, due, due);
        }
      }
      continue;
    }
    for (const period of periodsEndingBetween(rule.frequency, from, to, country.toUpperCase() === "IN" ? 4 : 1)) {
      push(rule, period.label, period.start, period.end, dueDateFor(rule, period.end));
    }
  }

  return deadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The next thing due, which is all the dashboard needs. */
export const nextDeadline = (deadlines: Deadline[]) => deadlines.find((d) => d.daysAway >= 0);
