"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Evaluation } from "@/lib/booking/state";
import { checkSequence, isPacked, STATE_LABEL, type StepState } from "@/lib/stage/sequence";
import { DepotScene, type DepotTag } from "@/app/components/three/DepotScene";

const STEP_MS = 900;

const DOT: Record<StepState | "checking" | "pending", string> = {
  pending: "bg-line",
  checking: "bg-accent",
  pass: "bg-good",
  na: "bg-ink-3",
  amber: "bg-warn",
  fail: "bg-bad",
  missing: "bg-bad",
  question: "bg-ink-2",
};

const BADGE: Record<StepState, string> = {
  pass: "bg-good-soft text-good",
  na: "bg-mist text-ink-3",
  amber: "bg-warn-soft text-warn",
  fail: "bg-bad-soft text-bad",
  missing: "bg-bad-soft text-bad",
  question: "bg-accent-soft text-black",
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

/**
 * The verification screen: the lorry with the open box, and a deep analysis that fills in rule by
 * rule — what we found, the fix and why it matters. Replays whenever `runKey` changes.
 */
export function VerifyStage({
  evaluation,
  label,
  runKey,
  departing,
  onFinished,
  banner,
}: {
  evaluation: Evaluation;
  label: string;
  runKey: string;
  departing: boolean;
  onFinished?: () => void;
  banner?: React.ReactNode;
}) {
  const steps = useMemo(() => checkSequence(evaluation.results), [evaluation]);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setActive(10);
      finished.current?.();
      return;
    }
    let i = 0;
    setActive(0);
    const tick = () => {
      i += 1;
      setActive(i);
      if (i < 10) timer.current = setTimeout(tick, STEP_MS);
      else finished.current?.();
    };
    timer.current = setTimeout(tick, STEP_MS + 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runKey]);

  // Keep the newest rule in view by scrolling the panel only (never the page).
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-i="${Math.min(active, 9)}"]`);
    if (list && el) list.scrollTo({ top: el.offsetTop - list.offsetTop - 12, behavior: "smooth" });
  }, [active]);

  const done = active >= 10;
  const current = active >= 0 && active < 10 ? steps[active] : null;
  const packed = steps.slice(0, Math.max(0, Math.min(active, 10))).filter((s) => isPacked(s.state)).length;
  const tags: DepotTag[] = steps.map((s, i) => ({ name: TAG_NAME[s.ruleId] ?? s.name, state: i < active ? s.state : i === active ? "checking" : "pending" }));
  const ready = evaluation.status === "ready";
  const shown = steps.slice(0, Math.min(active + 1, 10));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="card relative h-[440px] overflow-hidden sm:h-[560px]">
        {/* The box only seals once the booking is ready: an unacknowledged "please check" keeps it open. */}
        <DepotScene tags={tags} done={done && ready} departing={departing} label={label} />
        <div className="absolute left-4 top-4 z-10 w-[min(320px,calc(100%-2rem))] space-y-2.5 rounded-2xl border border-white/60 bg-paper/90 p-4 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="eyebrow">{departing ? "On its way" : done ? "Verified" : "Verifying"}</span>
            <span className="mono text-xs text-ink-3">{packed}/10 in the box</span>
          </div>
          <div className="text-[21px] font-extrabold leading-tight tracking-tight">
            {current ? current.name : done ? (ready ? "All checks passed" : evaluation.headline) : "Getting ready…"}
          </div>
          <div className="flex items-center gap-1.5" aria-label="Check progress">
            {steps.map((s, i) => {
              const st = i < active ? s.state : i === active ? "checking" : "pending";
              return <b key={s.ruleId} className={`h-2 flex-1 rounded transition-colors duration-300 ${DOT[st]}`} title={s.name} />;
            })}
          </div>
          <p className="text-[12px] text-ink-3">{done ? (ready ? (departing ? "Sealed, approved and on its way." : "Box sealed, choose your carrier below.") : "The box stays open until everything is fixed.") : "The box stays open while each rule drops in."}</p>
        </div>
        {banner}
      </div>

      <div className="card flex max-h-[560px] flex-col overflow-hidden">
        <div className="border-b border-line p-5">
          <p className="eyebrow">Deep analysis</p>
          <p className="mt-1 text-sm text-ink-2">
            {done ? `${steps.filter((s) => isPacked(s.state)).length} of 10 rules passed or only need a look.` : "Each rule, in plain words, what we found, how to fix it, and why it matters."}
          </p>
        </div>
        <ol ref={listRef} className="relative flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
          {shown.map((s, i) => {
            const checking = i === active && !done;
            return (
              <li key={s.ruleId} data-i={i} className={`rounded-xl border p-4 transition-colors ${checking ? "border-accent bg-accent-soft" : "border-line bg-paper"}`} style={{ animation: "pop .25s ease-out" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{s.name}</span>
                  <span className={`badge ${checking ? "bg-accent text-black" : BADGE[s.state]}`}>{checking ? "Checking" : STATE_LABEL[s.state]}</span>
                </div>
                {!checking && (
                  <div className="mt-2 space-y-1.5 text-[13.5px]">
                    {s.detail && <p className="text-ink-2">{s.detail}</p>}
                    {s.fix && (
                      <p>
                        <b>Fix: </b>
                        {s.fix}
                        {s.problems > 1 ? ` (${s.problems} lines affected)` : ""}
                      </p>
                    )}
                    {s.state !== "pass" && s.state !== "na" && <p className="text-[12.5px] text-ink-3">Why it matters: {s.why}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
