"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Booking } from "@/lib/types";
import { emptyState, type BookingState, type Evaluation } from "@/lib/booking/state";
import { londonToday } from "@/lib/dates/today";
import { fmtDateLong, fmtGBP, fmtNum } from "@/lib/format";
import { PRESETS, presetBooking } from "@/lib/stage/presets";
import { checkSequence, fieldFlags, isPacked, STATE_LABEL, type StageStep, type StepState } from "@/lib/stage/sequence";
import { fixAll } from "@/lib/stage/fixAll";
import { postJson, saveBatch } from "@/lib/client/store";
import { ParcelScene, type ParcelTag } from "@/app/components/three/ParcelScene";
import { BandScene, type Journey } from "@/app/components/three/BandScene";

const STEP_MS = 650;

const PILL: Record<StepState | "checking" | "idle", string> = {
  idle: "bg-mist text-ink-3",
  checking: "bg-accent-soft text-accent",
  pass: "bg-good-soft text-good",
  na: "bg-mist text-ink-3",
  amber: "bg-warn-soft text-warn",
  fail: "bg-bad-soft text-bad",
  missing: "bg-bad-soft text-bad",
  question: "bg-accent-soft text-steel",
};
const DOT: Record<StepState | "checking" | "pending", string> = {
  pending: "bg-line",
  checking: "bg-accent scale-y-150",
  pass: "bg-good",
  na: "bg-ink-3",
  amber: "bg-warn",
  fail: "bg-bad scale-y-150",
  missing: "bg-bad scale-y-150",
  question: "bg-steel",
};

/** Short tag text for the 3D tags. */
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

