import type { ManualEntry } from "../entries/types";
import { countryLocked } from "../countries/features";
import type { DocumentData, DocumentKind } from "../documents/types";
import { rememberFrom } from "../customers/customers";
import { formatDate, todayIso } from "../format";
import { PeriodClosed, isLocked, refusal } from "../books/lock";
import { changesBetween, trim, type AuditAction, type AuditEntry } from "./audit";
import { emptyWorkspace, type SavedAsset, type SavedProject, type CatalogueItem, type Client, type Expense, type Profile, type RecurringTemplate, type SavedDocument, type SavedScenario, type SavedEmployee, type SavedPayRun, type Workspace } from "./types";

/**
 * Everything a person saves lives on their own device. This is a small store over a storage
 * adapter: the browser's local storage in the app, an object in tests. A copy syncs to an account
 * when there is one, but this is always the working copy.
 *
 * It is deliberately boring. The interesting part is that there is nowhere else for the data to go.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEY = "nxone.workspace.v1";

/**
 * Where a second business's books are kept. The first business stays on the original key, so
 * somebody who never opens another one is never migrated and never at risk of a migration.
 */
export const keyForEntity = (id: string) => (id === "default" ? KEY : `${KEY}:${id}`);

const memory = (): StorageLike => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); }
  };
};

export class Store {
  private cache: Workspace | null = null;
  private listeners = new Set<() => void>();
  private key = KEY;

  constructor(private storage: StorageLike = typeof window === "undefined" ? memory() : window.localStorage) {}

  /**
   * Open another business's books. Each one is a separate set: separate documents, separate
   * accounts, separate sync. Nothing is merged and nothing is shared between them, because two
   * businesses that share a ledger are one business with a problem.
   */
  openEntity(id: string) {
    const next = keyForEntity(id);
    if (next === this.key) return;
    this.key = next;
    this.cache = null;
    this.listeners.forEach((fn) => fn());
  }

  /** Which set of books is open, for anything that needs to say so. */
  entityKey() { return this.key; }

  read(): Workspace {
    if (this.cache) return this.cache;
    try {
      const raw = this.storage.getItem(this.key);
      const parsed = raw ? (JSON.parse(raw) as Workspace) : null;
      this.cache = parsed && parsed.version === 1 && Array.isArray(parsed.clients) ? { ...emptyWorkspace(), ...parsed } : emptyWorkspace();
    } catch {
      // corrupt or unavailable storage should never stop the app working
      this.cache = emptyWorkspace();
    }
    return this.cache;
  }

  private write(next: Workspace) {
    this.cache = next;
    try { this.storage.setItem(this.key, JSON.stringify(next)); } catch { /* private mode or full: keep going in memory */ }
    this.listeners.forEach((fn) => fn());
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /* ---- profile ---- */

  getProfile(): Profile | undefined { return this.read().profile; }

  saveProfile(profile: Profile) {
    const existing = this.read().profile;
    // The country and home currency are fixed once documents exist (see countryLocked). The form
    // already stops this; this is the backstop for any other caller.
    if (existing && countryLocked(existing, this.documents().length)) {
      profile = { ...profile, country: existing.country, currency: existing.currency };
    }
    this.write({ ...this.read(), profile: { ...profile, updatedAt: new Date().toISOString(), version: (existing?.version ?? 0) + 1 } });
  }

  /* ---- clients ---- */

  clients(): Client[] { return this.read().clients.filter(alive).sort((a, b) => a.name.localeCompare(b.name)); }

  findClients(query: string, limit = 8): Client[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.clients().slice(0, limit);
    return this.clients()
      .filter((c) => `${c.name} ${c.email ?? ""} ${c.taxId ?? ""}`.toLowerCase().includes(q))
      .slice(0, limit);
  }

  /** Saves a new client, or updates the one with the same name, so a typo does not create a twin. */
  saveClient(input: Omit<Client, "id" | "createdAt" | "updatedAt"> & { id?: string }): Client {
    const now = new Date().toISOString();
    const ws = this.read();
    // match on id when we have one, and fall back to the name so a second save does not make a twin
    const existing = (input.id ? ws.clients.find((c) => c.id === input.id) : undefined)
      ?? ws.clients.find((c) => c.name.trim().toLowerCase() === input.name.trim().toLowerCase());

    const client: Client = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, id: newId("cl"), createdAt: now, updatedAt: now, version: 1 };

    this.write({ ...ws, clients: existing ? ws.clients.map((c) => (c.id === client.id ? client : c)) : [...ws.clients, client] });
    return client;
  }

