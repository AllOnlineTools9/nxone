import { classById, type AssetClass, type Method } from "./rates";
import { financialYearOf } from "../tds/sections";

/**
 * Wearing things down, year by year.
 *
 * Two calculations that deliberately disagree: the books spread a cost over the life of the
 * thing, and the tax computation writes down a pool at a fixed rate. Both start from the same
 * purchase, so both are derived here from the same record rather than kept as two sets of
 * figures that can drift apart.
 */

export interface AssetInput {
  id: string;
  name: string;
  classId: string;
  purchasedOn: string;
  costMinor: number;
  /** What it is expected to be worth at the end of its life. Usually nothing. */
  salvageMinor?: number;
  /** Overrides the class default when an accountant says otherwise. */
  method?: Method;
  usefulLifeYears?: number;
  disposedOn?: string;
  /** What it was sold for. Zero when it was scrapped. */
  disposalMinor?: number;
}

export interface YearOfLife {
  /** The financial year, as 2026-27. */
  year: string;
  from: string;
  to: string;
  openingMinor: number;
  depreciationMinor: number;
  closingMinor: number;
  /** True in the year it was bought if it was owned for less than the whole year. */
  partYear: boolean;
}

const lastDayOfFy = (iso: string) => financialYearOf(iso).to;

/** Days the asset was owned inside a financial year, which is what a part year is worked out from. */
function daysOwned(from: string, to: string, purchasedOn: string, disposedOn?: string): number {
  const start = purchasedOn > from ? purchasedOn : from;
  const end = disposedOn && disposedOn < to ? disposedOn : to;
  if (end < start) return 0;
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

const daysInYear = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/**
 * The books view: what the thing costs the business each year it is used.
 *
 * Pro-rated by days in the year it is bought and the year it goes, because a laptop bought in
 * March has not cost you a year's wear by the 31st. Stops at the salvage value - depreciation
 * that takes an asset below what it is worth is not depreciation, it is a mistake.
 */
export function booksSchedule(asset: AssetInput, upTo: string): YearOfLife[] {
  const assetClass = classById(asset.classId);
  const life = asset.usefulLifeYears ?? assetClass?.usefulLifeYears ?? 5;
  const method = asset.method ?? assetClass?.booksMethod ?? "straight-line";
  const salvage = asset.salvageMinor ?? 0;
  const depreciable = Math.max(0, asset.costMinor - salvage);

  const out: YearOfLife[] = [];
  let carrying = asset.costMinor;
  let year = financialYearOf(asset.purchasedOn);
  const end = asset.disposedOn && asset.disposedOn < upTo ? asset.disposedOn : upTo;

  // A written-down rate that wears the asset to its salvage value across its life.
  const wdvRate = salvage > 0 && asset.costMinor > 0
    ? 1 - Math.pow(salvage / asset.costMinor, 1 / life)
    : 1 - Math.pow(0.05, 1 / life); // nothing left at the end: the convention is 5% residual

  let guard = 0;
  while (year.from <= end && guard++ < 100) {
    // Once there is nothing left to write off, the schedule ends. Carrying on would list years
    // of zero depreciation, which reads as though the asset is still costing something.
    if (carrying - salvage <= 0) break;

    const owned = daysOwned(year.from, year.to, asset.purchasedOn, asset.disposedOn);
    const whole = daysInYear(year.from, year.to);
    const share = owned / whole;

    const full = method === "straight-line" ? depreciable / life : carrying * wdvRate;
    const room = Math.max(0, carrying - salvage);
    const charge = Math.min(Math.round(full * share), room);

    out.push({
      year: year.label,
      from: year.from,
      to: year.to,
      openingMinor: carrying,
      depreciationMinor: charge,
      closingMinor: carrying - charge,
      partYear: share < 1
    });

    carrying -= charge;
    if (asset.disposedOn && asset.disposedOn <= year.to) break;
    year = financialYearOf(`${Number(year.to.slice(0, 4))}-04-02`);
  }

  return out;
}

/** What the books say it is worth on a given day. */
export function carryingValue(asset: AssetInput, on: string): number {
  const schedule = booksSchedule(asset, on);
  return schedule.length === 0 ? asset.costMinor : schedule[schedule.length - 1].closingMinor;
}

/* ------------------------------------------------------------ the tax computation */

export interface BlockYear {
  block: string;
  rate: number;
  year: string;
  openingMinor: number;
  additionsFullRateMinor: number;
  /** Bought late in the year, so only half the rate is allowed. */
  additionsHalfRateMinor: number;
  disposalsMinor: number;
  depreciationMinor: number;
  closingMinor: number;
}

/** The dividing line: owned for less than 180 days in the year it was bought gets half the rate. */
export const HALF_RATE_DAYS = 180;

/**
 * The tax view: assets pooled into blocks, each written down at its own rate.
 *
 * Two rules do most of the work and are both commonly missed. An asset put to use for under
 * 180 days in the year it was bought gets half the year's rate - not half a year's, half the
 * rate. And a sale does not produce a gain or loss at all: the proceeds simply come off the
 * block, and only a block emptied or driven negative is settled up.
 */
export function blockSchedule(assets: AssetInput[], years: string[], openings: Record<string, number> = {}): BlockYear[] {
  const byBlock = new Map<string, { rate: number; assets: AssetInput[] }>();
  for (const asset of assets) {
    const assetClass = classById(asset.classId);
    if (!assetClass) continue;
    const entry = byBlock.get(assetClass.taxBlock) ?? { rate: assetClass.taxRate, assets: [] };
    entry.assets.push(asset);
    byBlock.set(assetClass.taxBlock, entry);
  }

  const out: BlockYear[] = [];
  for (const [block, { rate, assets: inBlock }] of byBlock) {
    let opening = openings[block] ?? 0;

    for (const label of years) {
      const sample = inBlock.find((a) => financialYearOf(a.purchasedOn).label === label) ?? inBlock[0];
      const fy = sample ? financialYearOf(sample.purchasedOn) : undefined;
      const from = fy?.label === label ? fy.from : yearFromLabel(label);
      const to = lastDayOfFy(from);

      let full = 0;
      let half = 0;
      for (const asset of inBlock.filter((a) => a.purchasedOn >= from && a.purchasedOn <= to)) {
        const days = daysOwned(from, to, asset.purchasedOn);
        if (days >= HALF_RATE_DAYS) full += asset.costMinor;
        else half += asset.costMinor;
      }

      const disposals = inBlock
        .filter((a) => a.disposedOn && a.disposedOn >= from && a.disposedOn <= to)
        .reduce((sum, a) => sum + (a.disposalMinor ?? 0), 0);

      // The proceeds come off the whole block before anything is written down.
      const base = Math.max(0, opening + full + half - disposals);
      const halfShare = base === 0 ? 0 : Math.min(half, base);
      const fullShare = Math.max(0, base - halfShare);
      const depreciation = Math.round(fullShare * rate + halfShare * rate / 2);
      const closing = base - depreciation;

      out.push({
        block, rate, year: label, openingMinor: opening,
        additionsFullRateMinor: full, additionsHalfRateMinor: half,
        disposalsMinor: disposals, depreciationMinor: depreciation, closingMinor: closing
      });

      opening = closing;
    }
  }

  return out;
}

/** 2026-27 back to the first day of that year. */
function yearFromLabel(label: string): string {
  return `${label.slice(0, 4)}-04-01`;
}

/* ----------------------------------------------------------------------- disposal */

export interface Disposal {
  assetId: string;
  name: string;
  on: string;
  proceedsMinor: number;
  carryingMinor: number;
  /** Positive is a gain in the books, negative a loss. The tax answer is not this one. */
  resultMinor: number;
  describes: string;
}

/**
 * Selling something. The books compare the price to what it was worth on the day; the tax
 * computation does not look at this transaction at all, which is worth saying out loud because
 * the two answers differ and somebody will ask why.
 */
export function disposalOf(asset: AssetInput, money: (minor: number) => string): Disposal | undefined {
  if (!asset.disposedOn) return undefined;
  const carrying = carryingValue({ ...asset, disposedOn: undefined }, asset.disposedOn);
  const proceeds = asset.disposalMinor ?? 0;
  const result = proceeds - carrying;

  return {
    assetId: asset.id,
    name: asset.name,
    on: asset.disposedOn,
    proceedsMinor: proceeds,
    carryingMinor: carrying,
    resultMinor: result,
    describes: result === 0
      ? `Sold for exactly what the books said it was worth, ${money(carrying)}.`
      : result > 0
        ? `Sold for ${money(proceeds)}, which is ${money(result)} more than the books said it was worth. That difference is a gain in your profit and loss. For tax it is not a gain at all - the ${money(proceeds)} simply comes off the block.`
        : `Sold for ${money(proceeds)}, which is ${money(-result)} less than the books said it was worth. That difference is a loss in your profit and loss. For tax it is not a loss - the ${money(proceeds)} simply comes off the block.`
  };
}

/* ------------------------------------------------------------------ into the books */

export interface DepreciationEntry {
  id: string;
  date: string;
  narration: string;
  assetId: string;
  amountMinor: number;
}

/**
 * One depreciation entry per asset per completed year. Dated the last day of the year, which is
 * when an accountant books it, and never for a year that has not finished - depreciating a year
 * that is still running would make this month's profit depend on a guess about next March.
 */
export function depreciationEntries(assets: AssetInput[], today: string): DepreciationEntry[] {
  const out: DepreciationEntry[] = [];
  for (const asset of assets) {
    for (const year of booksSchedule(asset, today)) {
      if (year.to >= today) continue;
      if (year.depreciationMinor <= 0) continue;
      out.push({
        id: `dep_${asset.id}_${year.year}`,
        date: year.to,
        narration: `Depreciation on ${asset.name} for ${year.year}`,
        assetId: asset.id,
        amountMinor: year.depreciationMinor
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Everything owned, as at a date, for the balance sheet and the register. */
export function registerAt(assets: AssetInput[], on: string): Array<{
  asset: AssetInput;
  assetClass?: AssetClass;
  costMinor: number;
  depreciatedMinor: number;
  carryingMinor: number;
  gone: boolean;
}> {
  return assets.map((asset) => {
    const carrying = carryingValue(asset, on);
    return {
      asset,
      assetClass: classById(asset.classId),
      costMinor: asset.costMinor,
      depreciatedMinor: asset.costMinor - carrying,
      carryingMinor: carrying,
      gone: Boolean(asset.disposedOn && asset.disposedOn <= on)
    };
  });
}
