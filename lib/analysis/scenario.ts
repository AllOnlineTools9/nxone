/**
 * Trying a change before you make it.
 *
 * "What if I hire someone." "What if I lose my biggest customer." "What if I put prices up ten
 * per cent and a tenth of the orders go away."
 *
 * The engine takes a baseline month — sales, the costs that move with sales, the costs that do
 * not, and the cash in hand — and a list of changes, and reports what happens to profit, margin,
 * break-even and cash. It imports nothing, so the arithmetic can be read and tested on its own.
 * Where the arithmetic cannot answer honestly it says so instead of printing a number.
 *
 * Money is integer minor units, as everywhere else.
 */

/* ------------------------------------------------------------------ inputs */

export interface Baseline {
  currency: string;
  /** Sales in a typical month. */
  monthlyIncomeMinor: number;
  /** Costs that move with sales: stock, materials, delivery, payment fees. */
  monthlyVariableCostMinor: number;
  /** Costs that do not move with sales: rent, salaries, subscriptions. */
  monthlyFixedCostMinor: number;
  /** Money in hand today. */
  cashMinor: number;
  /** Invoiced and not yet paid. Explains cash; never counted as cash. */
  receivablesMinor?: number;
  /** Bills owed and not yet paid. */
  payablesMinor?: number;
  /** The owner's floor: cash below this is tight. */
  minimumCashMinor?: number;
}

export type Change =
  /** Someone joins the payroll. A standing cost, from a chosen month onwards. */
  | { kind: "hire"; label?: string; monthlyCostMinor: number; startsInMonths?: number }
  /** Someone leaves. */
  | { kind: "let-go"; label?: string; monthlyCostMinor: number; startsInMonths?: number }
  /** A customer stops buying. */
  | { kind: "lose-customer"; label?: string; monthlyIncomeMinor: number; startsInMonths?: number }
  /** A customer starts buying. */
  | { kind: "win-customer"; label?: string; monthlyIncomeMinor: number; startsInMonths?: number }
  /**
   * Prices move by `percent`. Volume may react: `volumePercent` is the change in how much you
   * sell as a result, negative if raising prices costs you orders.
   */
  | { kind: "price-change"; label?: string; percent: number; volumePercent?: number }
  /** You sell more or less of the same thing at the same price. */
  | { kind: "volume-change"; label?: string; percent: number }
  /** Suppliers, materials or fees move by `percent`. */
  | { kind: "cost-change"; label?: string; percent: number }
  /** A new or changed standing cost: rent, a subscription, insurance. */
  | { kind: "fixed-cost"; label?: string; monthlyCostMinor: number; startsInMonths?: number }
  /** A single payment or receipt: equipment, a deposit, a tax bill. */
  | { kind: "one-off"; label?: string; amountMinor: number; inMonths?: number };

export type ChangeKind = Change["kind"];

export interface Scenario {
  name: string;
  changes: Change[];
  /** Months to project. Default 12. */
  horizonMonths?: number;
}

/* ----------------------------------------------------------------- outputs */

export interface ScenarioCashPoint {
  /** 1 is the month after this one. */
  month: number;
  cashMinor: number;
  profitMinor: number;
}

export interface Outcome {
  currency: string;
  monthlyIncomeMinor: number;
  monthlyVariableCostMinor: number;
  monthlyFixedCostMinor: number;
  monthlyCostMinor: number;
  monthlyProfitMinor: number;
  /** Profit as a share of sales, one decimal. Null when there are no sales. */
  marginPercent: number | null;
  /** Of every hundred in sales, what is left once the costs that move with sales are paid. */
  contributionPercent: number | null;
  /** Sales needed to cover the standing costs. Null when the contribution is nil or negative. */
  breakEvenIncomeMinor: number | null;
  /** Whole months before the cash runs out. Null when the month makes a profit. */
  runwayMonths: number | null;
  cash: ScenarioCashPoint[];
  lowestCashMinor: number;
  lowestCashMonth: number;
  cashAtHorizonMinor: number;
  /** The first month cash sits below the owner's floor, if it does. */
  tightFromMonth: number | null;
}

