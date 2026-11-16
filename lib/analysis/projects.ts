import { calculate } from "../documents/totals";
import type { Expense, SavedDocument } from "../store/types";

/**
 * What each job actually made.
 *
 * A business that is profitable overall can be losing money on half of what it does, and the
 * profit and loss will never say so — it adds the good jobs to the bad ones and reports the
 * difference. The only way to know is to tag the income and the costs to the job they belong
 * to, which nobody does unless it takes two seconds.
 *
 * Revenue is counted from what was invoiced rather than what was paid, because a job's
 * profitability is about the work, not about how slowly the customer settles up. Whether the
 * money has arrived is a separate question, and shown separately.
 */

export interface Project {
  id: string;
  name: string;
  client?: string;
  startedOn?: string;
  /** What was agreed, when there is a fixed price to compare against. */
  quotedMinor?: number;
  status: "open" | "done" | "abandoned";
}

export interface ProjectResult {
  project: Project;
  /** Invoiced, excluding tax: the tax was never yours. */
  revenueMinor: number;
  /** What has actually been collected against those invoices. */
  collectedMinor: number;
  costMinor: number;
  profitMinor: number;
  /** Profit as a share of revenue. Zero revenue gives zero rather than infinity. */
  marginPercent: number;
  invoices: number;
  bills: number;
  /** Against a quoted price, how much of it has been invoiced. */
  quotedMinor?: number;
  overQuoteMinor?: number;
  says?: string;
}

const revenueOf = (document: SavedDocument): number => {
  try {
    // Tax collected on a sale was never income, so a project's revenue is the taxable amount.
    return calculate(document.doc).taxableTotal.minor;
  } catch {
    return document.totalMinor;
  }
};

/** Documents that represent money earned. A quotation is a hope, not revenue. */
const EARNS = new Set<SavedDocument["kind"]>(["invoice", "credit-note"]);

export function resultsFor(
  projects: Project[],
  documents: SavedDocument[],
  expenses: Expense[],
  money: (minor: number) => string
): ProjectResult[] {
  return projects.map((project) => {
    const theirs = documents.filter(
      (d) => d.projectId === project.id && !d.deletedAt && EARNS.has(d.kind) && d.status !== "draft" && d.status !== "cancelled"
    );
    const bills = expenses.filter((e) => e.projectId === project.id && !e.deletedAt);

    // A credit note reduces what the job earned, so it counts the other way.
    const revenueMinor = theirs.reduce((sum, d) => sum + revenueOf(d) * (d.kind === "credit-note" ? -1 : 1), 0);
    const collectedMinor = theirs.reduce((sum, d) => sum + d.paidMinor * (d.kind === "credit-note" ? -1 : 1), 0);
    const costMinor = bills.reduce((sum, e) => sum + e.netMinor, 0);
    const profitMinor = revenueMinor - costMinor;

    const overQuote = project.quotedMinor !== undefined ? revenueMinor - project.quotedMinor : undefined;

    return {
      project,
      revenueMinor,
      collectedMinor,
      costMinor,
      profitMinor,
      marginPercent: revenueMinor === 0 ? 0 : (profitMinor / revenueMinor) * 100,
      invoices: theirs.length,
      bills: bills.length,
      quotedMinor: project.quotedMinor,
      overQuoteMinor: overQuote,
      says: profitMinor < 0
        ? `This job has cost ${money(-profitMinor)} more than it earned. Worth knowing why before quoting the next one like it.`
        : revenueMinor > 0 && profitMinor / revenueMinor < 0.1
          ? "Barely above its costs. A job at this margin pays for itself and nothing else."
          : project.quotedMinor !== undefined && overQuote !== undefined && overQuote < -1
            ? `${money(-overQuote)} of the quoted price has not been invoiced yet.`
            : undefined
    };
  }).sort((a, b) => a.profitMinor - b.profitMinor);
}

export interface ProjectSummary {
  results: ProjectResult[];
  /** Jobs that lost money, worst first. */
  losing: ProjectResult[];
  revenueMinor: number;
  costMinor: number;
  profitMinor: number;
  /** Costs on no job at all: overheads, or tagging nobody kept up with. */
  untaggedCostMinor: number;
  untaggedRevenueMinor: number;
}

export function summarise(
  projects: Project[],
  documents: SavedDocument[],
  expenses: Expense[],
  money: (minor: number) => string
): ProjectSummary {
  const results = resultsFor(projects, documents, expenses, money);

  const untaggedCostMinor = expenses
    .filter((e) => !e.projectId && !e.deletedAt)
    .reduce((sum, e) => sum + e.netMinor, 0);

  const untaggedRevenueMinor = documents
    .filter((d) => !d.projectId && !d.deletedAt && EARNS.has(d.kind) && d.status !== "draft" && d.status !== "cancelled")
    .reduce((sum, d) => sum + revenueOf(d) * (d.kind === "credit-note" ? -1 : 1), 0);

  return {
    results,
    losing: results.filter((r) => r.profitMinor < 0),
    revenueMinor: results.reduce((sum, r) => sum + r.revenueMinor, 0),
    costMinor: results.reduce((sum, r) => sum + r.costMinor, 0),
    profitMinor: results.reduce((sum, r) => sum + r.profitMinor, 0),
    untaggedCostMinor,
    untaggedRevenueMinor
  };
}

/**
 * Projects a document or bill might belong to, given who it is for.
 *
 * Offered, never applied: tagging the wrong job is worse than tagging none, because the figures
 * then look right and are not.
 */
export function likelyProjects(projects: Project[], client?: string): Project[] {
  const open = projects.filter((p) => p.status === "open");
  if (!client?.trim()) return open;
  const name = client.trim().toLowerCase();
  const theirs = open.filter((p) => p.client?.trim().toLowerCase() === name);
  return theirs.length > 0 ? [...theirs, ...open.filter((p) => !theirs.includes(p))] : open;
}
