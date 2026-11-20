import { packFor } from "../../../lib/countries/packs";
import { rulesOn } from "../../../lib/countries/types";
import { calculate, counterpartRuleId, defaultTaxRuleId } from "../../../lib/documents/totals";
import type { DocumentData, LineItem } from "../../../lib/documents/types";
import { addDays, nextNumber } from "../../../lib/format";

/**
 * An invoice made through the API, built exactly as the app builds one: the same document
 * shape, the same tax rules and the same arithmetic (the files are shared, not copied), so an
 * invoice created by a shop's website is indistinguishable from one typed in.
 */

export interface ApiCustomer { name?: unknown; email?: unknown; phone?: unknown; taxId?: unknown; address?: unknown; region?: unknown }
export interface ApiLine { description?: unknown; quantity?: unknown; rate?: unknown; unit?: unknown; code?: unknown; taxRuleId?: unknown; taxRate?: unknown; discountPct?: unknown }
export interface ApiInvoice {
  number?: unknown; issueDate?: unknown; dueDate?: unknown; dueInDays?: unknown; currency?: unknown;
  customer?: ApiCustomer; items?: ApiLine[]; notes?: unknown; terms?: unknown; taxInclusive?: unknown; status?: unknown;
}

/** The parts of the business profile an invoice needs. */
export interface SellerProfile {
  name?: string; country?: string; currency?: string; region?: string; taxId?: string; address?: string;
  email?: string; phone?: string; website?: string; template?: string; accentColor?: string;
  defaultTerms?: string; paymentDetails?: string; upiId?: string; gstScheme?: string; lockedUpTo?: string;
  nextNumbers?: Record<string, string>;
}

export type Built =
  | { ok: true; doc: DocumentData; totalMinor: number; status: "draft" | "sent"; nextNumber: string }
  | { ok: false; field: string; says: string };

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

/** The highest number already used in a series, plus one, when the profile does not say. */
export function nextInSeries(used: string[], fallback = "INV-0001"): string {
  if (!used.length) return fallback;
  const parsed = used.map((n) => ({ n, digits: Number(n.match(/(\d+)(?!.*\d)/)?.[1] ?? 0) }));
  const top = parsed.sort((a, b) => b.digits - a.digits)[0];
  return nextNumber(top.n);
}