export default function Home() {
  const router = useRouter();
  const [today, setToday] = useState<string | null>(null);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [steps, setSteps] = useState<StageStep[] | null>(null);
  const [active, setActive] = useState(-1); // index being checked; 10 = done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixed, setFixed] = useState<string[] | null>(null);
  const stateRef = useRef<BookingState>(emptyState());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setToday(londonToday()), []);
  useEffect(() => {
    if (!today) return;
    if (timer.current) clearTimeout(timer.current);
    setBooking(presetBooking(presetId, today));
    setEvaluation(null);
    setSteps(null);
    setActive(-1);
    setFixed(null);
    stateRef.current = emptyState();
  }, [presetId, today]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const run = useCallback(
    async (b: Booking) => {
      if (timer.current) clearTimeout(timer.current);
      setBusy(true);
      setError(null);
      setSteps(null);
      setActive(-1);
      try {
        const r = await postJson<{ state: BookingState; evaluation: Evaluation }>("/api/evaluate", { booking: b, state: stateRef.current });
        stateRef.current = r.state;
        setEvaluation(r.evaluation);
        const seq = checkSequence(r.evaluation.results);
        setSteps(seq);
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) {
          setActive(10);
          return;
        }
        let i = 0;
        setActive(0);
        const tick = () => {
          i += 1;
          setActive(i);
          if (i < 10) timer.current = setTimeout(tick, STEP_MS);
        };
        timer.current = setTimeout(tick, STEP_MS);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't run the checks.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  function onFixAll() {
    if (!booking || !today) return;
    const out = fixAll(booking, { today });
    setFixed(out.applied);
    if (out.applied.length) {
      setBooking(out.booking);
      void run(out.booking);
    }
  }

  function openFullCheck() {
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
    router.push(`/batch/${id}/${encodeURIComponent(booking.key)}`);
  }

  const done = active >= 10 && steps !== null;
  const current = steps && active >= 0 && active < 10 ? steps[active] : null;
  const shown = current ?? (done ? null : null);
  const packed = steps ? steps.slice(0, Math.max(0, Math.min(active, 10))).filter((s) => isPacked(s.state)).length : 0;
  const tags: ParcelTag[] = useMemo(
    () =>
      (steps ?? []).map((s, i) => ({
        name: TAG_NAME[s.ruleId] ?? s.name,
        state: i < active ? s.state : i === active ? "checking" : "pending",
      })),
    [steps, active],
  );
  const flags = done && evaluation ? fieldFlags(evaluation.results) : {};
  const journey: Journey = !steps ? "idle" : !done ? "running" : evaluation?.status === "ready" ? "ready" : "blocked";
  const progress = steps ? Math.min(active, 10) / 10 : 0;
  const problems = done && evaluation ? evaluation.results.filter((r) => !r.nonBlocking && r.severity !== "info" && r.status !== "pass" && r.status !== "not_applicable") : [];
  const c = evaluation?.carrier;
  const costs = c?.rows.map((r) => Number(r.totalCost ?? r.pricePerPallet ?? 0)) ?? [];
  const maxCost = Math.max(1, ...costs);
  const b = booking;
  const it = b?.items[0];
  const label = b?.bookingId.value ?? "BK";

  const kv: [string, string, string?][] = b
    ? [
        ["Route", `${b.originCity.value} → ${b.destinationCity.value}`],
        ["Ready", b.readyDate.value ? fmtDateLong(b.readyDate.value) : "—", flags.readyDate],
        ["Pallets", fmtNum(b.pallets.value ?? 0), flags.pallets],
        ["Boxes", fmtNum(b.cartons.value ?? 0), flags.cartons],
        ["Value", b.declaredValue.value ? fmtGBP(b.declaredValue.value) : "—", flags.declaredValue],
        ["Weight", b.grossWeightKg.value ? `${fmtNum(b.grossWeightKg.value)} kg` : "—", flags.grossWeightKg],
        ["Priority", b.priority.value ?? "—"],
        ["Going to", b.destinationType.value === "Warehouse" ? `Warehouse · slot ${b.appointmentBooked.value === "Yes" ? "booked" : "not booked"}` : "Business address", flags.appointmentBooked],
        ["Product", it ? `${fmtNum(it.quantity.value ?? 0)} × ${it.description.value}${b.items.length > 1 ? ` +${b.items.length - 1}` : ""}` : "—", flags.quantity ?? flags.description],
        ["HS code", b.items.map((x) => x.hsCode.value ?? "—").join(", "), flags.hsCode],
      ]
    : [];

  return (
    <div className="-mx-4 sm:-mx-5 -my-6 flex flex-col lg:h-[calc(100dvh-3.5rem)]">
      <div className="grid flex-1 min-h-0 gap-4 px-4 sm:px-5 py-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,2fr)]">
        {/* Left: pitch + booking */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-hidden">
          <div>
            <p className="eyebrow">UK → Germany · France · Netherlands</p>
            <h1 className="mt-1.5 mb-1 text-[34px]">Check your shipment before it leaves.</h1>
            <p className="text-ink-2">Ten customs and carrier checks, in plain words, before anything is booked.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/chat" className="btn">💬 Speak or type</Link>
              <Link href="/upload" className="btn btn-ghost">⬆ Upload sheets</Link>
            </div>
          </div>

          <div className="card flex min-h-[320px] flex-1 flex-col gap-2.5 overflow-y-auto p-4 lg:min-h-0">
            <div className="flex items-center justify-between gap-2">
              <b className="truncate text-base">{label}</b>
              <select
                aria-label="Sample booking"
                className="max-w-[60%] rounded-lg border border-line bg-paper px-2 py-1.5 text-[12.5px] font-semibold"
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              {kv.map(([k, v, flag]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className={`mono truncate text-right font-semibold ${flag === "bad" ? "text-bad" : flag === "warn" ? "text-warn" : ""}`}>{v}</dd>
                </div>
              ))}
            </dl>

            {done && evaluation && (
              <div
                className={`card grid gap-1 border-l-4 bg-mist p-3 shadow-none ${evaluation.status === "ready" ? "border-l-good" : evaluation.status === "check" ? "border-l-warn" : "border-l-bad"}`}
                style={{ animation: "pop .25s ease-out" }}
                aria-live="polite"
              >
                <span className={`mono text-[10.5px] font-bold tracking-widest ${evaluation.status === "ready" ? "text-good" : evaluation.status === "check" ? "text-warn" : "text-bad"}`}>
                  {evaluation.status === "ready" ? "READY FOR TAKE-OFF" : evaluation.headline.toUpperCase()}
                </span>
                {problems.slice(0, 3).map((r) => (
                  <p key={r.id} className="text-[12px] leading-snug text-ink-2">
                    <b className="text-ink">{r.title}:</b> {r.found}
                  </p>
                ))}
                {problems.length > 3 && <p className="text-[12px] text-ink-3">+{problems.length - 3} more on the full check</p>}
                {fixed && (
                  <p className="text-[12px] text-good">{fixed.length ? `Fixed: ${fixed.join("; ")}.` : "No number fixes we can prove — these need your action."}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button type="button" className="btn btn-ghost py-1 text-xs" onClick={openFullCheck}>Open full check →</button>
                </div>
              </div>
            )}
            {error && <p role="alert" className="text-sm font-semibold text-bad">{error}</p>}

            <div className="sticky bottom-0 mt-auto flex gap-2 bg-paper pt-1">
              <button type="button" className="btn flex-1" disabled={!b || busy || (steps !== null && !done)} onClick={() => b && run(b)}>
                ▶ {steps ? "Run again" : "Run checks"}
              </button>
              <button type="button" className="btn btn-ghost flex-1" disabled={!done || busy || evaluation?.status === "ready"} onClick={onFixAll}>
                ✓ Fix all
              </button>
            </div>
          </div>
        </div>

        {/* Right: the stage */}
        <div className="card relative flex min-w-0 flex-col overflow-hidden lg:block lg:min-h-[420px]" style={{ background: "radial-gradient(70% 90% at 70% 92%, var(--surface-2), var(--surface) 70%)" }}>
          {/* Phones: the parcel sits below the text. Desktop: behind it, to the right. */}
          <div className="relative order-last h-[260px] lg:absolute lg:inset-0 lg:left-[300px] lg:h-auto">
            <ParcelScene tags={tags} label={label} />
          </div>
          <span className={`badge absolute right-4 top-4 z-10 ${done ? PILL[evaluation?.status === "ready" ? "pass" : evaluation?.status === "check" ? "amber" : "fail"] : steps ? PILL.checking : PILL.idle}`}>
            {done ? (evaluation?.status === "ready" ? "READY" : evaluation?.status === "check" ? "CHECK" : "BLOCKED") : steps ? "CHECKING" : "WAITING"}
          </span>
          <div className="relative z-10 flex flex-col gap-2.5 p-5 lg:h-full lg:max-w-[330px]">
            <span className="eyebrow">{done ? "Checks complete" : steps ? "Now checking" : "Ready when you are"}</span>
            <div className="text-[30px] font-extrabold leading-tight tracking-tight">
              {shown ? shown.name : done ? (evaluation?.status === "ready" ? "All clear" : evaluation?.headline) : "Press Run checks"}
            </div>
            <div className="mono min-h-[38px] text-[12.5px] leading-normal text-ink-2">
              {shown ? (active < 10 && steps ? "Reading the booking…" : shown.detail) : done ? `${packed} of 10 checks passed or only need a look.` : "We'll check the booking against all 10 rules, one by one."}
            </div>
            <span className={`badge self-start ${shown ? PILL.checking : done ? PILL[evaluation?.status === "ready" ? "pass" : "fail"] : PILL.idle}`}>
              {shown ? "CHECKING" : done ? (evaluation?.status === "ready" ? "PASS" : "NEEDS FIXING") : "IDLE"}
            </span>
            <div className="flex items-center gap-1.5" aria-label="Check progress">
              {Array.from({ length: 10 }, (_, i) => {
                const st = steps ? (i < active ? steps[i].state : i === active ? "checking" : "pending") : "pending";
                return <b key={i} className={`h-2 w-[22px] rounded transition-all duration-200 ${DOT[st]}`} title={steps ? `${steps[i].name}: ${st === "checking" ? "checking" : st === "pending" ? "waiting" : STATE_LABEL[st as StepState]}` : undefined} />;
              })}
            </div>
            <p className="text-[13px] text-ink-2">
              <b className="text-ink">{packed}</b> of 10 checks packed in the box
            </p>
            <div className="grid gap-1 rounded-xl border border-line bg-mist p-3">
              <span className="eyebrow text-ink-3!">Why it matters</span>
              <p className="text-[13.5px]">{shown ? shown.why : done && problems[0] ? problems[0].whyItMatters || "Fix it before you book." : "Customs or the warehouse will hold or reject goods that don't add up."}</p>
            </div>

            {c && done && (
              <div className="card mt-auto grid gap-1.5 p-3 shadow-none" style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)" }}>
                <span className="eyebrow">Carrier · {c.priority ?? "—"}</span>
                {c.rows.map((r, i) => {
                  const best = r.id === c.chosen;
                  const out = r.eligible === false;
                  return (
                    <div key={r.id} className={`grid grid-cols-[1fr_60px_56px] items-center gap-2 text-[12.5px] ${best ? "font-bold" : ""} ${out ? "text-ink-3 line-through" : ""}`} title={r.excludedReason ?? undefined}>
                      <span>{r.name} · {r.transitDays}d</span>
                      <span className={`h-1.5 rounded origin-left ${best ? "bg-accent" : "bg-ink-3/40"}`} style={{ transform: `scaleX(${costs[i] / maxCost})` }} />
                      <span className="mono text-right">{r.totalCost ? fmtGBP(r.totalCost) : "—"}</span>
                    </div>
                  );
                })}
                {evaluation?.dates && <span className="mono text-[11.5px] text-ink-2">Est. delivery {fmtDateLong(evaluation.dates.delivery)} · working days</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom: road + sea */}
      <div className="relative h-[200px] lg:h-[220px] shrink-0 border-t border-line" style={{ background: "linear-gradient(180deg,#b9cde0,#dfe8f0)" }}>
        <BandScene progress={progress} journey={journey} label={label} />
        <div className="pointer-events-none absolute inset-x-4 top-3 z-10 flex flex-wrap justify-between gap-2">
          <span className="mono rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-[#0f1b2d] shadow">
            {b?.originCity.value} depot · {journey === "idle" ? "waiting" : journey === "running" ? "checking" : journey === "ready" ? "cleared to leave" : "held — needs fixing"}
          </span>
          <span className="mono rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-[#0f1b2d] shadow">
            {b?.originCity.value} → Channel crossing → {b?.destinationCity.value}
          </span>
        </div>
      </div>
    </div>
  );
}