export interface Simulation {
  name: string;
  currency: string;
  horizonMonths: number;
  before: Outcome;
  after: Outcome;
  delta: {
    monthlyIncomeMinor: number;
    monthlyCostMinor: number;
    monthlyProfitMinor: number;
    /** Percentage points, one decimal. Null when either side has no sales. */
    marginPoints: number | null;
    breakEvenIncomeMinor: number | null;
    cashAtHorizonMinor: number;
  };
  /** Plain sentences, in the order they matter. */
  lines: string[];
  headline: string;
  /** False when the change turns a profit into a loss, or takes cash below the floor. */
  safe: boolean;
  /** Anything the arithmetic could not settle. */
  unanswered: string[];
}

/* ------------------------------------------------------------------- maths */

const round = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 10) / 10;

export function describeChange(change: Change): string {
  const named = change.label ? ` (${change.label})` : "";
  switch (change.kind) {
    case "hire": return `Hire someone${named}`;
    case "let-go": return `One fewer person${named}`;
    case "lose-customer": return `Lose a customer${named}`;
    case "win-customer": return `Win a customer${named}`;
    case "price-change": return `Prices ${change.percent >= 0 ? "up" : "down"} ${Math.abs(change.percent)}%${named}`;
    case "volume-change": return `Sell ${change.percent >= 0 ? "more" : "less"} by ${Math.abs(change.percent)}%${named}`;
    case "cost-change": return `Costs ${change.percent >= 0 ? "up" : "down"} ${Math.abs(change.percent)}%${named}`;
    case "fixed-cost": return `New standing cost${named}`;
    case "one-off": return `One-off ${change.amountMinor >= 0 ? "payment" : "receipt"}${named}`;
  }
}

const startMonth = (change: Change): number => {
  const raw = "startsInMonths" in change ? change.startsInMonths : change.kind === "one-off" ? change.inMonths : 0;
  return Math.max(0, Math.floor(raw ?? 0));
};

const RATE_KINDS = new Set<ChangeKind>(["price-change", "volume-change", "cost-change"]);

/**
 * The shape of one month with the changes applied. Changes that begin later apply only from their
 * own month onwards, so the first months of a staged hire look different from the last.
 *
 * Amounts are applied before percentages whatever order they were entered in, so that a price rise
 * lifts what the remaining customers pay. Entering the same changes in another order cannot change
 * the answer.
 */
function monthShape(baseline: Baseline, changes: Change[], month: number) {
  let income = baseline.monthlyIncomeMinor;
  let variable = baseline.monthlyVariableCostMinor;
  let fixed = baseline.monthlyFixedCostMinor;
  let oneOff = 0;

  // What proportion of a sale goes on stock, held steady as volume moves.
  const variableRate = income > 0 ? variable / income : 0;

  const ordered = [...changes.filter((c) => !RATE_KINDS.has(c.kind)), ...changes.filter((c) => RATE_KINDS.has(c.kind))];

  for (const change of ordered) {
    if (startMonth(change) > month) continue;
    switch (change.kind) {
      case "hire":
      case "fixed-cost":
        fixed += change.monthlyCostMinor;
        break;
      case "let-go":
        fixed -= change.monthlyCostMinor;
        break;
      case "lose-customer":
        income -= change.monthlyIncomeMinor;
        variable -= round(change.monthlyIncomeMinor * variableRate);
        break;
      case "win-customer":
        income += change.monthlyIncomeMinor;
        variable += round(change.monthlyIncomeMinor * variableRate);
        break;
      case "price-change": {
        // Volume reacts first, because it changes what you buy; the new price then applies to
        // what is left.
        const volume = 1 + (change.volumePercent ?? 0) / 100;
        income = round(income * volume * (1 + change.percent / 100));
        variable = round(variable * volume);
        break;
      }
      case "volume-change": {
        const volume = 1 + change.percent / 100;
        income = round(income * volume);
        variable = round(variable * volume);
        break;
      }
      case "cost-change":
        variable = round(variable * (1 + change.percent / 100));
        break;
      case "one-off":
        if (startMonth(change) === month) oneOff += change.amountMinor;
        break;
    }
  }

  return { income: round(income), variable: round(variable), fixed: round(fixed), oneOff: round(oneOff) };
}

