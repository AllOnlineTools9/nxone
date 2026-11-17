import { beforeEach, describe, expect, it } from "vitest";
import {
  describeTerms, documentsFor, dueDateFor, matchCustomer, rememberFrom,
  remembersCustomer, summarise, takesPaymentTerms, unsavedFromDocuments
} from "@/lib/customers/customers";
import { withCustomer } from "@/components/builder/state";
import { Store, type StorageLike } from "@/lib/store/db";
import type { Client, SavedDocument } from "@/lib/store/types";

const memory = (): StorageLike => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
};

const client = (over: Partial<Client> = {}): Client => ({
  id: "cl1", name: "Globex Private Limited", taxId: "27AAFCI5678K1ZY", email: "ap@globex.example",
  address: "Mumbai", region: "MH", createdAt: "", updatedAt: "", version: 1, ...over
} as Client);

const docData = (over: Record<string, unknown> = {}) => ({
  kind: "invoice", country: "IN", currency: "INR", issueDate: "2026-11-17", number: "INV-1",
  seller: { name: "Brightline", region: "KA" },
  buyer: { name: "Globex Private Limited", taxId: "27AAFCI5678K1ZY", email: "ap@globex.example", address: "Mumbai" },
  placeOfSupply: "MH", taxInclusive: false, items: [], ...over
}) as never;

const saved = (over: Partial<SavedDocument> = {}): SavedDocument => ({
  id: "d1", kind: "invoice", number: "INV-1", clientName: "Globex Private Limited", issueDate: "2026-10-01",
  dueDate: "2026-10-31", currency: "INR", totalMinor: 5_900_000, paidMinor: 0, status: "sent",
  createdAt: "", updatedAt: "", version: 1, doc: docData(), ...over
} as SavedDocument);

/* ----------------------------------------------------------------- remembering */

describe("remembering a customer from a document", () => {
  it("creates one the first time they are billed", () => {
    const plan = rememberFrom([], docData());
    expect(plan.action).toBe("create");
    if (plan.action === "create") expect(plan.fields.region).toBe("MH");
  });

  it("does nothing when nothing has changed", () => {
    expect(rememberFrom([client()], docData()).action).toBe("none");
  });

  it("fills in a detail that is new", () => {
    const plan = rememberFrom([client({ phone: undefined })], docData({ buyer: { name: "Globex Private Limited", taxId: "27AAFCI5678K1ZY", phone: "9845011111" } }));
    expect(plan.action).toBe("update");
    if (plan.action === "update") expect(plan.changed).toEqual(["phone"]);
  });

  it("never blanks a saved detail because one invoice left it empty", () => {
    const plan = rememberFrom([client()], docData({ buyer: { name: "Globex Private Limited" } }));
    expect(plan.action).toBe("none");
  });

  it("matches on GSTIN before name, so a renamed customer is still found", () => {
    const found = matchCustomer([client()], { name: "Globex Pvt Ltd", taxId: "27aafci5678k1zy" });
    expect(found?.id).toBe("cl1");
  });

  it("falls back to the name, ignoring case and spaces", () => {
    expect(matchCustomer([client({ taxId: undefined })], { name: "  globex private limited " })?.id).toBe("cl1");
  });

  it("never remembers the supplier on a purchase order as a customer", () => {
    expect(remembersCustomer("purchase-order")).toBe(false);
    expect(rememberFrom([], docData({ kind: "purchase-order" })).action).toBe("none");
  });

  it("does nothing for a document with nobody on it", () => {
    expect(rememberFrom([], docData({ buyer: { name: "  " } })).action).toBe("none");
    expect(rememberFrom([], docData({ buyer: undefined })).action).toBe("none");
  });

  it("leaves payment terms and notes alone, which are set on the customer, not inferred", () => {
    const plan = rememberFrom([client({ termsDays: 30, notes: "PO needed", phone: undefined })], docData({ buyer: { name: "Globex Private Limited", phone: "98450" } }));
    if (plan.action === "update") {
      expect(plan.fields.termsDays).toBeUndefined();
      expect(plan.fields.notes).toBeUndefined();
    }
  });
});

