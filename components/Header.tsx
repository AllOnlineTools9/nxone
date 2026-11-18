import Link from "next/link";
import Logo from "./Logo";
import MobileNav from "./MobileNav";

const NAV = [
  { href: "/invoice-generator", label: "Invoice" },
  { href: "/quotation-generator", label: "Quotation" },
  { href: "/purchase-order-generator", label: "Purchase order" },
  { href: "/receipt-generator", label: "Receipt" },
  { href: "/calculators", label: "Calculators" },
  { href: "/guides", label: "Guides" },
  { href: "/pricing", label: "Pricing" }
];

export default function Header() {
  return (
    <header className="border-b border-line bg-canvas/90 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-lime focus:px-3 focus:py-2">Skip to content</a>
      <div className="wrap flex h-16 items-center gap-2 sm:gap-6">
        <Link href="/" aria-label="NXOne home"><Logo compact /></Link>
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1 text-sm font-medium">
            {NAV.map((n) => (
              <li key={n.href}><Link href={n.href} className="rounded-md px-3 py-2 text-ink-soft hover:bg-white hover:text-ink">{n.label}</Link></li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {/* For somebody coming back: the books live on their device, and signing in is how
              the same books appear on another one. */}
          <Link href="/sign-in/" className="btn-ghost whitespace-nowrap px-3 sm:px-4">Sign in</Link>
          <Link href="/invoice-generator" className="btn-primary whitespace-nowrap px-3 sm:px-4">
            <span className="sm:hidden">New invoice</span><span className="hidden sm:inline">Create an invoice</span>
          </Link>
          <MobileNav items={NAV} />
        </div>
      </div>
    </header>
  );
}