function outcomeOf(baseline: Baseline, changes: Change[], horizonMonths: number): Outcome {
  // The settled month: every change in force, no one-offs.
  const settled = monthShape(baseline, changes, horizonMonths);
  const cost = settled.variable + settled.fixed;
  const profit = settled.income - cost;

  const contribution = settled.income - settled.variable;
  const contributionPercent = settled.income > 0 ? pct((contribution / settled.income) * 100) : null;
  const breakEven = contribution > 0 ? round((settled.fixed / contribution) * settled.income) : null;

  const cash: ScenarioCashPoint[] = [];
  let running = baseline.cashMinor;
  let lowest = baseline.cashMinor;
  let lowestMonth = 0;
  const floor = baseline.minimumCashMinor ?? 0;
  let tightFrom: number | null = baseline.cashMinor < floor ? 0 : null;

  for (let month = 1; month <= horizonMonths; month += 1) {
    const shape = monthShape(baseline, changes, month);
    const monthProfit = shape.income - shape.variable - shape.fixed;
    running += monthProfit - shape.oneOff;
    cash.push({ month, cashMinor: running, profitMinor: monthProfit });
    if (running < lowest) { lowest = running; lowestMonth = month; }
    if (tightFrom === null && running < floor) tightFrom = month;
  }

  let runway: number | null = null;
  if (profit < 0) runway = baseline.cashMinor <= 0 ? 0 : Math.floor(baseline.cashMinor / -profit);

  return {
    currency: baseline.currency,
    monthlyIncomeMinor: settled.income,
    monthlyVariableCostMinor: settled.variable,
    monthlyFixedCostMinor: settled.fixed,
    monthlyCostMinor: cost,
    monthlyProfitMinor: profit,
    marginPercent: settled.income > 0 ? pct((profit / settled.income) * 100) : null,
    contributionPercent,
    breakEvenIncomeMinor: breakEven,
    runwayMonths: runway,
    cash,
    lowestCashMinor: lowest,
    lowestCashMonth: lowestMonth,
    cashAtHorizonMinor: cash.length ? cash[cash.length - 1].cashMinor : baseline.cashMinor,
    tightFromMonth: tightFrom
  };
}

/* --------------------------------------------------------------- the words */

/** How the caller turns minor units into something readable. */
export type Formatter = (minor: number, currency: string) => string;

