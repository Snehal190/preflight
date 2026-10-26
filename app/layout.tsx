import type { Metadata } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "PreFlight",
  description: "Check a UK → EU pallet booking against the rulebook before it ships.",
};

const NAV = [
  { href: "/", label: "Check a shipment" },
  { href: "/chat", label: "Speak or type" },
  { href: "/upload", label: "Upload sheets" },
  { href: "/rules", label: "Rules" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-30 h-14 border-b border-line bg-paper flex items-center gap-6 px-4 sm:px-5">
          <Link href="/" className="flex items-center gap-2 text-[17px] font-extrabold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-black text-sm text-accent" aria-hidden>✓</span>
            PreFlight
          </Link>
          <nav aria-label="Main" className="hidden md:flex flex-1 items-center gap-5 font-medium text-ink-2">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
          <nav aria-label="Main (compact)" className="md:hidden flex flex-1 items-center gap-3 text-sm font-medium text-ink-2">
            <Link href="/chat">Speak</Link>
            <Link href="/upload">Upload</Link>
            <Link href="/rules">Rules</Link>
          </nav>
          <Link href="/chat" className="btn hidden sm:inline-flex">New booking</Link>
        </header>
        <main className="flex-1 w-full max-w-[1280px] mx-auto px-5 sm:px-8 py-6">{children}</main>
      </body>
    </html>
  );
}
