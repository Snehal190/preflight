import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-5xl sm:text-7xl">Check it before it ships</h1>
        <p className="text-lg text-ink/70 max-w-xl">
          Book a UK → Germany, France or Netherlands pallet shipment. We check it against the rulebook, show you exactly what to fix, and
          recommend a carrier.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-ink/10 p-6 space-y-3 opacity-60">
          <h2 className="text-3xl">Talk or type to book</h2>
          <p>Describe your shipment by voice or text; we ask only for what&apos;s missing.</p>
          <p className="text-sm font-semibold">Coming next (build step 8).</p>
        </div>
        <Link href="/upload" className="rounded-xl border border-ink p-6 space-y-3 hover:bg-accent/30 transition-colors">
          <h2 className="text-3xl">Upload your sheets</h2>
          <p>Bookings sheet + Items sheet — one workbook, two files, or CSVs.</p>
          <span className="btn">Upload →</span>
        </Link>
      </section>

      <p className="text-sm text-ink/60">
        Blank template download: waiting for the official template file.
      </p>
    </div>
  );
}
