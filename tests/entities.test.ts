import { beforeEach, describe, expect, it } from "vitest";
import { Store, keyForEntity, store, type StorageLike } from "@/lib/store/db";
import { ENTITIES_KEY, Entities, FIRST_ENTITY } from "@/lib/store/entities";

/**
 * The one thing that must never happen here is two businesses touching each other's books. Most
 * of these tests are about that.
 */

const memory = (): StorageLike => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); }
  };
};

describe("where each business keeps its books", () => {
  it("leaves the first one exactly where it has always been", () => {
    expect(keyForEntity(FIRST_ENTITY)).toBe("nxone.workspace.v1");
  });

  it("gives every other one a key of its own", () => {
    expect(keyForEntity("en_abc")).toBe("nxone.workspace.v1:en_abc");
    expect(keyForEntity("en_xyz")).not.toBe(keyForEntity("en_abc"));
  });
});

describe("a store that can open different books", () => {
  let storage: StorageLike;
  let db: Store;

  beforeEach(() => {
    storage = memory();
    db = new Store(storage);
  });

  it("keeps what each one holds apart", () => {
    db.saveProfile({ name: "The shop", country: "IN", currency: "INR" });
    db.saveClient({ name: "A customer of the shop" });

    db.openEntity("en_two");
    expect(db.getProfile()).toBeUndefined();
    expect(db.clients()).toHaveLength(0);

    db.saveProfile({ name: "The consultancy", country: "IN", currency: "INR" });
    db.saveClient({ name: "A client of the consultancy" });
    expect(db.clients()).toHaveLength(1);

    db.openEntity(FIRST_ENTITY);
    expect(db.getProfile()?.name).toBe("The shop");
    expect(db.clients().map((c) => c.name)).toEqual(["A customer of the shop"]);
  });

  it("writes each one to its own place in storage", () => {
    db.saveProfile({ name: "The shop", country: "IN", currency: "INR" });
    db.openEntity("en_two");
    db.saveProfile({ name: "The consultancy", country: "IN", currency: "INR" });

    expect(storage.getItem("nxone.workspace.v1")).toContain("The shop");
    expect(storage.getItem("nxone.workspace.v1:en_two")).toContain("The consultancy");
    expect(storage.getItem("nxone.workspace.v1")).not.toContain("The consultancy");
  });

  it("keeps each one's account and sync position apart, so neither pushes the other's records", () => {
    db.setAccount({ email: "owner@example.com", orgId: "or_shop" });
    db.setCursor(42);

    db.openEntity("en_two");
    expect(db.getAccount()).toBeUndefined();
    expect(db.getCursor()).toBe(0);

    db.openEntity(FIRST_ENTITY);
    expect(db.getAccount()?.orgId).toBe("or_shop");
    expect(db.getCursor()).toBe(42);
  });

  it("tells anything that asks which books are open", () => {
    expect(db.entityKey()).toBe("nxone.workspace.v1");
    db.openEntity("en_two");
    expect(db.entityKey()).toBe("nxone.workspace.v1:en_two");
  });

  it("tells the screens to redraw when the books change under them", () => {
    let told = 0;
    db.subscribe(() => { told += 1; });
    db.openEntity("en_two");
    expect(told).toBe(1);
  });

  it("says nothing when asked to open the books already open", () => {
    let told = 0;
    db.subscribe(() => { told += 1; });
    db.openEntity(FIRST_ENTITY);
    expect(told).toBe(0);
  });

  it("clears only the books that are open", () => {
    db.saveProfile({ name: "The shop", country: "IN", currency: "INR" });
    db.openEntity("en_two");
    db.saveProfile({ name: "The consultancy", country: "IN", currency: "INR" });
    db.clear();

    expect(db.getProfile()).toBeUndefined();
    db.openEntity(FIRST_ENTITY);
    expect(db.getProfile()?.name).toBe("The shop");
  });
});

describe("the list of businesses on a device", () => {
  let storage: StorageLike;
  let list: Entities;

  beforeEach(() => {
    storage = memory();
    list = new Entities(storage);
    store.openEntity(FIRST_ENTITY);
  });

  it("starts with one, before anybody has thought about it", () => {
    expect(list.state().list).toHaveLength(1);
    expect(list.state().active).toBe(FIRST_ENTITY);
  });

  it("adds another and opens it, because that is the only reason to add one", () => {
    const second = list.add("The consultancy");
    expect(list.state().active).toBe(second.id);
    expect(list.list()).toHaveLength(2);
  });

  it("remembers which was open", () => {
    const second = list.add("The consultancy");
    const later = new Entities(storage);
    expect(later.active().id).toBe(second.id);
  });

  it("shows the name from each business's own books, not a copy that can go stale", () => {
    const db = new Store(storage);
    db.saveProfile({ name: "Renamed in its own settings", country: "IN", currency: "INR" });
    expect(list.list()[0].name).toBe("Renamed in its own settings");
  });

  it("ignores an instruction to open one that is not there", () => {
    list.open("en_nonexistent");
    expect(list.state().active).toBe(FIRST_ENTITY);
  });

  it("refuses to remove the only business", () => {
    const result = list.remove(FIRST_ENTITY);
    expect(result.removed).toBe(false);
    expect(result.reason).toContain("only business");
  });

  it("refuses to remove the first set of books even when there are others", () => {
    list.add("Another");
    expect(list.remove(FIRST_ENTITY).removed).toBe(false);
  });

  it("removes another one and its books with it", () => {
    const second = list.add("The consultancy");
    const db = new Store(storage);
    db.openEntity(second.id);
    db.saveProfile({ name: "The consultancy", country: "IN", currency: "INR" });
    expect(storage.getItem(keyForEntity(second.id))).toBeTruthy();

    expect(list.remove(second.id).removed).toBe(true);
    expect(storage.getItem(keyForEntity(second.id))).toBeNull();
    expect(list.list()).toHaveLength(1);
    expect(list.state().active).toBe(FIRST_ENTITY);
  });

  it("falls back to one business rather than losing everything when the list is corrupt", () => {
    storage.setItem(ENTITIES_KEY, "{not json at all");
    const recovered = new Entities(storage);
    expect(recovered.state().list).toHaveLength(1);
    expect(recovered.state().active).toBe(FIRST_ENTITY);
  });

  it("falls back when the list points at a business that is not in it", () => {
    storage.setItem(ENTITIES_KEY, JSON.stringify({ active: "en_gone", list: [{ id: FIRST_ENTITY, name: "", createdAt: "" }] }));
    expect(new Entities(storage).state().active).toBe(FIRST_ENTITY);
  });
});
