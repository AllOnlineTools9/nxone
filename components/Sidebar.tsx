"use client";
import { BookOpen, Building2, CalendarClock, CalendarSync, Calculator, ChartColumn, FileSpreadsheet, FileText, FlaskConical, FolderOpen, HandCoins, Landmark, LayoutDashboard, MessageCircleQuestion, Quote, Package, Receipt, Search, ShoppingCart, Stamp, Sun, UsersRound, TrendingDown, Users, Wallet, X, ShieldCheck, Scissors, CalendarCheck, ClipboardList, Scale, Target, Hammer, History, Contact, Truck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import Logo from "./Logo";
import { useHydrated, useWorkspace } from "@/lib/store/useStore";
import EntitySwitcher from "./EntitySwitcher";

const GROUPS: Array<{ title: string; items: Array<{ href: string; label: string; icon: typeof FileText; soon?: boolean }> }> = [
  {
    title: "Overview",
    items: [
      { href: "/today", label: "Today", icon: Sun },
      { href: "/ask", label: "Ask", icon: MessageCircleQuestion },
      { href: "/dashboard", label: "Your money", icon: LayoutDashboard },
      { href: "/documents", label: "Documents", icon: FolderOpen },
      { href: "/customers", label: "Customers", icon: Contact },
      { href: "/receivables", label: "Owed to you", icon: HandCoins },
      { href: "/cash-flow", label: "Cash", icon: Wallet },
      { href: "/scenarios", label: "What if", icon: FlaskConical },
      { href: "/reports", label: "Reports", icon: ChartColumn },
      { href: "/budget", label: "Budget", icon: Target },
      { href: "/contracts", label: "Contracts", icon: Hammer },
      { href: "/compliance", label: "Filing calendar", icon: CalendarClock },
      { href: "/gst-returns", label: "GST returns", icon: FileSpreadsheet },
      { href: "/composition", label: "GST scheme", icon: Scale },
      { href: "/input-credit", label: "Input credit", icon: ShieldCheck },
      { href: "/tds", label: "TDS", icon: Scissors },
      { href: "/advance-tax", label: "Advance tax", icon: CalendarClock },
      { href: "/e-invoicing", label: "E-invoicing", icon: Stamp },
      { href: "/e-way-bills", label: "E-way bills", icon: Truck }
    ]
  },
  {
    title: "Money out",
    items: [
      { href: "/expenses", label: "Expenses", icon: TrendingDown },
      { href: "/orders", label: "Orders and bills", icon: ClipboardList },
      { href: "/payables", label: "What you owe", icon: Receipt },
      { href: "/stock", label: "Stock", icon: Package },
      { href: "/assets", label: "What you own", icon: Landmark },
      { href: "/payroll", label: "Payroll", icon: UsersRound },
      { href: "/claims", label: "Claims", icon: Wallet },
      { href: "/bank-import", label: "Bank statement", icon: Landmark },
      { href: "/books", label: "Accounts", icon: BookOpen },
      { href: "/year-end", label: "Year end", icon: CalendarCheck },
      { href: "/history", label: "History", icon: History }
    ]
  },
  {
    title: "Create",
    items: [
      { href: "/invoice-generator", label: "Invoice", icon: FileText },
      { href: "/quotation-generator", label: "Quotation", icon: Quote },
      { href: "/purchase-order-generator", label: "Purchase order", icon: ShoppingCart },
      { href: "/receipt-generator", label: "Receipt", icon: Receipt },
      { href: "/recurring", label: "Repeating", icon: CalendarSync }
    ]
  },
  {
    title: "Your business",
    items: [
      { href: "/settings", label: "Business details", icon: Building2 },
      { href: "/team", label: "People", icon: Users }
    ]
  },
  {
    title: "Work out",
    items: [
      { href: "/calculators", label: "Calculators", icon: Calculator },
      { href: "/hsn-code-finder", label: "HSN and SAC codes", icon: Search }
    ]
  }
];

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = usePathname();
  const [ws] = useWorkspace();
  // the profile lives in this browser, so the server cannot know it: wait for the first paint
  // before deciding, or the markup will not match and React will complain
  const hydrated = useHydrated();
  const setUp = !hydrated || Boolean(ws.profile?.name);
  // Close the drawer after moving to another page. Only the path is watched: the layout passes a
  // new onClose on every render, and watching it closed the menu the moment it opened on phones.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { close.current(); }, [path]);

  return (
    <>
      {open ? <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={onClose} aria-hidden="true" /> : null}
      <aside
        aria-label="Sections"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <Link href="/" aria-label="NXOne home"><Logo /></Link>
          <button type="button" className="rounded p-1 text-ink-faint hover:bg-canvas lg:hidden" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
        </div>

        <div className="border-b border-line px-3 py-2">
          <EntitySwitcher />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {!setUp ? (
            <Link href="/welcome/" className={`mb-5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold ${path === "/welcome" ? "bg-forest text-white" : "bg-forest-pale text-forest"}`}>
              Set up your business
            </Link>
          ) : null}
          {GROUPS.map((g) => (
            <div key={g.title} className="mb-6">
              <p className="mb-1 px-2 text-[0.68rem] font-semibold uppercase tracking-wider text-ink-faint">{g.title}</p>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const active = path === it.href;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.soon ? "#" : it.href}
                        aria-current={active ? "page" : undefined}
                        aria-disabled={it.soon}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium ${active ? "bg-forest text-white" : it.soon ? "cursor-not-allowed text-ink-faint" : "text-ink-soft hover:bg-canvas hover:text-ink"}`}
                      >
                        <it.icon size={16} aria-hidden="true" />
                        {it.label}
                        {it.soon ? <span className="ml-auto rounded bg-canvas px-1.5 py-0.5 text-[0.65rem] font-semibold text-ink-faint">Soon</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <p className="rounded-lg bg-forest-pale p-3 text-xs text-ink-soft">
            Worked out on this device. With an account, a copy is held for you and your devices stay in step.
          </p>
        </div>
      </aside>
    </>
  );
}