export function buildInvoice(input: ApiInvoice, profile: SellerProfile, opts: { today: string; usedNumbers: string[] }): Built {
  const country = (profile.country ?? "IN").toUpperCase();
  const currency = (str(input.currency, 3) || profile.currency || packFor(country).currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, field: "currency", says: "currency is a three-letter code such as INR." };

  const issueDate = iso(input.issueDate) || opts.today;
  if (input.issueDate !== undefined && !iso(input.issueDate)) return { ok: false, field: "issueDate", says: "issueDate is a date written YYYY-MM-DD." };
  if (profile.lockedUpTo && issueDate <= profile.lockedUpTo) {
    return { ok: false, field: "issueDate", says: `The books are closed up to ${profile.lockedUpTo}, so an invoice cannot be dated ${issueDate}.` };
  }
  const dueDate = iso(input.dueDate) || (typeof input.dueInDays === "number" && input.dueInDays >= 0 && input.dueInDays <= 365 ? addDays(issueDate, Math.round(input.dueInDays)) : undefined);

  const customer = input.customer ?? {};
  const name = str(customer.name, 120);
  if (!name) return { ok: false, field: "customer.name", says: "customer.name is needed." };

  const lines = Array.isArray(input.items) ? input.items : [];
  if (!lines.length) return { ok: false, field: "items", says: "items needs at least one line." };
  if (lines.length > 200) return { ok: false, field: "items", says: "An invoice can have up to 200 lines." };

  const sellerRegion = profile.region ?? "";
  const placeOfSupply = str(customer.region, 10).toUpperCase() || sellerRegion;
  const inter = country === "IN" && Boolean(sellerRegion && placeOfSupply && sellerRegion !== placeOfSupply);
  const noTax = profile.gstScheme === "unregistered" || profile.gstScheme === "composition";
  const pack = packFor(country);
  const rules = rulesOn(pack, issueDate);

  const items: LineItem[] = [];
  for (const [i, l] of lines.entries()) {
    const description = str(l.description, 300);
    const quantity = Number(l.quantity ?? 1);
    const rate = Number(l.rate);
    if (!description) return { ok: false, field: `items[${i}].description`, says: `items[${i}].description is needed.` };
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, field: `items[${i}].quantity`, says: `items[${i}].quantity must be more than 0.` };
    if (!Number.isFinite(rate) || rate < 0) return { ok: false, field: `items[${i}].rate`, says: `items[${i}].rate must be 0 or more.` };

    let taxRuleId: string | undefined;
    if (!noTax) {
      if (typeof l.taxRuleId === "string") {
        if (!rules.some((r) => r.id === l.taxRuleId)) return { ok: false, field: `items[${i}].taxRuleId`, says: `items[${i}].taxRuleId "${l.taxRuleId}" is not a rule in force on ${issueDate}.` };
        taxRuleId = counterpartRuleId(country, issueDate, l.taxRuleId, inter);
      } else if (typeof l.taxRate === "number") {
        const wanted = inter ? "inter-region" : "intra-region";
        const match = rules.find((r) => r.rate === l.taxRate && (r.appliesWhen === wanted || r.appliesWhen === "always" || !r.appliesWhen));
        if (!match) return { ok: false, field: `items[${i}].taxRate`, says: `There is no ${l.taxRate}% rate in ${country} on ${issueDate}. Rates in force: ${[...new Set(rules.map((r) => r.rate))].join(", ")}.` };
        taxRuleId = match.id;
      } else {
        taxRuleId = defaultTaxRuleId(country, issueDate, inter);
      }
    }

    const discountPct = Number(l.discountPct ?? 0);
    items.push({
      id: `l${i + 1}`, description, quantity, rate, unit: str(l.unit, 20) || undefined, code: str(l.code, 20) || undefined, taxRuleId,
      discountPct: Number.isFinite(discountPct) && discountPct > 0 && discountPct <= 100 ? discountPct : undefined
    });
  }

  const asked = str(input.number, 40);
  if (asked && opts.usedNumbers.includes(asked)) return { ok: false, field: "number", says: `Invoice ${asked} already exists.` };
  // The series' next number, moved past any already taken, so an invoice is never overwritten.
  let number = asked || profile.nextNumbers?.invoice || nextInSeries(opts.usedNumbers);
  for (let i = 0; !asked && opts.usedNumbers.includes(number) && i < 10_000; i++) number = nextNumber(number);

  const doc: DocumentData = {
    kind: "invoice", country, currency, issueDate, dueDate, number,
    composition: profile.gstScheme === "composition" || undefined,
    noGst: profile.gstScheme === "unregistered" || undefined,
    template: (profile.template as DocumentData["template"]) ?? "classic",
    accentColor: profile.accentColor ?? "#0B3D2E",
    seller: { name: profile.name ?? "", address: profile.address ?? "", email: profile.email, phone: profile.phone, website: profile.website, taxId: profile.taxId ?? "", region: sellerRegion },
    buyer: {
      name, email: str(customer.email, 200) || undefined, phone: str(customer.phone, 30) || undefined,
      taxId: str(customer.taxId, 20).toUpperCase() || undefined, address: str(customer.address, 500), region: placeOfSupply
    },
    placeOfSupply,
    items,
    taxInclusive: input.taxInclusive === true,
    roundOff: country === "IN",
    paymentDetails: profile.paymentDetails,
    payment: { upiId: profile.upiId, includeAmount: true },
    terms: str(input.terms, 2000) || profile.defaultTerms || "",
    notes: str(input.notes, 2000)
  } as DocumentData;

  const totals = calculate(doc);
  return {
    ok: true, doc, totalMinor: totals.total.minor,
    status: input.status === "draft" ? "draft" : "sent",
    nextNumber: nextNumber(number)
  };
}

/** What the API shows of a saved document: the summary, the parties and the lines. */
export function documentView(d: Record<string, unknown>) {
  const doc = (d.doc ?? {}) as Partial<DocumentData>;
  return {
    id: d.id, kind: d.kind, number: d.number, status: d.status, issueDate: d.issueDate, dueDate: d.dueDate ?? null,
    currency: d.currency, total: Number(d.totalMinor ?? 0) / 100, paid: Number(d.paidMinor ?? 0) / 100,
    balance: (Number(d.totalMinor ?? 0) - Number(d.paidMinor ?? 0)) / 100, paidOn: d.paidOn ?? null,
    customer: doc.buyer ? { name: doc.buyer.name, email: doc.buyer.email ?? null, taxId: doc.buyer.taxId ?? null, region: doc.buyer.region ?? null } : null,
    items: (doc.items ?? []).map((l) => ({ description: l.description, quantity: l.quantity, rate: l.rate, unit: l.unit ?? null, code: l.code ?? null, taxRuleId: l.taxRuleId ?? null })),
    createdAt: d.createdAt, updatedAt: d.updatedAt
  };
}
