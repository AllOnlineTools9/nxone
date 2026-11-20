/**
 * The chart of accounts. Codes follow the usual ranges so an accountant recognises them at a
 * glance: 1000s assets, 2000s liabilities, 3000s equity, 4000s income, 5000s and 6000s costs.
 *
 * A business owner never sees any of this. It exists so that profit, cash and tax are derived
 * from one consistent record rather than assembled from whatever happens to be lying around.
 */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  /** Where a positive balance sits. Assets and expenses are debit-normal; the rest are credit-normal. */
  normal: "debit" | "credit";
  /** Shown in simple language on the owner's screens. */
  plain?: string;
  /** Marks the accounts that make up cash, for the cash-flow view. */
  isCash?: boolean;
  /** Tax accounts carry the amounts a return reports. */
  taxRole?: "output" | "input";
}

const asset = (code: string, name: string, extra: Partial<Account> = {}): Account => ({ code, name, type: "asset", normal: "debit", ...extra });
const liability = (code: string, name: string, extra: Partial<Account> = {}): Account => ({ code, name, type: "liability", normal: "credit", ...extra });
const income = (code: string, name: string, extra: Partial<Account> = {}): Account => ({ code, name, type: "income", normal: "credit", ...extra });
const expense = (code: string, name: string, extra: Partial<Account> = {}): Account => ({ code, name, type: "expense", normal: "debit", ...extra });

export const CHART: Account[] = [
  asset("1010", "Cash in hand", { isCash: true, plain: "Cash" }),
  asset("1020", "Bank account", { isCash: true, plain: "Bank" }),
  asset("1030", "Payment gateway balance", { isCash: true, plain: "Money in transit" }),
  asset("1040", "Fixed deposits", { plain: "Money in fixed deposits" }),
  asset("1050", "Security deposits", { plain: "Deposits paid, such as rent deposits" }),
  asset("1100", "Investments", { plain: "Investments" }),
  asset("1200", "Accounts receivable", { plain: "Owed to you" }),
  asset("1210", "Accrued income", { plain: "Earned but not yet received" }),
  asset("1410", "Tax deducted by customers", { plain: "Tax customers held back, to claim" }),
  asset("1600", "Advance tax paid", { plain: "Income tax paid in advance" }),
  asset("1300", "Stock", { plain: "Goods on the shelf" }),
  asset("1400", "Input tax credit", { taxRole: "input", plain: "Tax you can reclaim" }),
  asset("1500", "Prepayments", { plain: "Paid in advance" }),
  asset("1700", "Equipment", { plain: "Equipment you own" }),
  // Kept apart from the cost above, so the balance sheet can show what something cost and what
  // it has worn down to. Netting them into one figure loses the first, which is what the tax
  // computation and any sale of the thing are both worked out from.
  asset("1790", "Depreciation so far", { plain: "What your equipment has worn down by" }),

  liability("2010", "Accounts payable", { plain: "You owe suppliers" }),
  liability("2100", "Tax collected on sales", { taxRole: "output", plain: "Tax you owe the government" }),
  liability("2200", "Customer advances", { plain: "Paid to you in advance" }),
  liability("2050", "Outstanding expenses", { plain: "Costs owed but not yet paid" }),
  liability("2210", "Income received in advance", { plain: "Received for work not yet done" }),
  liability("2300", "Loans", { plain: "Borrowings" }),
  liability("2400", "Salaries payable", { plain: "Pay owed to staff" }),
  liability("2410", "Provident fund payable", { plain: "Provident fund owed" }),
  liability("2420", "Employee insurance payable", { plain: "Employee insurance owed" }),
  liability("2430", "Tax deducted payable", { plain: "Tax held back from pay" }),
  liability("2440", "Professional tax payable", { plain: "Professional tax owed" }),

  { code: "3000", name: "Owner's capital", type: "equity", normal: "credit", plain: "What the owner put in" },
  // Money the owners take out for themselves. It reduces what they have in the business, so it sits
  // with capital, as a debit, and never as a cost: drawings are not an expense of the business.
  { code: "3100", name: "Drawings", type: "equity", normal: "debit", plain: "Taken out by the owners" },
  { code: "3010", name: "Share capital", type: "equity", normal: "credit", plain: "Shares issued" },
  { code: "3900", name: "Retained earnings", type: "equity", normal: "credit", plain: "Profit kept in the business" },

  income("4000", "Sales", { plain: "What you earned" }),
  income("4100", "Other income", { plain: "Other income" }),
  income("4200", "Interest received", { plain: "Interest earned" }),
  income("4300", "Exchange gain", { plain: "Gained on exchange rates" }),
  income("4910", "Discounts received", { plain: "Discounts suppliers gave you" }),
  income("4900", "Discounts given", { normal: "debit", plain: "Discounts you gave" }),
  income("4800", "Gain on sale of equipment", { plain: "Sold for more than it was worth" }),

  expense("5000", "Cost of sales", { plain: "What your sales cost you" }),
  expense("6010", "Rent"),
  expense("6020", "Salaries and wages"),
  expense("6025", "Employer contributions", { plain: "Provident fund and insurance you pay" }),
  expense("6030", "Utilities"),
  expense("6040", "Software and subscriptions"),
  expense("6050", "Advertising and marketing"),
  expense("6060", "Travel"),
  expense("6070", "Professional fees"),
  expense("6080", "Repairs and maintenance"),
  expense("6090", "Bank and payment charges"),
  expense("6100", "Office supplies"),
  expense("6110", "Interest paid", { plain: "Interest on loans" }),
  expense("6120", "Bad debts", { plain: "Money customers will not pay" }),
  expense("6130", "Insurance"),
  expense("6960", "Income tax", { plain: "Tax on the business's profit" }),
  expense("6500", "Depreciation", { plain: "Wear on what you own" }),
  expense("6510", "Loss on sale of equipment", { plain: "Sold for less than it was worth" }),
  expense("6950", "Exchange loss", { plain: "Lost on exchange rates" }),
  expense("6900", "Other expenses")
];

export const accountByCode = (code: string) => CHART.find((a) => a.code === code);
export const accountsOfType = (type: AccountType) => CHART.filter((a) => a.type === type);
export const cashAccounts = () => CHART.filter((a) => a.isCash);

/** The expense accounts a user picks from, in the order they are likely to need them. */
export const EXPENSE_CATEGORIES = CHART.filter((a) => a.type === "expense" && !["6120", "6960"].includes(a.code)).map((a) => ({ code: a.code, name: a.name }));
