import Link from "next/link";

const STEPS = [
  { n: "01", title: "Tell us", text: "Speak or type your shipment, or upload your Bookings and Items sheets." },
  { n: "02", title: "We check", text: "Ten customs and carrier rules, every time. We show exactly which number is wrong and what it should be." },
  { n: "03", title: "Take off", text: "Fix or accept each issue, pick a carrier, and get a booking request that's ready to go." },
];

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="grid-bg -mx-4 sm:-mx-8 px-4 sm:px-8 py-14 sm:py-20 rounded-b-3xl text-center space-y-6">
        <p className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1 text-xs font-bold uppercase tracking-widest">
          <span className="h-2 w-2 rounded-full bg-accent border border-ink/30" /> UK → Germany · France · Netherlands
        </p>
        <h1 className="text-6xl sm:text-8xl">
          Check it before
          <br />
          it <span className="hl">ships</span>
        </h1>
        <p className="mx-auto max-w-xl text-lg text-ink/70">
          Book a pallet shipment by voice or spreadsheet. PreFlight catches the mistakes that get shipments held — and tells you how to fix them.
        </p>
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <Link href="/chat" className="card card-hover p-7 space-y-4 bg-ink text-white border-ink">
          <span className="badge bg-accent text-ink">Voice or text</span>
          <h2 className="text-4xl">Speak or type</h2>
          <p className="text-white/75">Just say what you&apos;re sending. A checklist shows what to mention, and we only ask for what&apos;s missing.</p>
          <span className="btn">Start talking →</span>
        </Link>
        <Link href="/upload" className="card card-hover p-7 space-y-4 bg-mist">
          <span className="badge bg-paper border border-ink/15">Spreadsheets</span>
          <h2 className="text-4xl">Upload your sheets</h2>
          <p className="text-ink/70">Bookings sheet + Items sheet — one workbook, two files, or CSVs. Check hundreds of bookings at once.</p>
          <span className="btn">Upload →</span>
        </Link>
      </section>

      <section className="grid gap-10 md:grid-cols-[1fr_2fr]">
        <h2 className="text-5xl md:sticky md:top-24 self-start">How it works</h2>
        <ol className="space-y-8">
          {STEPS.map((s) => (
            <li key={s.n} className="group flex gap-6">
              <span className="font-display text-7xl leading-none text-accent-ink/30 group-hover:text-accent-ink transition-colors duration-300">{s.n}</span>
              <div className="space-y-1 pt-2">
                <h3 className="font-display text-2xl uppercase">{s.title}</h3>
                <p className="text-ink/70">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid md:grid-cols-2 overflow-hidden rounded-3xl">
        <div className="bg-ink text-white p-8 space-y-4">
          <h3 className="font-display text-3xl uppercase text-sage">The old way</h3>
          <ul className="space-y-3 text-white/70">
            {["A typo in a quantity gets the truck held at customs", "Overweight pallets refused at collection", "Batteries found in the load — shipment stopped"].map((t) => (
              <li key={t} className="flex gap-3"><span className="text-bad font-bold" aria-hidden>✕</span>{t}</li>
            ))}
          </ul>
        </div>
        <div className="bg-ink-2 text-white p-8 space-y-4 border-l-4 border-accent">
          <h3 className="font-display text-3xl uppercase text-accent">The PreFlight way</h3>
          <ul className="space-y-3">
            {["We spot the swapped digits and show the right number", "We pick a carrier that can take your pallet weight", "Dangerous goods flagged before anything is booked"].map((t) => (
              <li key={t} className="flex gap-3"><span className="text-accent font-bold" aria-hidden>✓</span>{t}</li>
            ))}
          </ul>
        </div>
      </section>

      <p className="text-sm text-ink/60">
        Want to know what we check? <Link href="/rules" className="underline font-semibold">See the 10 rules</Link>. Blank template download: waiting for the official template file.
      </p>
    </div>
  );
}
