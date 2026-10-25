import type { Metadata } from "next";
import Link from "next/link";
import { Anton } from "next/font/google";
import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });

export const metadata: Metadata = {
  title: "PreFlight",
  description: "Check a UK → EU pallet booking against the rulebook before it ships.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${anton.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="h-16 border-b border-ink/10 flex items-center px-4 sm:px-8">
          <Link href="/" className="font-display text-2xl uppercase tracking-normal">
            PreFlight<span className="text-accent-ink">.</span>
          </Link>
        </header>
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 py-8">{children}</main>
      </body>
    </html>
  );
}
