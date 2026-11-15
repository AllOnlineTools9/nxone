import { emptyWorkspace, type Workspace } from "./types";
import { keyForEntity, store, type StorageLike } from "./db";

/**
 * More than one business on one device.
 *
 * Plenty of people run two: a shop and a consultancy, a firm and a side trade. They are separate
 * businesses with separate books, separate tax numbers and often separate accountants, so they
 * are kept entirely apart here — separate documents, separate ledger, separate sync. Nothing is
 * pooled, because two businesses sharing one ledger is not a feature, it is a mistake waiting to
 * be found at audit.
 *
 * The first business keeps the original storage key. Somebody who never opens a second one is
 * never migrated, and so can never be broken by a migration.
 */

export const ENTITIES_KEY = "nxone.entities.v1";
export const FIRST_ENTITY = "default";

export interface EntityRef {
  id: string;
  /** Kept in step with the profile so the switcher has a name before the books are read. */
  name: string;
  country?: string;
  currency?: string;
  createdAt: string;
}

export interface EntityState {
  active: string;
  list: EntityRef[];
}

const newId = () => `en_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const localStore = (): StorageLike => {
  if (typeof window === "undefined") {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
  }
  return window.localStorage;
};

export class Entities {
  private listeners = new Set<() => void>();

  constructor(private storage: StorageLike = localStore()) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify() { this.listeners.forEach((fn) => fn()); }

  /** The businesses on this device. There is always at least one, even before anybody names it. */
  state(): EntityState {
    try {
      const raw = this.storage.getItem(ENTITIES_KEY);
      const parsed = raw ? (JSON.parse(raw) as EntityState) : null;
      if (parsed?.list?.length && parsed.list.some((e) => e.id === parsed.active)) return parsed;
    } catch { /* corrupt storage must never cost somebody their books */ }

    return {
      active: FIRST_ENTITY,
      list: [{ id: FIRST_ENTITY, name: this.nameOf(FIRST_ENTITY) ?? "", createdAt: new Date().toISOString() }]
    };
  }

  private save(next: EntityState) {
    try { this.storage.setItem(ENTITIES_KEY, JSON.stringify(next)); } catch { /* keep going */ }
    this.notify();
  }

  /** Peek at a set of books without opening it, so the switcher can show real names. */
  private workspaceOf(id: string): Workspace {
    try {
      const raw = this.storage.getItem(keyForEntity(id));
      return raw ? { ...emptyWorkspace(), ...(JSON.parse(raw) as Workspace) } : emptyWorkspace();
    } catch {
      return emptyWorkspace();
    }
  }

  nameOf(id: string): string | undefined { return this.workspaceOf(id).profile?.name; }

  /** What the switcher shows: the saved name, or the one on the books if it has changed since. */
  list(): EntityRef[] {
    const state = this.state();
    return state.list.map((e) => {
      const profile = this.workspaceOf(e.id).profile;
      return {
        ...e,
        name: profile?.name || e.name || "",
        country: profile?.country ?? e.country,
        currency: profile?.currency ?? e.currency
      };
    });
  }

  active(): EntityRef {
    const state = this.state();
    return this.list().find((e) => e.id === state.active) ?? this.list()[0];
  }

  /** Open one. The store swaps which books it is reading; nothing is copied anywhere. */
  open(id: string) {
    const state = this.state();
    if (!state.list.some((e) => e.id === id)) return;
    this.save({ ...state, active: id });
    store.openEntity(id);
  }

  /**
   * Start another business. It begins empty — no documents, no customers, its own profile to fill
   * in — and is opened straight away, because the only reason to add one is to work in it.
   */
  add(name = ""): EntityRef {
    const state = this.state();
    const entity: EntityRef = { id: newId(), name, createdAt: new Date().toISOString() };
    this.save({ active: entity.id, list: [...state.list, entity] });
    store.openEntity(entity.id);
    return entity;
  }

  /** Rename in the list. The business's own profile remains the real name. */
  rename(id: string, name: string) {
    const state = this.state();
    this.save({ ...state, list: state.list.map((e) => (e.id === id ? { ...e, name } : e)) });
  }

  /**
   * Take a business off this device. The books themselves are removed with it, so this asks the
   * caller to have asked first; what syncs to an account is untouched, and signing in again
   * brings it back.
   */
  remove(id: string): { removed: boolean; reason?: string } {
    const state = this.state();
    if (state.list.length < 2) return { removed: false, reason: "This is the only business on this device." };
    if (id === FIRST_ENTITY) return { removed: false, reason: "The first set of books cannot be removed here. Clear it from your business details instead." };

    try { this.storage.removeItem(keyForEntity(id)); } catch { /* ignore */ }
    const list = state.list.filter((e) => e.id !== id);
    const active = state.active === id ? list[0].id : state.active;
    this.save({ active, list });
    store.openEntity(active);
    return { removed: true };
  }

  /** Put the store on the business that was open last time. Called once, as the app starts. */
  restore() {
    const state = this.state();
    if (state.active !== FIRST_ENTITY) store.openEntity(state.active);
  }
}

export const entities = new Entities();
