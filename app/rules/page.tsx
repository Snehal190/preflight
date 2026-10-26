import Link from "next/link";
import { RULEBOOK, RULE_IDS } from "@/lib/reference/rulebook";

export const metadata = { title: "Rules · PreFlight" };

const LEVELS = [
  { badge: "Must fix", cls: "bg-bad text-white", text: "The shipment would be held or refused. You can't continue until it's fixed." },
  { badge: "Please check", cls: "bg-warn text-white", text: "A real risk. Fix it, or tick “I understand this risk” to continue." },
  { badge: "Question for you", cls: "bg-accent text-ink border border-ink", text: "We can't tell from what you gave us — answer yes or no." },
  { badge: "Missing info", cls: "bg-ink text-white", text: "A value is blank or can't be read, so the check can't run yet." },
  { badge: "Advice", cls: "bg-note text-white", text: "Worth a look, but it never blocks your booking." },
];

export default function RulesPage() {
  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h1 className="text-6xl sm:text-7xl">
          The <span className="hl">10 rules</span>
        </h1>
        <p className="max-w-2xl text-lg text-ink/70">
          Every booking is checked against the same ten rules, every time. Here&apos;s what each one means and why it matters.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-3xl">What the labels mean</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LEVELS.map((l) => (
            <li key={l.badge} className="card p-4 space-y-2">
              <span className={`badge ${l.cls}`}>{l.badge}</span>
              <p className="text-sm text-ink/75">{l.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-3xl">The rules</h2>
        <ol className="grid gap-4 md:grid-cols-2">
          {RULE_IDS.map((id, i) => {
            const r = RULEBOOK[id];
            const must = r.severity === "red";
            return (
              <li key={id} className="card card-hover p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <span className="font-display text-4xl leading-none text-accent-ink/40">{String(i + 1).padStart(2, "0")}</span>
                    <h3 className="font-bold text-lg leading-tight">{r.plainName}</h3>
                  </div>
                  <span className={`badge ${must ? "bg-bad text-white" : "bg-warn text-white"}`}>{must ? "Must fix" : "Please check"}</span>
                </div>
                <p>{r.plainCheck}</p>
                <p className="text-sm text-ink/70">
                  <span className="font-semibold text-ink">Why it matters: </span>
                  {r.whyItMatters}
                </p>
                <p className="text-xs text-ink/50">
                  Rulebook {r.id}: {r.rule}.
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <p className="text-sm text-ink/60">
        Ready? <Link href="/chat" className="underline font-semibold">Speak or type a booking</Link> or <Link href="/upload" className="underline font-semibold">upload your sheets</Link>.
      </p>
    </div>
  );
}
