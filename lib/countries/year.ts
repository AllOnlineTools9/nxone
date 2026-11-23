import { packFor } from "./packs";

/** The month a business's tax year starts, from its country: April in India, January in the US. */
export const yearStartFor = (country: string | undefined | null): number => packFor(country ?? "IN").yearStartMonth ?? 4;

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The tax year a date falls in. A year starting in January is named for its one year ("2026");
 * one starting later is named for both, the way India writes "2026-27".
 */
export function taxYearOf(iso: string, startMonth = 4): { from: string; to: string; label: string } {
  const [y, m] = iso.split("-").map(Number);
  if (startMonth === 1) return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  const start = m >= startMonth ? y : y - 1;
  const endMonth = startMonth - 1;
  return {
    from: `${start}-${pad(startMonth)}-01`,
    to: `${start + 1}-${pad(endMonth)}-${pad(lastDay(start + 1, endMonth))}`,
    label: `${start}-${String((start + 1) % 100).padStart(2, "0")}`
  };
}

/** The first day of the tax year a label names, the reverse of taxYearOf. */
export const yearStartingLabel = (label: string, startMonth = 4): string => `${label.slice(0, 4)}-${pad(startMonth)}-01`;
