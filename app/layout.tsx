import type { Metadata } from "next";
import Link from "next/link";
import { Anton } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
// Satoshi (ITF Free Font License, self-hosted — see app/fonts/Satoshi-LICENSE.txt).
const satoshi = localFont({ src: "./fonts/Satoshi-Variable.woff2", variable: "--font-satoshi", weight: "300 900" });

export const metadata: Metadata = {
  title: "PreFlight",
  description: "Check a UK → EU pallet booking against the rulebook before it ships.",
};

const NAV = [
  { href: "/chat", label: "Speak or type" },
  { href: "/upload", label: "Upload sheets" },
  { href: "/rules", label: "Rules" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${anton.variable} ${satoshi.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-20 h-16 border-b border-ink/10 bg-paper/90 backdrop-blur flex items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/" className="font-display text-3xl uppercase leading-none">
            PreFlight<span className="text-accent-ink">.</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2 text-sm font-medium">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 hover:bg-ink/5">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-8">{children}</main>
        <footer className="border-t border-ink/10 px-4 sm:px-8 py-6 text-xs text-ink/60">
          PreFlight checks a booking request before it ships. Nothing is sent to a carrier.
        </footer>
      </body>
    </html>
  );
}