/** Used when no formatter is passed, so the engine stands alone in tests. */
const plainMoney: Formatter = (minor, currency) =>
  `${currency} ${(minor / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthWord = (n: number) => (n === 1 ? "1 month" : `${n} months`);

function sentences(before: Outcome, after: Outcome, baseline: Baseline, changes: Change[], horizonMonths: number, money: Formatter) {
  const m = (minor: number) => money(Math.abs(minor), baseline.currency);
  const lines: string[] = [];
  const unanswered: string[] = [];

  const profitShift = after.monthlyProfitMinor - before.monthlyProfitMinor;

  /* ---- changes that cannot bite, which look like a working answer but are not ---- */
  if (changes.some((c) => c.kind === "cost-change") && baseline.monthlyVariableCostMinor === 0) {
    unanswered.push("Nothing moves when supplier costs change, because none of your costs are recorded as moving with sales. If stock or materials sit in your standing costs, move them across in the figures above.");
  }
  if (changes.some((c) => c.kind === "price-change" || c.kind === "volume-change") && baseline.monthlyIncomeMinor === 0) {
    unanswered.push("Nothing moves when prices or volumes change, because there are no sales in the figures above to apply them to.");
  }

  /* ---- profit ---- */
  if (profitShift === 0) {
    lines.push("Your monthly profit would not move.");
  } else {
    const nowWord = after.monthlyProfitMinor < 0 ? `a loss of ${m(after.monthlyProfitMinor)}` : `a profit of ${m(after.monthlyProfitMinor)}`;
    const wasWord = before.monthlyProfitMinor < 0 ? `a loss of ${m(before.monthlyProfitMinor)}` : m(before.monthlyProfitMinor);
    lines.push(`You would ${profitShift > 0 ? "make" : "keep"} ${m(profitShift)} ${profitShift > 0 ? "more" : "less"} a month — ${nowWord} instead of ${wasWord}.`);
  }

  /* ---- margin ---- */
  if (before.marginPercent !== null && after.marginPercent !== null) {
    const points = pct(after.marginPercent - before.marginPercent);
    if (points !== 0) lines.push(`Your margin would go ${points > 0 ? "up" : "down"} from ${before.marginPercent}% to ${after.marginPercent}%.`);
  } else if (after.marginPercent === null) {
    unanswered.push("Margin cannot be worked out with no sales in the month.");
  }

  /* ---- break-even ---- */
  if (after.breakEvenIncomeMinor === null) {
    unanswered.push("Break-even cannot be worked out: the costs that move with sales would take the whole of a sale, so selling more would not help. Look at your prices or at what each sale costs you.");
  } else if (before.breakEvenIncomeMinor !== null) {
    const shift = after.breakEvenIncomeMinor - before.breakEvenIncomeMinor;
    if (shift !== 0) {
      lines.push(`You would need ${m(after.breakEvenIncomeMinor)} of sales a month to cover your costs, ${shift > 0 ? "up" : "down"} from ${m(before.breakEvenIncomeMinor)}.`);
    }
    if (after.monthlyIncomeMinor < after.breakEvenIncomeMinor) {
      // Said in full rather than as "that is x more", because the line above it is only there
      // when break-even moved, and this one has to stand on its own.
      lines.push(`Your sales would be ${m(after.breakEvenIncomeMinor - after.monthlyIncomeMinor)} a month short of covering your costs.`);
    }
  }

  /* ---- cash ---- */
  const cashShift = after.cashAtHorizonMinor - before.cashAtHorizonMinor;
  if (after.cash.length) {
    const compared = cashShift === 0 ? "the same as if nothing changed" : `${m(cashShift)} ${cashShift > 0 ? "more" : "less"} than if nothing changed`;
    lines.push(`In ${monthWord(horizonMonths)} you would have ${m(after.cashAtHorizonMinor)}${after.cashAtHorizonMinor < 0 ? " short" : ""} in hand — ${compared}.`);
  }

  const floor = baseline.minimumCashMinor ?? 0;
  if (after.tightFromMonth !== null && after.tightFromMonth > 0 && before.tightFromMonth === null) {
    lines.push(floor > 0
      ? `Cash would drop below your ${m(floor)} floor in month ${after.tightFromMonth}.`
      : `You would run out of cash in month ${after.tightFromMonth}.`);
  }

  if (after.runwayMonths !== null) {
    lines.push(after.runwayMonths === 0
      ? "You would be losing money every month with nothing in reserve."
      : `Losing money at that rate, the cash you hold lasts ${monthWord(after.runwayMonths)}.`);
  }

  if ((baseline.receivablesMinor ?? 0) > 0) {
    lines.push(`This assumes the ${m(baseline.receivablesMinor ?? 0)} already invoiced comes in. It is not counted as cash until it does.`);
  }

  const turnsLoss = before.monthlyProfitMinor >= 0 && after.monthlyProfitMinor < 0;
  const goesTight = after.tightFromMonth !== null && before.tightFromMonth === null;

  const headline = turnsLoss
    ? `This would put you into a loss of ${m(after.monthlyProfitMinor)} a month.`
    : goesTight
      ? `You could afford this on paper, but cash gets tight in month ${after.tightFromMonth}.`
      : profitShift > 0
        ? `This would leave you ${m(profitShift)} a month better off.`
        : profitShift < 0
          ? `You can afford this: ${m(profitShift)} a month less, still a profit of ${m(after.monthlyProfitMinor)}.`
          : "This would leave you where you are.";

  return { lines, headline, safe: !turnsLoss && !goesTight, unanswered };
}

/* ------------------------------------------------------------------- entry */

export function simulate(baseline: Baseline, scenario: Scenario, money: Formatter = plainMoney): Simulation {
  const horizonMonths = Math.max(1, Math.floor(scenario.horizonMonths ?? 12));
  const before = outcomeOf(baseline, [], horizonMonths);
  const after = outcomeOf(baseline, scenario.changes, horizonMonths);
  const words = sentences(before, after, baseline, scenario.changes, horizonMonths, money);

  return {
    name: scenario.name,
    currency: baseline.currency,
    horizonMonths,
    before,
    after,
    delta: {
      monthlyIncomeMinor: after.monthlyIncomeMinor - before.monthlyIncomeMinor,
      monthlyCostMinor: after.monthlyCostMinor - before.monthlyCostMinor,
      monthlyProfitMinor: after.monthlyProfitMinor - before.monthlyProfitMinor,
      marginPoints: before.marginPercent !== null && after.marginPercent !== null ? pct(after.marginPercent - before.marginPercent) : null,
      breakEvenIncomeMinor: before.breakEvenIncomeMinor !== null && after.breakEvenIncomeMinor !== null
        ? after.breakEvenIncomeMinor - before.breakEvenIncomeMinor
        : null,
      cashAtHorizonMinor: after.cashAtHorizonMinor - before.cashAtHorizonMinor
    },
    ...words
  };
}

/**
 * The most you could add to your standing costs each month and still keep a profit and stay above
 * your cash floor. This is what answers "so what can I afford?" once a scenario has said no.
 */
export function affordableFixedCostMinor(baseline: Baseline, horizonMonths = 12): number {
  const months = Math.max(1, Math.floor(horizonMonths));
  const profit = outcomeOf(baseline, [], months).monthlyProfitMinor;
  if (profit <= 0) return 0;
  const floor = baseline.minimumCashMinor ?? 0;
  // Adding x a month leaves a profit of (profit - x), so x cannot exceed the profit; and cash at
  // the end of the horizon, cash + months × (profit - x), must stay at or above the floor.
  return Math.max(0, round(Math.min(profit, profit + (baseline.cashMinor - floor) / months)));
}

/**
 * A figure a person would actually say out loud. Nobody asks "what if I hire someone at
 * 29,786.67 a month", so the suggestions are rounded to two meaningful digits. It works in any
 * currency because it rounds by size rather than to a fixed step.
 */
export function tidy(minor: number): number {
  if (!minor) return 0;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(minor))) - 1);
  return Math.round(minor / magnitude) * magnitude;
}

/** The ready-made questions, sized against the owner's own figures. */
export function presetsFor(
  baseline: Baseline,
  /** The customer the books say is the biggest, when there is one. */
  biggestCustomer?: { name: string; monthlyMinor: number; sharePercent: number }
): Array<{ name: string; changes: Change[] }> {
  // A salary the business would plausibly be weighing: against what it already pays out, or
  // against what it sells, whichever says more.
  const salary = tidy(Math.max(round(baseline.monthlyFixedCostMinor * 0.4), round(baseline.monthlyIncomeMinor * 0.15)));
  const lose: Change = biggestCustomer
    ? { kind: "lose-customer", monthlyIncomeMinor: biggestCustomer.monthlyMinor, label: `${biggestCustomer.sharePercent}% of your sales` }
    : { kind: "lose-customer", monthlyIncomeMinor: tidy(round(baseline.monthlyIncomeMinor * 0.3)), label: "about 30% of sales" };

  const sells = baseline.monthlyIncomeMinor > 0;

  // A question that cannot move anything is not worth offering: a shop with nothing recorded as
  // moving with sales gets no supplier question, because the answer would always be "no change".
  return [
    { name: "Hire someone", changes: [{ kind: "hire", monthlyCostMinor: salary, startsInMonths: 1 }] as Change[], when: true },
    { name: biggestCustomer ? `Lose ${biggestCustomer.name}` : "Lose your biggest customer", changes: [lose], when: sells },
    { name: "Raise prices 10%", changes: [{ kind: "price-change", percent: 10, volumePercent: -5 }] as Change[], when: sells },
    { name: "Suppliers raise prices 15%", changes: [{ kind: "cost-change", percent: 15 }] as Change[], when: baseline.monthlyVariableCostMinor > 0 },
    { name: "Sell a quarter more", changes: [{ kind: "volume-change", percent: 25 }] as Change[], when: sells }
  ].filter((p) => p.when).map(({ name, changes }) => ({ name, changes }));
}
