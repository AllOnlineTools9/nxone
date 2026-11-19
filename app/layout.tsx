import "@fontsource-variable/fraunces";
import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Analytics from "@/components/Analytics";
import ErrorReporter from "@/components/ErrorReporter";
import Offline from "@/components/Offline";
import { BRAND, SITE_URL } from "@/lib/config";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${BRAND.name} - Free Invoice Generator and Business Finance Tools`, template: `%s | ${BRAND.name}` },
  description: "Create invoices, quotations, purchase orders and receipts for any country, with the right tax format. Free, no sign-up needed, and your data stays yours.",
  applicationName: BRAND.name,
  // Each page names itself as the address to index, so a link with a query string or a
  // missing trailing slash does not count as a second copy. Pages can still set their own.
  alternates: { canonical: "./" },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }]
  },
  // Installed on a phone, it opens as its own app rather than a tab.
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black-translucent" }
};

export const viewport: Viewport = { themeColor: BRAND.themeColor, width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink">{children}<Offline /><Analytics /><ErrorReporter /></body>
    </html>
  );
}
