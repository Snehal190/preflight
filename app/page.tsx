"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Booking } from "@/lib/types";
import type { CarrierId } from "@/lib/reference/carriers";
import { emptyState, type BookingState, type Evaluation } from "@/lib/booking/state";
import { londonToday } from "@/lib/dates/today";
import { fmtDateLong, fmtGBP, fmtNum } from "@/lib/format";
import { PRESETS, presetBooking } from "@/lib/stage/presets";
import { checkSequence, fieldFlags, isPacked, type StageStep, type StepState } from "@/lib/stage/sequence";
import { flapsClosed } from "@/lib/stage/flaps";
import { fixAll } from "@/lib/stage/fixAll";
import { carrierStory } from "@/lib/stage/carrierStory";
import { postJson, saveBatch } from "@/lib/client/store";
import { DepotScene, type DepotTag } from "@/app/components/three/DepotScene";

const STEP_MS = 750;

const DOT: Record<StepState | "checking" | "pending", string> = {
  pending: "bg-line",
  checking: "bg-accent scale-y-150",
  pass: "bg-good",
  na: "bg-ink-3",
  amber: "bg-warn",
  fail: "bg-bad scale-y-150",
  missing: "bg-bad scale-y-150",
  question: "bg-ink-2 text-paper",
};

const TAG_NAME: Record<string, string> = {
  "R-01": "Customs code",
  "R-02": "Declared value",
  "R-03": "Units × boxes",
  "R-04": "Box count",
  "R-05": "Pallet weight",
  "R-06": "Dangerous goods",
  "R-07": "Total weight",
  "R-08": "Delivery slot",
  "R-09": "Made in",
  "R-10": "Ready date",
};

const STEPS = [
  { n: "01", title: "Tell us", text: "Speak or type your shipment, or upload your Bookings and Items sheets." },
  { n: "02", title: "We check", text: "Ten customs and carrier rules, in plain words. We show which number is wrong and what it should be." },
  { n: "03", title: "Approve and go", text: "Fix or accept each issue, approve the carrier we recommend, and your booking request is ready." },
];

type Phase = "idle" | "checking" | "done" | "departing";