  deleteClient(id: string) { this.tombstone("clients", id); }

  /**
   * Create or freshen the customer a document is for, and return their id. Never blanks a saved
   * detail, and never touches payment terms or notes, which are set on the customer directly.
   */
  private rememberCustomer(doc: DocumentData): string | undefined {
    const ws = this.read();
    const plan = rememberFrom(ws.clients ?? [], doc);
    if (plan.action === "none") return plan.id;

    const now = new Date().toISOString();
    if (plan.action === "create") {
      const client: Client = { ...plan.fields, id: newId("cl"), createdAt: now, updatedAt: now, version: 1 } as Client;
      this.write({ ...ws, clients: [...ws.clients, client] });
      return client.id;
    }

    this.write({
      ...ws,
      clients: ws.clients.map((c) => c.id === plan.id
        ? { ...c, ...plan.fields, updatedAt: now, version: (c.version ?? 1) + 1 }
        : c)
    });
    return plan.id;
  }

  /* ---- catalogue ---- */

  items(): CatalogueItem[] { return this.read().items.filter(alive).sort((a, b) => a.description.localeCompare(b.description)); }

  findItems(query: string, limit = 8): CatalogueItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.items().slice(0, limit);
    return this.items().filter((i) => `${i.description} ${i.code ?? ""}`.toLowerCase().includes(q)).slice(0, limit);
  }

  saveItem(input: Omit<CatalogueItem, "id" | "createdAt" | "updatedAt"> & { id?: string }): CatalogueItem {
    const now = new Date().toISOString();
    const ws = this.read();
    const existing = (input.id ? ws.items.find((i) => i.id === input.id) : undefined)
      ?? ws.items.find((i) => i.description.trim().toLowerCase() === input.description.trim().toLowerCase());

    const item: CatalogueItem = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, id: newId("it"), createdAt: now, updatedAt: now, version: 1 };

    this.write({ ...ws, items: existing ? ws.items.map((i) => (i.id === item.id ? item : i)) : [...ws.items, item] });
    return item;
  }

  deleteItem(id: string) { this.tombstone("items", id); }

  /* ---- documents ---- */

  documents(): SavedDocument[] {
    return this.read().documents.filter(alive).sort((a, b) => (a.issueDate === b.issueDate ? b.updatedAt.localeCompare(a.updatedAt) : b.issueDate.localeCompare(a.issueDate)));
  }

  getDocument(id: string) { return this.read().documents.find((d) => d.id === id); }

  /** Saving the same number twice updates that document rather than piling up duplicates. */
  /**
   * Refuse to touch a closed period. Checked on the way in and on the way out: a document can
   * be moved *into* a closed period as well as edited inside one, and both have to be stopped
   * or the lock means nothing.
   */
  /**
   * Record what changed. Called from inside the write methods rather than by their callers, so
   * nothing can be changed through this store without leaving a trace - a trail somebody has to
   * remember to write is a trail with holes in it exactly where it matters.
   */
  private record(
    what: string, recordId: string, label: string, action: AuditAction,
    before?: Record<string, unknown>, after?: Record<string, unknown>,
    /** Given directly when the change is known without comparing two versions. */
    stated?: Array<{ field: string; from: string; to: string }>
  ) {
    const ws = this.read();
    const changes = stated ?? (before && after ? changesBetween(before, after) : undefined);
    // A save that changed nothing is not worth a line in the history.
    if (action === "changed" && (!changes || changes.length === 0)) return;

    const entry: AuditEntry = {
      id: newId("au"), at: new Date().toISOString(), what, recordId, label, action, changes
    };
    this.write({ ...ws, audit: trim([...(ws.audit ?? []), entry]) });
  }

  /**
   * Everything recorded, newest first. Several writes can land in the same millisecond, and
   * sorting on the timestamp alone would order those arbitrarily - so the stored order breaks
   * the tie, which is the order they actually happened in.
   */
  auditTrail(): AuditEntry[] {
    return [...(this.read().audit ?? [])].reverse().sort((a, b) => b.at.localeCompare(a.at));
  }

  private guardLock(what: "document" | "expense" | "entry", ...dates: Array<string | undefined>) {
    const profile = this.read().profile;
    const lockedUpTo = profile?.lockedUpTo;
    if (!lockedUpTo) return;
    // Dates in the reader's own format: a refusal that says 2026-09-10 to somebody who sees
    // 10/09/2026 on every screen reads like it is about a different document.
    const show = (iso: string) => formatDate(iso, profile?.country ?? "IN");
    for (const date of dates) {
      if (date && isLocked(date, lockedUpTo)) throw new PeriodClosed(date, lockedUpTo, refusal(what, date, lockedUpTo, show));
    }
  }

  saveDocument(input: Omit<SavedDocument, "id" | "createdAt" | "updatedAt"> & { id?: string }): SavedDocument {
    const now = new Date().toISOString();
    const ws = this.read();
    // the number is the real identity of a document, so saving the same one twice updates it
    const existing = (input.id ? ws.documents.find((d) => d.id === input.id) : undefined)
      ?? ws.documents.find((d) => d.kind === input.kind && d.number === input.number);

    this.guardLock("document", input.issueDate, existing?.issueDate);

    // Remember the customer as a side effect of saving, here rather than in the builder, so a
    // document saved by any route (converted, recurring, duplicated) is covered the same way.
    const clientId = input.doc ? this.rememberCustomer(input.doc) : input.clientId;

    const saved: SavedDocument = existing
      ? { ...existing, ...input, clientId: clientId ?? existing.clientId, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, clientId, id: newId("dc"), createdAt: now, updatedAt: now, version: 1 };

    const latest = this.read();
    this.write({ ...latest, documents: existing ? latest.documents.map((d) => (d.id === saved.id ? saved : d)) : [...latest.documents, saved] });
    this.record("documents", saved.id, saved.number, existing ? "changed" : "created",
      existing as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>);
    return saved;
  }

  setStatus(id: string, status: SavedDocument["status"], paidMinor?: number, paidOn?: string) {
    // The payment lands on the day the money arrived, so that is the date that must be open.
    this.guardLock("document", paidOn ?? todayIso());
    let recordStatus: { number: string; from: string; to: string } | undefined;
    const ws = this.read();
    this.write({
      ...ws,
      documents: ws.documents.map((d) => {
        if (d.id !== id) return d;
        const nowPaid = paidMinor ?? (status === "paid" ? d.totalMinor : d.paidMinor);
        const gotMoney = nowPaid > d.paidMinor;
        recordStatus = { number: d.number, from: d.status, to: status };
        return {
          ...d, status, paidMinor: nowPaid,
          // Set the day the money arrived the first time money arrives, and leave it alone
          // afterwards: a later edit is an edit, not a second payment.
          paidOn: nowPaid <= 0 ? undefined : gotMoney ? paidOn ?? todayIso() : d.paidOn,
          updatedAt: new Date().toISOString()
        };
      })
    });

    if (recordStatus && recordStatus.from !== recordStatus.to) {
      this.record("documents", id, recordStatus.number, "status", undefined, undefined,
        [{ field: "status", from: recordStatus.from, to: recordStatus.to }]);
    }
  }

  deleteDocument(id: string) {
    const existing = this.read().documents.find((d) => d.id === id);
    this.guardLock("document", existing?.issueDate);
    this.tombstone("documents", id);
    if (existing) this.record("documents", id, existing.number, "deleted");
  }

  /* ---- expenses ---- */

  expenses(): Expense[] {
    return (this.read().expenses ?? []).filter(alive).sort((a, b) => b.date.localeCompare(a.date));
  }

  saveExpense(input: Omit<Expense, "id" | "createdAt" | "updatedAt"> & { id?: string }): Expense {
    const now = new Date().toISOString();
    const ws = this.read();
    const list = ws.expenses ?? [];
    const existing = input.id ? list.find((e) => e.id === input.id) : undefined;
    this.guardLock("expense", input.date, existing?.date);

    const saved: Expense = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, id: newId("ex"), createdAt: now, updatedAt: now, version: 1 };

    this.write({ ...ws, expenses: existing ? list.map((e) => (e.id === saved.id ? saved : e)) : [...list, saved] });
    this.record("expenses", saved.id, `${saved.supplier}${saved.reference ? ` ${saved.reference}` : ""}`,
      existing ? "changed" : "created", existing as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>);
    return saved;
  }

  deleteExpense(id: string) {
    const existing = (this.read().expenses ?? []).find((e) => e.id === id);
    this.guardLock("expense", existing?.date);
    this.tombstone("expenses", id);
    if (existing) this.record("expenses", id, `${existing.supplier}${existing.reference ? ` ${existing.reference}` : ""}`, "deleted");
  }

  /**
   * Deleting marks the row instead of removing it, so your other devices learn about it. A row the
   * server has never seen is dropped outright, since there is nobody to tell.
   */
  private tombstone(collection: "clients" | "items" | "documents" | "expenses" | "recurring" | "scenarios" | "employees" | "payruns" | "assets" | "projects" | "entries", id: string) {
    const ws = this.read();
    const now = new Date().toISOString();
    const list = (ws[collection] ?? []) as Array<Client | CatalogueItem | SavedDocument | Expense | RecurringTemplate | SavedScenario | SavedEmployee | SavedPayRun | SavedAsset | SavedProject | ManualEntry>;
    const next = list
      .filter((row) => !(row.id === id && !row.syncedAt))
      .map((row) => (row.id === id ? { ...row, deletedAt: now, updatedAt: now, version: (row.version ?? 1) + 1 } : row));
    this.write({ ...ws, [collection]: next } as Workspace);
  }

  /* ---- what sync needs ---- */

  /** Everything, tombstones included. */
  raw(): Workspace { return this.read(); }

  /** Used by sync when applying what came down from the server. */
  apply(patch: Partial<Workspace>) { this.write({ ...this.read(), ...patch }); }

  setCursor(cursor: number) { this.write({ ...this.read(), syncCursor: cursor }); }
  getCursor(): number { return this.read().syncCursor ?? 0; }
  setAccount(account: Workspace["account"]) { this.write({ ...this.read(), account }); }
  getAccount() { return this.read().account; }

  /* ---- invoices that repeat ---- */

  recurring(): RecurringTemplate[] {
    return (this.read().recurring ?? []).filter(alive).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  }

  saveRecurring(input: Omit<RecurringTemplate, "createdAt" | "updatedAt"> & { createdAt?: string }): RecurringTemplate {
    const now = new Date().toISOString();
    const ws = this.read();
    const list = ws.recurring ?? [];
    const existing = list.find((r) => r.id === input.id);
    const saved: RecurringTemplate = existing
      ? { ...existing, ...input, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, createdAt: input.createdAt ?? now, updatedAt: now, version: 1 };

    this.write({ ...ws, recurring: existing ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved] });
    return saved;
  }

  deleteRecurring(id: string) { this.tombstone("recurring", id); }

  /* ---- questions you kept ---- */

  scenarios(): SavedScenario[] {
    return (this.read().scenarios ?? []).filter(alive).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Saving under a name you have used before replaces that one, so trying again does not pile up. */
  saveScenario(input: Omit<SavedScenario, "id" | "createdAt" | "updatedAt"> & { id?: string }): SavedScenario {
    const now = new Date().toISOString();
    const ws = this.read();
    const list = ws.scenarios ?? [];
    const existing = (input.id ? list.find((s) => s.id === input.id) : undefined)
      ?? list.find((s) => !s.deletedAt && s.name.trim().toLowerCase() === input.name.trim().toLowerCase());

    const saved: SavedScenario = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, id: newId("sc"), createdAt: now, updatedAt: now, version: 1 };

    this.write({ ...ws, scenarios: existing ? list.map((s) => (s.id === saved.id ? saved : s)) : [...list, saved] });
    return saved;
  }

  deleteScenario(id: string) { this.tombstone("scenarios", id); }

  assets(): SavedAsset[] { return (this.read().assets ?? []).filter((a) => !a.deletedAt); }

  saveAsset(input: Omit<SavedAsset, "id" | "createdAt" | "updatedAt"> & { id?: string }): SavedAsset {
    const now = new Date().toISOString();
    const ws = this.read();
    const list = ws.assets ?? [];
    const existing = input.id ? list.find((a) => a.id === input.id) : undefined;

    const saved: SavedAsset = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, id: newId("as"), createdAt: now, updatedAt: now, version: 1 };

    this.write({ ...ws, assets: existing ? list.map((a) => (a.id === saved.id ? saved : a)) : [...list, saved] });
    this.record("assets", saved.id, saved.name, existing ? "changed" : "created",
      existing as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>);
    return saved;
  }

  deleteAsset(id: string) { this.tombstone("assets", id); }

  projects(): SavedProject[] { return (this.read().projects ?? []).filter((p) => !p.deletedAt); }

  saveProject(input: Omit<SavedProject, "id" | "createdAt" | "updatedAt"> & { id?: string }): SavedProject {
    const now = new Date().toISOString();
    const ws = this.read();
    const list = ws.projects ?? [];
    const existing = input.id ? list.find((p) => p.id === input.id) : undefined;

    const saved: SavedProject = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, id: newId("pj"), createdAt: now, updatedAt: now, version: 1 };

    this.write({ ...ws, projects: existing ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved] });
    return saved;
  }

  deleteProject(id: string) { this.tombstone("projects", id); }

  /* ---- entries recorded directly ---- */

  entries(): ManualEntry[] { return (this.read().entries ?? []).filter((e) => !e.deletedAt).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)); }

  /** Saves an entry, refusing one dated inside a closed period or one that does not balance. */
  saveEntry(input: Omit<ManualEntry, "id" | "createdAt" | "updatedAt"> & { id?: string }): ManualEntry {
    const debits = input.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
    const credits = input.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
    if (!debits || debits !== credits) throw new Error("The entry does not balance: what goes in must equal what comes out.");
    const ws = this.read();
    const list = ws.entries ?? [];
    const existing = input.id ? list.find((e) => e.id === input.id) : undefined;
    this.guardLock("entry", input.date, existing?.date);

    const now = new Date().toISOString();
    const saved: ManualEntry = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, id: newId("je"), createdAt: now, updatedAt: now, version: 1 };
    this.write({ ...ws, entries: existing ? list.map((e) => (e.id === saved.id ? saved : e)) : [...list, saved] });
    this.record("entries", saved.id, saved.narration.slice(0, 60), existing ? "changed" : "created",
      existing as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>);
    return saved;
  }

  deleteEntry(id: string) {
    const found = (this.read().entries ?? []).find((e) => e.id === id);
    if (found) this.guardLock("entry", found.date);
    this.tombstone("entries", id);
    if (found) this.record("entries", id, found.narration.slice(0, 60), "deleted");
  }

  /**
   * Tie a document to the one it was made from - a quotation to the invoice it became. Both ends
   * are recorded, so either can be opened and the other found, and the quotation can show that it
   * was taken up rather than looking forgotten.
   */
  linkConversion(sourceId: string, made: { id: string; kind: DocumentKind; number: string }) {
    const ws = this.read();
    const now = new Date().toISOString();
    const documents = (ws.documents ?? []).map((d) => {
      if (d.id === sourceId) return { ...d, madeInto: made, updatedAt: now, version: (d.version ?? 1) + 1 };
      if (d.id === made.id) {
        const from = (ws.documents ?? []).find((x) => x.id === sourceId);
        return from ? { ...d, madeFrom: { id: from.id, number: from.number }, updatedAt: now, version: (d.version ?? 1) + 1 } : d;
      }
      return d;
    });
    this.write({ ...ws, documents });
  }

  /* ---- the payroll ---- */

  employees(): SavedEmployee[] {
    return (this.read().employees ?? []).filter(alive).sort((a, b) => a.name.localeCompare(b.name));
  }

  saveEmployee(input: Omit<SavedEmployee, "createdAt" | "updatedAt"> & { id?: string }): SavedEmployee {
    const now = new Date().toISOString();
    const ws = this.read();
    const list = ws.employees ?? [];
    const existing = input.id ? list.find((e) => e.id === input.id) : undefined;
    const saved: SavedEmployee = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { ...input, id: input.id || newId("em"), createdAt: now, updatedAt: now, version: 1 };
    this.write({ ...ws, employees: existing ? list.map((e) => (e.id === saved.id ? saved : e)) : [...list, saved] });
    return saved;
  }

  deleteEmployee(id: string) { this.tombstone("employees", id); }

  payruns(): SavedPayRun[] {
    return (this.read().payruns ?? []).filter(alive).sort((a, b) => b.month.localeCompare(a.month));
  }

  /**
   * Keep a month exactly as it was paid. The rules behind a payslip change at budgets, so a run
   * is frozen rather than recomputed: somebody asking in two years what they were paid should
   * get what they were paid.
   */
  savePayRun(month: string, snapshot: unknown, postedAt?: string): SavedPayRun {
    const now = new Date().toISOString();
    const ws = this.read();
    const list = ws.payruns ?? [];
    const existing = list.find((r) => r.month === month);
    const saved: SavedPayRun = existing
      ? { ...existing, snapshot, postedAt: postedAt ?? existing.postedAt, updatedAt: now, version: (existing.version ?? 1) + 1, deletedAt: undefined }
      : { id: newId("pr"), month, snapshot, postedAt, createdAt: now, updatedAt: now, version: 1 };
    this.write({ ...ws, payruns: existing ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved] });
    return saved;
  }

  deletePayRun(id: string) { this.tombstone("payruns", id); }

  /* ---- the whole lot ---- */

  export(): string { return JSON.stringify(this.read(), null, 2); }

  /** Merges a backup into what is here, keeping whichever copy was edited last. */
  import(json: string): { clients: number; items: number; documents: number; expenses: number } {
    const incoming = JSON.parse(json) as Workspace;
    if (incoming?.version !== 1) throw new Error("That file is not an NXOne backup.");
    const ws = this.read();

    const mergeById = <T extends { id: string; updatedAt: string }>(mine: T[], theirs: T[]) => {
      const byId = new Map(mine.map((x) => [x.id, x]));
      for (const t of theirs ?? []) {
        const m = byId.get(t.id);
        if (!m || t.updatedAt > m.updatedAt) byId.set(t.id, t);
      }
      return [...byId.values()];
    };

    const next: Workspace = {
      version: 1,
      profile: incoming.profile ?? ws.profile,
      clients: mergeById(ws.clients, incoming.clients ?? []),
      items: mergeById(ws.items, incoming.items ?? []),
      documents: mergeById(ws.documents, incoming.documents ?? []),
      expenses: mergeById(ws.expenses ?? [], incoming.expenses ?? []),
      recurring: mergeById(ws.recurring ?? [], incoming.recurring ?? []),
      scenarios: mergeById(ws.scenarios ?? [], incoming.scenarios ?? []),
      employees: mergeById(ws.employees ?? [], incoming.employees ?? []),
      payruns: mergeById(ws.payruns ?? [], incoming.payruns ?? [])
    };
    this.write(next);
    return { clients: next.clients.length, items: next.items.length, documents: next.documents.length, expenses: next.expenses.length };
  }

  clear() { 
    try { this.storage.removeItem(this.key); } catch { /* ignore */ }
    this.cache = null;
    this.listeners.forEach((fn) => fn());
  }
}

/** A row nobody has deleted. Tombstones stay in storage so the deletion can sync. */
const alive = <T extends { deletedAt?: string }>(row: T) => !row.deletedAt;

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** The one the app uses. Tests make their own with a memory adapter. */
export const store = new Store();
