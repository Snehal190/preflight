import Link from "next/link";

const STEPS = [
  { n: "01", title: "Tell us", text: "Speak or type your shipment, or upload your Bookings and Items sheets." },
  { n: "02", title: "We verify", text: "Each of the ten rules drops into the box on the lorry, with a plain-English analysis of what's right, what's wrong and how to fix it." },
  { n: "03", title: "Choose and go", text: "Once everything passes, we recommend a carrier and explain why. Approve it and your booking request is ready." },
];

/** Landing: just the two ways in. Verification and the carrier come after the seller has spoken or uploaded. */
export default function Home() {
  return (
    <div className="space-y-24 pb-16">
      <section className="space-y-10 pt-10 lg:pt-16">
        <div className="max-w-3xl space-y-6">
          <p className="eyebrow">UK → Germany · France · Netherlands</p>
          <h1 className="text-[44px] leading-[1.02] sm:text-[64px]">
            Check your shipment
            <br />
            before it <span className="hl">leaves</span>.
          </h1>
          <p className="max-w-2xl text-lg text-ink-2">
            Tell us about your pallet booking. PreFlight checks it against ten customs and carrier rules, shows exactly what to fix, and recommends the right carrier — before anything is booked.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Link href="/chat" className="card card-hover group flex flex-col gap-5 p-8 sm:p-10">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-2xl" aria-hidden>
              🎙
            </span>
            <div className="space-y-2">
              <h2 className="text-[30px]">Speak or type</h2>
              <p className="text-ink-2">Describe your shipment in your own words. A checklist shows what to mention, and we ask only for what&apos;s missing.</p>
            </div>
            <span className="btn mt-auto self-start px-5 py-3 text-[15px]">Start →</span>
          </Link>
          <Link href="/upload" className="card card-hover group flex flex-col gap-5 p-8 sm:p-10">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-black text-2xl text-accent" aria-hidden>
              ⬆
            </span>
            <div className="space-y-2">
              <h2 className="text-[30px]">Upload your sheets</h2>
              <p className="text-ink-2">Bookings sheet and Items sheet — one workbook, two files, or CSVs. We check every booking in the file.</p>
            </div>
            <span className="btn btn-dark mt-auto self-start px-5 py-3 text-[15px]">Upload →</span>
          </Link>
        </div>
      </section>

      <section className="grid gap-10 md:grid-cols-[1fr_2fr]">
        <div className="space-y-2 self-start md:sticky md:top-24">
          <p className="eyebrow">How it works</p>
          <h2 className="text-[32px] sm:text-[40px]">Three steps, no surprises</h2>
          <p className="text-ink-2">
            Curious what we check? <Link href="/rules" className="font-semibold underline">See the 10 rules</Link>.
          </p>
        </div>
        <ol className="grid gap-5">
          {STEPS.map((s) => (
            <li key={s.n} className="card flex gap-6 p-6 sm:p-8">
              <span className="mono text-4xl font-bold text-ink-3/40">{s.n}</span>
              <div className="space-y-1">
                <h3 className="text-xl">{s.title}</h3>
                <p className="text-ink-2">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
