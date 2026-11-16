/**
 * A record of what changed.
 *
 * Books that can be edited silently are books nobody can rely on. The question an audit trail
 * answers is not "who is to blame" — on a single device the answer is always "you" — it is "what
 * did this invoice say before somebody changed it", which comes up every time a figure is
 * queried months later and nobody can remember.
 *
 * Deliberately small: what changed, when, and the fields that moved. Not a full copy of every
 * version, which on a device with finite storage would quietly eat the space the books need.
 */

export type AuditAction = "created" | "changed" | "deleted" | "status";

export interface AuditEntry {
  id: string;
  at: string;
  /** Which collection: documents, expenses, assets and so on. */
  what: string;
  /** The record's id, so its history can be found. */
  recordId: string;
  /** What it is called in human terms: an invoice number, a supplier. */
  label: string;
  action: AuditAction;
  /** The fields that moved, and what they moved from and to. */
  changes?: Array<{ field: string; from: string; to: string }>;
  /** Who did it, once more than one person can. */
  by?: string;
}

/** Fields not worth recording: they change on every save and say nothing. */
const IGNORED = new Set(["updatedAt", "version", "syncedAt", "createdAt", "deletedAt"]);

/** Fields worth watching closely, because changing them changes what the books say. */
const MATERIAL = new Set([
  "totalMinor", "paidMinor", "netMinor", "taxMinor", "issueDate", "date", "number",
  "status", "clientName", "supplier", "category", "costMinor", "disposalMinor", "tdsMinor"
]);

const show = (value: unknown): string => {
  if (value === undefined || value === null) return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return "…";
};

/**
 * What moved between two versions of a record.
 *
 * Only the top level, and only fields that mean something. A deep comparison of every line of
 * every invoice would produce a history nobody reads, and the lines are visible on the document
 * itself anyway.
 */
export function changesBetween(before: Record<string, unknown>, after: Record<string, unknown>): Array<{ field: string; from: string; to: string }> {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: Array<{ field: string; from: string; to: string }> = [];

  for (const field of fields) {
    if (IGNORED.has(field)) continue;
    const from = before[field];
    const to = after[field];
    if (from === to) continue;
    // Objects compared by shape rather than identity, so a resaved document with the same
    // contents does not read as a change.
    if (typeof from === "object" && typeof to === "object" && JSON.stringify(from) === JSON.stringify(to)) continue;
    out.push({ field, from: show(from), to: show(to) });
  }

  // Material fields first: a changed total matters more than a changed note.
  return out.sort((a, b) => Number(MATERIAL.has(b.field)) - Number(MATERIAL.has(a.field)));
}

/** Whether anything that changed would change the books. */
export const materialChange = (changes: Array<{ field: string }>): boolean =>
  changes.some((c) => MATERIAL.has(c.field));

/** Field names as somebody would say them. */
const NAMES: Record<string, string> = {
  totalMinor: "total", paidMinor: "paid", netMinor: "amount", taxMinor: "tax",
  issueDate: "date", clientName: "customer", number: "number", status: "status",
  category: "account", supplier: "supplier", costMinor: "cost", dueDate: "due date",
  paidOn: "payment date", projectId: "job", orderId: "order", rcmCategory: "reverse charge",
  tdsMinor: "tax held back", tdsSection: "TDS section", disposalMinor: "sale price"
};

export const fieldName = (field: string): string => NAMES[field] ?? field;

/** A sentence saying what happened, for a history nobody has to decode. */
export function describe(entry: AuditEntry): string {
  const what = entry.what.replace(/s$/, "");
  switch (entry.action) {
    case "created":
      return `${entry.label} was created.`;
    case "deleted":
      return `${entry.label} was deleted.`;
    case "status":
      return `${entry.label} was marked ${entry.changes?.[0]?.to ?? "something else"}.`;
    default: {
      const changes = entry.changes ?? [];
      if (changes.length === 0) return `${entry.label} was saved with no change.`;
      if (changes.length === 1) {
        const one = changes[0];
        return `${entry.label}: ${fieldName(one.field)} changed from ${one.from} to ${one.to}.`;
      }
      const named = changes.slice(0, 3).map((c) => fieldName(c.field)).join(", ");
      return `${entry.label}: ${named}${changes.length > 3 ? ` and ${changes.length - 3} more` : ""} changed on this ${what}.`;
    }
  }
}

/** How many entries to keep. Old history is worth less than the space it takes. */
export const KEEP_ENTRIES = 500;

export function trim(entries: AuditEntry[]): AuditEntry[] {
  return entries.length <= KEEP_ENTRIES ? entries : entries.slice(entries.length - KEEP_ENTRIES);
}

/** The history of one record, newest first. */
export const historyOf = (entries: AuditEntry[], recordId: string): AuditEntry[] =>
  // Reversed before sorting, so entries sharing a timestamp keep the order they happened in.
  entries.filter((e) => e.recordId === recordId).reverse().sort((a, b) => b.at.localeCompare(a.at));
