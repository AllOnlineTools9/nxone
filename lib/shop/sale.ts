import { calculate } from "../documents/totals";
import type { DocumentData, LineItem } from "../documents/types";
import type { CatalogueItem, Profile } from "../store/types";

/**
 * A sale at the counter, turned into an ordinary invoice.
 *
 * Shop billing is the fast way in, not a separate set of books: every sale is a paid invoice in
 * the same series, so GST returns, stock, reports, Tally and the accountant see it like any
 * other. Shops price with tax included (the MRP on the pack), so by default the prices typed or
 * scanned are taken as including GST and the tax is worked out of them.
 */

export type PayMode = "cash" | "upi" | "card";

export interface CartLine {
  key: string;
  itemId?: string;
  description: string;
  rate: number;
  quantity: number;
  unit?: string;
  code?: string;
  taxRuleId?: string;
}

export interface ShopSettings {
  /** Thermal paper width. */
  paper: "58" | "80";
  /** Prices on the shelf include tax. */
  pricesIncludeTax: boolean;
  /** Printed at the bottom of every receipt. */
  footer: string;
  /** Open the print dialog as soon as a sale is completed. */
  autoPrint: boolean;
}

export const DEFAULT_SETTINGS: ShopSettings = { paper: "80", pricesIncludeTax: true, footer: "Thank you. Please visit again.", autoPrint: true };

/** Codes as scanners send them: digits and letters only, no spaces. */
export const cleanCode = (s: string) => s.trim().replace(/\s+/g, "").toUpperCase();

/** Finds an item by its barcode first, then by its own code (HSN), never by a partial match. */
export function findByCode(items: CatalogueItem[], code: string): CatalogueItem | undefined {
  const c = cleanCode(code);
  if (!c) return undefined;
  return items.find((i) => i.barcode && cleanCode(i.barcode) === c);
}

/** Items whose name, barcode or code contains what was typed, best matches first. */
export function searchItems(items: CatalogueItem[], query: string, limit = 8): CatalogueItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = items.map((i) => {
    const name = i.description.toLowerCase();
    const score = name.startsWith(q) ? 0 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 1
      : name.includes(q) ? 2 : (i.barcode ?? "").toLowerCase().includes(q) || (i.code ?? "").toLowerCase().includes(q) ? 3 : 9;
    return { i, score };
  }).filter((x) => x.score < 9);
  return scored.sort((a, b) => a.score - b.score || a.i.description.localeCompare(b.i.description)).slice(0, limit).map((x) => x.i);
}

/** Adds an item to the cart, or one more of it if it is already there. */
export function addToCart(cart: CartLine[], item: CatalogueItem, quantity = 1): CartLine[] {
  const at = cart.findIndex((l) => l.itemId === item.id && l.rate === item.rate);
  if (at >= 0) return cart.map((l, i) => (i === at ? { ...l, quantity: round3(l.quantity + quantity) } : l));
  return [...cart, {
    key: `${item.id}-${cart.length}-${Date.now()}`, itemId: item.id, description: item.description, rate: item.rate,
    quantity, unit: item.unit, code: item.code, taxRuleId: item.taxRuleId
  }];
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The invoice for a sale. `base` is a fresh invoice for the business (its details, number and
 * defaults); the cart, the customer and the payment are laid over it.
 */
export function saleDocument(base: DocumentData, profile: Profile | undefined, cart: CartLine[], opts: {
  settings: ShopSettings;
  mode: PayMode;
  customer?: { name?: string; phone?: string; taxId?: string };
}): DocumentData {
  const region = profile?.region ?? base.seller.region ?? "";
  const items: LineItem[] = cart.map((l) => ({
    id: l.key, description: l.description, quantity: l.quantity, rate: l.rate, unit: l.unit, code: l.code,
    taxRuleId: l.taxRuleId ?? base.items[0]?.taxRuleId
  }));
  const doc: DocumentData = {
    ...base,
    items,
    // A counter sale is to someone standing in the shop: the same state, unless they say otherwise.
    buyer: { name: opts.customer?.name?.trim() || "Walk-in customer", phone: opts.customer?.phone, taxId: opts.customer?.taxId, region, address: "" },
    placeOfSupply: region,
    taxInclusive: opts.settings.pricesIncludeTax,
    dueDate: undefined,
    terms: "",
    notes: `Paid by ${opts.mode === "upi" ? "UPI" : opts.mode}.`
  };
  const total = calculate(doc).total.minor;
  return { ...doc, amountPaid: total / 100 };
}

/** Change to hand back, or what is still owed if too little was handed over. */
export function changeFor(totalMinor: number, tenderedMinor: number): { changeMinor: number; shortMinor: number } {
  const diff = tenderedMinor - totalMinor;
  return { changeMinor: Math.max(0, diff), shortMinor: Math.max(0, -diff) };
}

/** Notes a shopkeeper is likely to be handed for a total: the next round amounts above it. */
export function quickCash(totalMinor: number): number[] {
  const rupees = Math.ceil(totalMinor / 100);
  const steps = [10, 50, 100, 500, 2000];
  const out = new Set<number>([rupees]);
  for (const s of steps) out.add(Math.ceil(rupees / s) * s);
  return [...out].filter((v) => v >= rupees).sort((a, b) => a - b).slice(0, 4).map((v) => v * 100);
}

export interface DaySummary {
  count: number;
  totalMinor: number;
  byMode: Record<PayMode, number>;
}

/** Today's counter sales, by how they were paid, for counting the drawer at closing. */
export function daySummary(docs: Array<{ issueDate: string; status: string; totalMinor: number; sale?: { mode: PayMode } }>, day: string): DaySummary {
  const out: DaySummary = { count: 0, totalMinor: 0, byMode: { cash: 0, upi: 0, card: 0 } };
  for (const d of docs) {
    if (!d.sale || d.issueDate !== day || d.status === "cancelled") continue;
    out.count++;
    out.totalMinor += d.totalMinor;
    out.byMode[d.sale.mode] += d.totalMinor;
  }
  return out;
}