describe("the store doing it on save", () => {
  let db: Store;
  beforeEach(() => {
    db = new Store(memory());
    db.saveProfile({ name: "Brightline", country: "IN", currency: "INR" });
  });

  const asSaved = (over = {}) => ({
    kind: "invoice" as const, number: "INV-1", clientName: "Globex Private Limited", issueDate: "2026-11-17",
    currency: "INR", totalMinor: 100, paidMinor: 0, status: "sent" as const, version: 1, doc: docData(over)
  });

  it("adds the customer and links the document to them", () => {
    const d = db.saveDocument(asSaved());
    expect(db.clients()).toHaveLength(1);
    expect(d.clientId).toBe(db.clients()[0].id);
  });

  it("does not make a twin when they are billed again", () => {
    db.saveDocument(asSaved());
    db.saveDocument({ ...asSaved(), number: "INV-2" });
    expect(db.clients()).toHaveLength(1);
  });

  it("keeps the history linked after the customer is renamed", () => {
    const d = db.saveDocument(asSaved());
    const c = db.clients()[0];
    db.saveClient({ ...c, name: "Globex India" });
    expect(documentsFor({ ...c, name: "Globex India" }, db.documents()).map((x) => x.id)).toEqual([d.id]);
  });
});

/* ------------------------------------------------------------------ the history */

describe("what a customer owes", () => {
  it("counts unpaid invoices, and takes credit notes off", () => {
    const s = summarise(client(), [
      saved(),
      saved({ id: "d2", number: "CN-1", kind: "credit-note", totalMinor: 900_000, paidMinor: 0 })
    ], "2026-11-17");
    expect(s.owedMinor).toBe(5_000_000);
  });

  it("ignores drafts, cancellations and quotations", () => {
    const s = summarise(client(), [
      saved(), saved({ id: "d2", status: "draft" }), saved({ id: "d3", status: "cancelled" }),
      saved({ id: "d4", kind: "quote", number: "QUO-1" })
    ], "2026-11-17");
    expect(s.owedMinor).toBe(5_900_000);
    expect(s.documents).toHaveLength(4);
  });

  it("counts what is overdue", () => {
    expect(summarise(client(), [saved()], "2026-11-17").overdue).toBe(1);
    expect(summarise(client(), [saved()], "2026-10-15").overdue).toBe(0);
  });

  it("lists their documents newest first", () => {
    const s = summarise(client(), [saved(), saved({ id: "d2", number: "INV-2", issueDate: "2026-11-01" })], "2026-11-17");
    expect(s.documents[0].number).toBe("INV-2");
    expect(s.lastOn).toBe("2026-11-01");
  });

  it("does not claim another customer's documents", () => {
    expect(documentsFor(client(), [saved({ clientName: "Initech", doc: docData({ buyer: { name: "Initech" } }) })])).toHaveLength(0);
  });
});

describe("customers from before they were remembered", () => {
  it("finds people on past documents who were never saved, once each", () => {
    const out = unsavedFromDocuments([], [saved(), saved({ id: "d2", number: "INV-2" }), saved({ id: "d3", clientName: "Initech", doc: docData({ buyer: { name: "Initech" } }) })]);
    expect(out.map((u) => u.name)).toEqual(["Globex Private Limited", "Initech"]);
  });

  it("leaves out anyone already saved, and suppliers on purchase orders", () => {
    const out = unsavedFromDocuments([client()], [saved(), saved({ id: "d2", kind: "purchase-order", clientName: "Ravi Builders" })]);
    expect(out).toHaveLength(0);
  });
});

/* -------------------------------------------------------------- payment terms */

describe("payment terms", () => {
  it("counts the due date from the issue date", () => {
    expect(dueDateFor("2026-11-17", 30)).toBe("2026-12-17");
    expect(dueDateFor("2026-12-20", 15)).toBe("2027-01-04");
    expect(dueDateFor("2026-11-17", 0)).toBe("2026-11-17");
  });

  it("applies to invoices, not to how long a quotation stands", () => {
    expect(takesPaymentTerms("invoice")).toBe(true);
    expect(takesPaymentTerms("proforma")).toBe(true);
    expect(takesPaymentTerms("quote")).toBe(false);
  });

  it("sets the due date when the customer is picked on an invoice", () => {
    const out = withCustomer(docData({ buyer: { name: "" }, dueDate: "2026-12-01" }), client({ termsDays: 45 }));
    expect(out.dueDate).toBe("2027-01-01");
    expect(out.buyer.name).toBe("Globex Private Limited");
    expect(out.placeOfSupply).toBe("MH");
  });

  it("leaves a quotation's validity date alone", () => {
    const out = withCustomer(docData({ kind: "quote", dueDate: "2026-12-01" }), client({ termsDays: 45 }));
    expect(out.dueDate).toBe("2026-12-01");
  });

  it("leaves the due date alone for a customer with no terms set", () => {
    expect(withCustomer(docData({ dueDate: "2026-12-01" }), client()).dueDate).toBe("2026-12-01");
  });

  it("says terms the way people say them", () => {
    expect(describeTerms(0)).toBe("Due on receipt");
    expect(describeTerms(30)).toBe("30 days");
    expect(describeTerms(undefined)).toBe("Not set");
  });
});