export default function Home() {
  const router = useRouter();
  const [today, setToday] = useState<string | null>(null);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [steps, setSteps] = useState<StageStep[] | null>(null);
  const [active, setActive] = useState(-1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixed, setFixed] = useState<string[] | null>(null);
  const stateRef = useRef<BookingState>(emptyState());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => setToday(londonToday()), []);
  useEffect(() => {
    if (!today) return;
    if (timer.current) clearTimeout(timer.current);
    setBooking(presetBooking(presetId, today));
    setEvaluation(null);
    setSteps(null);
    setActive(-1);
    setPhase("idle");
    setFixed(null);
    stateRef.current = emptyState();
  }, [presetId, today]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const evaluate = useCallback(async (b: Booking) => {
    const r = await postJson<{ state: BookingState; evaluation: Evaluation }>("/api/evaluate", { booking: b, state: stateRef.current });
    stateRef.current = r.state;
    setEvaluation(r.evaluation);
    return r.evaluation;
  }, []);

  const run = useCallback(
    async (b: Booking) => {
      if (timer.current) clearTimeout(timer.current);
      setBusy(true);
      setError(null);
      setSteps(null);
      setActive(-1);
      setPhase("checking");
      try {
        const ev = await evaluate(b);
        setSteps(checkSequence(ev.results));
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setActive(10);
          setPhase("done");
          return;
        }
        let i = 0;
        setActive(0);
        const tick = () => {
          i += 1;
          setActive(i);
          if (i < 10) timer.current = setTimeout(tick, STEP_MS);
          else {
            setPhase("done");
            timer.current = setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 900);
          }
        };
        timer.current = setTimeout(tick, STEP_MS);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't run the checks.");
        setPhase("idle");
      } finally {
        setBusy(false);
      }
    },
    [evaluate],
  );

  function onFixAll() {
    if (!booking || !today) return;
    const out = fixAll(booking, { today });
    setFixed(out.applied);
    if (out.applied.length) {
      setBooking(out.booking);
      document.getElementById("try")?.scrollIntoView({ behavior: "smooth" });
      void run(out.booking);
    }
  }

  async function chooseCarrier(id: CarrierId) {
    if (!booking || !evaluation) return;
    stateRef.current = { ...stateRef.current, chosenCarrierId: id === evaluation.carrier.recommended ? null : id };
    setBusy(true);
    try {
      await evaluate(booking);
    } finally {
      setBusy(false);
    }
  }

  function saveAndGo(suffix: "" | "/takeoff") {
    if (!booking || !evaluation) return;
    const id = `demo-${booking.key}-${Date.now().toString(36)}`;
    const at = new Date().toISOString();
    saveBatch({
      id,
      createdAt: at,
      files: [],
      warnings: [],
      bookings: [{ key: booking.key, label: booking.bookingId.value ?? booking.key, booking, state: stateRef.current, evaluation, versions: [{ n: 1, at, booking, state: stateRef.current, chips: [], cause: "Sample booking" }] }],
    });
    router.push(`/batch/${id}/${encodeURIComponent(booking.key)}${suffix}`);
  }

  const done = phase === "done" || phase === "departing";
  const current = steps && active >= 0 && active < 10 ? steps[active] : null;
  const packed = steps ? steps.slice(0, Math.max(0, Math.min(active, 10))).filter((s) => isPacked(s.state)).length : 0;
  const tags: DepotTag[] = useMemo(
    () => (steps ?? []).map((s, i) => ({ name: TAG_NAME[s.ruleId] ?? s.name, state: i < active ? s.state : i === active ? "checking" : "pending" })),
    [steps, active],
  );
  const flags = done && evaluation ? fieldFlags(evaluation.results) : {};
  const problems = done && evaluation ? evaluation.results.filter((r) => !r.nonBlocking && r.severity !== "info" && r.status !== "pass" && r.status !== "not_applicable") : [];
  const ready = evaluation?.status === "ready";
  const c = evaluation?.carrier;
  const chosen = c?.rows.find((r) => r.id === c.chosen) ?? null;
  const maxCost = Math.max(1, ...(c?.rows.map((r) => Number(r.totalCost ?? r.pricePerPallet ?? 0)) ?? [1]));
  const b = booking;
  const label = b?.bookingId.value ?? "BK";
  const destination = b?.destinationCity.value ?? "";

  const kv: [string, string, string?][] = b
    ? [
        ["Seller", b.sellerName.value ?? "—"],
        ["Route", `${b.originCity.value} → ${b.destinationCity.value}`],
        ["Ready to ship", b.readyDate.value ? fmtDateLong(b.readyDate.value) : "—", flags.readyDate],
        ["Pallets", fmtNum(b.pallets.value ?? 0), flags.pallets],
        ["Boxes", fmtNum(b.cartons.value ?? 0), flags.cartons],
        ["Declared value", b.declaredValue.value ? fmtGBP(b.declaredValue.value) : "—", flags.declaredValue],
        ["Total weight", b.grossWeightKg.value ? `${fmtNum(b.grossWeightKg.value)} kg` : "—", flags.grossWeightKg],
        ["Priority", b.priority.value ?? "—"],
        ["Delivering to", b.destinationType.value === "Warehouse" ? `Warehouse · slot ${b.appointmentBooked.value === "Yes" ? "booked" : "not booked"}` : "Business address", flags.appointmentBooked],
      ]
    : [];

  return (
    <div className="space-y-20 pb-16">
      {/* Hero */}
      <section className="grid items-center gap-10 pt-8 lg:grid-cols-[1.1fr_0.9fr] lg:pt-14">
        <div className="space-y-6">
          <p className="eyebrow">UK → Germany · France · Netherlands</p>
          <h1 className="text-[44px] leading-[1.02] sm:text-[60px]">
            Check your shipment
            <br />
            before it leaves.
          </h1>
          <p className="max-w-xl text-lg text-ink-2">
            PreFlight checks your pallet booking against ten customs and carrier rules, shows exactly what to fix, and recommends the right carrier — before anything is booked.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/chat" className="btn px-5 py-3 text-[15px]">💬 Speak or type a booking</Link>
            <Link href="/upload" className="btn btn-ghost px-5 py-3 text-[15px]">⬆ Upload sheets</Link>
            <a href="#try" className="btn btn-ghost px-5 py-3 text-[15px]">▶ Try a sample</a>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {[
            ["10", "rules checked on every booking"],
            ["3", "carriers compared on price, speed and reliability"],
            ["0", "rule codes to learn — everything in plain words"],
          ].map(([n, t]) => (
            <li key={t} className="card flex items-center gap-4 p-5">
              <span className="mono grid h-12 min-w-12 place-items-center rounded-xl bg-accent px-2 text-2xl font-bold text-black">{n}</span>
              <span className="text-ink-2">{t}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Try it */}
      <section id="try" className="scroll-mt-20 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="eyebrow">Try it</p>
            <h2 className="text-[32px] sm:text-[40px]">Watch a booking get checked</h2>
            <p className="max-w-xl text-ink-2">Pick a sample. Each rule goes into the box on the lorry, and a flap closes as the checks pass. The lorry only leaves once you approve the carrier.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Sample booking"
              className="rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              disabled={phase === "checking" || phase === "departing"}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <button type="button" className="btn px-5 py-2.5" disabled={!b || busy || phase === "checking" || phase === "departing"} onClick={() => b && run(b)}>
              ▶ {steps ? "Run again" : "Run checks"}
            </button>
            <button type="button" className="btn btn-ghost px-5 py-2.5" disabled={!done || busy || ready || phase === "departing"} onClick={onFixAll}>
              ✓ Fix all
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="card space-y-4 p-6">
            <div className="flex items-baseline justify-between">
              <b className="text-xl tracking-tight">{label}</b>
              <span className="eyebrow text-ink-3!">Booking</span>
            </div>
            <dl className="space-y-2.5 text-[13.5px]">
              {kv.map(([k, v, flag]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-b border-dashed border-line pb-2.5 last:border-0">
                  <dt className="shrink-0 text-ink-3">{k}</dt>
                  <dd className={`mono text-right font-semibold ${flag === "bad" ? "text-bad" : flag === "warn" ? "text-warn" : ""}`}>{v}</dd>
                </div>
              ))}
            </dl>
            {b && (
              <div className="space-y-2 rounded-xl bg-mist p-4">
                <span className="eyebrow text-ink-3!">Products</span>
                {b.items.map((it) => (
                  <p key={it.itemId} className="text-[13px] leading-snug">
                    <b>{it.description.value}</b>
                    <span className={`mono block text-[12px] ${flags.quantity || flags.hsCode ? "text-bad" : "text-ink-3"}`}>
                      {fmtNum(it.quantity.value ?? 0)} units · {fmtNum(it.unitsPerCarton.value ?? 0)}/box · {fmtNum(it.cartons.value ?? 0)} boxes · HS {it.hsCode.value ?? "—"}
                    </span>
                  </p>
                ))}
              </div>
            )}
            {error && <p role="alert" className="text-sm font-semibold text-bad">{error}</p>}
          </div>

          <div className="card relative h-[460px] overflow-hidden sm:h-[560px]">
            <DepotScene tags={tags} departing={phase === "departing"} label={label} />
            <div className="absolute left-4 top-4 z-10 w-[min(330px,calc(100%-2rem))] space-y-2.5 rounded-2xl border border-white/60 bg-paper/85 p-4 shadow-lg backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{phase === "departing" ? "On its way" : done ? "Checks complete" : steps ? "Now checking" : "Ready when you are"}</span>
                <span className="mono text-xs text-ink-3">{packed}/10 in the box</span>
              </div>
              <div className="text-[22px] font-extrabold leading-tight tracking-tight">
                {current ? current.name : done ? (ready ? "All checks passed" : evaluation?.headline) : "Press Run checks"}
              </div>
              <p className="mono min-h-[34px] text-[12px] leading-normal text-ink-2">
                {current
                  ? "Reading the booking…"
                  : done
                    ? ready
                      ? phase === "departing"
                        ? "Sealed, approved and sailing."
                        : "The box is sealed. Approve the carrier below to send it on its way."
                      : "The box can't close until these are fixed — see below."
                    : "Each rule is checked and dropped into the box on the lorry."}
              </p>
              <div className="flex items-center gap-1.5" aria-label="Check progress">
                {Array.from({ length: 10 }, (_, i) => {
                  const st = steps ? (i < active ? steps[i].state : i === active ? "checking" : "pending") : "pending";
                  return <b key={i} className={`h-2 flex-1 rounded transition-all duration-200 ${DOT[st]}`} title={steps?.[i].name} />;
                })}
              </div>
              <p className="text-[12px] text-ink-3">
                Flaps closed: {flapsClosed(packed)} of 4{packed === 10 ? " · taped shut" : ""}
              </p>
            </div>
            {current && (
              <div className="absolute bottom-4 left-4 z-10 max-w-[360px] rounded-2xl border border-white/60 bg-paper/85 p-4 shadow-lg backdrop-blur-md" style={{ animation: "pop .25s ease-out" }}>
                <span className="eyebrow text-ink-3!">Why it matters</span>
                <p className="mt-1 text-[13.5px]">{current.why}</p>
              </div>
            )}
            {phase === "departing" && (
              <div className="absolute inset-x-4 bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-good px-5 py-4 text-white shadow-lg" style={{ animation: "pop .4s ease-out" }}>
                <div>
                  <p className="text-lg font-extrabold">✓ All checks passed — on its way to {destination}</p>
                  <p className="text-sm text-white/85">Booking request ready for take-off with {chosen?.name}. Nothing has been sent to a carrier yet.</p>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => saveAndGo("/takeoff")}>See take-off summary →</button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Results: problems, then the carrier recommendation */}
      {done && evaluation && c && (
        <section ref={resultsRef} className="scroll-mt-20 space-y-6">
          {!ready && (
            <div className="card space-y-5 border-l-4 border-l-bad p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="eyebrow text-bad!">Before it can leave</p>
                  <h2 className="text-[28px]">{evaluation.headline}</h2>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn" onClick={onFixAll} disabled={busy}>✓ Fix all I can</button>
                  <button type="button" className="btn btn-ghost" onClick={() => saveAndGo("")}>Open full check →</button>
                </div>
              </div>
              <ul className="grid gap-3 md:grid-cols-2">
                {problems.map((r) => (
                  <li key={r.id} className="rounded-xl border border-line bg-mist p-4">
                    <p className="font-bold">{r.title}</p>
                    <p className="mt-1 text-[13.5px] text-ink-2">{r.found}</p>
                    {(r.fix.tested?.[0]?.summary ?? r.fix.text) && (
                      <p className="mt-2 text-[13px]">
                        <b>Fix: </b>
                        {r.fix.tested?.[0]?.summary ?? r.fix.text}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {fixed && <p className="text-sm text-good">{fixed.length ? `Fixed: ${fixed.join("; ")}.` : "There's no number fix we can prove for these — they need your action on the full check."}</p>}
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-6 p-6 sm:p-10">
                <div className="space-y-2">
                  <p className="eyebrow">{ready ? "Our recommendation" : "Provisional — final once everything is fixed"}</p>
                  <h2 className="text-[34px] sm:text-[44px]">
                    {chosen ? (
                      <>
                        {chosen.name} <span className="text-ink-3">· {chosen.service}</span>
                      </>
                    ) : c.noneEligible ? (
                      "No carrier can take this load as packed"
                    ) : (
                      "No carrier yet"
                    )}
                  </h2>
                </div>
                {chosen && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Total", chosen.totalCost ? fmtGBP(chosen.totalCost) : "—"],
                      ["Transit", `${chosen.transitDays} working days`],
                      ["On time", `${chosen.onTimePct}%`],
                      ["Delivery", evaluation.dates ? fmtDateLong(evaluation.dates.delivery) : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-xl bg-mist p-4">
                        <p className="eyebrow text-ink-3!">{k}</p>
                        <p className="mt-1 text-lg font-bold tracking-tight">{v}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-3">
                  <h3 className="text-lg">Why this carrier</h3>
                  {c.reason && (
                    <p className="text-[17px] font-semibold">
                      {c.reason}
                      {c.chosenIsManual ? " You picked this one yourself." : ""}
                    </p>
                  )}
                  {carrierStory(c, evaluation.dates).map((line) => (
                    <p key={line} className="text-ink-2">{line}</p>
                  ))}
                  {c.balanced?.marginal.map((m) => (
                    <p key={m} className="text-ink-2">{m}</p>
                  ))}
                  {c.balanced && <p className="text-ink-2">Confidence: {c.balanced.confidenceText}</p>}
                  {c.netWeightNote && <p className="text-ink-2">{c.netWeightNote}</p>}
                  {c.alternative && (
                    <p className="text-ink-2">
                      <b className="text-ink">Alternative: </b>
                      {c.alternative}
                    </p>
                  )}
                  {evaluation.dates && (
                    <p className="text-sm text-ink-3">
                      Collection {fmtDateLong(evaluation.dates.collection)}. <b>ASSUMPTION:</b> transit counts working days (Mon–Fri, excluding public holidays).
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    className="btn px-6 py-3 text-[15px]"
                    disabled={!ready || !chosen || busy || phase === "departing"}
                    onClick={() => {
                      setPhase("departing");
                      document.getElementById("try")?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    {phase === "departing" ? "✓ Approved" : `Approve ${chosen?.name ?? "carrier"} and send it on its way`}
                  </button>
                  {!ready && <span className="text-sm text-ink-3">Fix the issues above first — the lorry can&apos;t leave with an open box.</span>}
                </div>
              </div>

              <div className="space-y-3 border-t border-line bg-mist p-6 sm:p-10 lg:border-l lg:border-t-0">
                <p className="eyebrow text-ink-3!">Compare carriers · priority {c.priority ?? "—"}</p>
                {c.rows.map((r) => {
                  const cost = Number(r.totalCost ?? r.pricePerPallet ?? 0);
                  const sel = r.id === c.chosen;
                  const out = r.eligible === false;
                  return (
                    <label
                      key={r.id}
                      className={`block rounded-xl border p-4 transition-colors ${sel ? "border-accent bg-paper shadow-sm" : "border-line bg-paper/60"} ${out ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                    >
                      <div className="flex items-center gap-3">
                        <input type="radio" name="carrier" checked={sel} disabled={out || busy || phase === "departing"} onChange={() => chooseCarrier(r.id)} />
                        <span className="flex-1 font-semibold">
                          {r.name} <span className="font-normal text-ink-3">· {r.service}</span>
                          {r.id === c.recommended && <span className="badge ml-2 bg-accent-soft text-accent-ink">Recommended</span>}
                        </span>
                        <span className="mono font-bold">{r.totalCost ? fmtGBP(r.totalCost) : "—"}</span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded bg-line">
                        <div className={`h-full rounded ${sel ? "bg-accent" : "bg-ink-3/50"}`} style={{ width: `${(cost / maxCost) * 100}%` }} />
                      </div>
                      <p className="mono mt-2 text-[12px] text-ink-2">
                        {r.transitDays} working days · {r.onTimePct}% on time · max {fmtNum(r.maxKgPerPallet)} kg per pallet
                      </p>
                      {out && r.excludedReason && <p className="mt-1 text-[12.5px] text-bad">Can&apos;t take it: {r.excludedReason}</p>}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="grid gap-10 md:grid-cols-[1fr_2fr]">
        <div className="space-y-2 self-start md:sticky md:top-24">
          <p className="eyebrow">How it works</p>
          <h2 className="text-[32px] sm:text-[40px]">Three steps, no surprises</h2>
        </div>
        <ol className="grid gap-5">
          {STEPS.map((s) => (
            <li key={s.n} className="card card-hover flex gap-6 p-6 sm:p-8">
              <span className="mono text-4xl font-bold text-accent-ink/40">{s.n}</span>
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
