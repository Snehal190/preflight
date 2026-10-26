"use client";

import type { CarrierId } from "@/lib/reference/carriers";
import type { Evaluation } from "@/lib/booking/state";
import { fmtDateLong, fmtGBP, fmtNum } from "@/lib/format";
import { carrierStory } from "@/lib/stage/carrierStory";

/** The carrier recommendation: which carrier, why (from the numbers), the alternatives, approve. */
export function CarrierPanel({
  evaluation,
  busy,
  departing,
  onChoose,
  onApprove,
}: {
  evaluation: Evaluation;
  busy: boolean;
  departing: boolean;
  onChoose: (id: CarrierId | null) => void;
  onApprove: () => void;
}) {
  const c = evaluation.carrier;
  const ready = evaluation.status === "ready";
  const chosen = c.rows.find((r) => r.id === c.chosen) ?? null;
  const maxCost = Math.max(1, ...c.rows.map((r) => Number(r.totalCost ?? r.pricePerPallet ?? 0)));

  return (
    <div className="card overflow-hidden">
      <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6 p-6 sm:p-10">
          <div className="space-y-2">
            <p className="eyebrow">Our recommendation</p>
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
            <button type="button" className="btn px-6 py-3 text-[15px]" disabled={!ready || !chosen || busy || departing} onClick={onApprove}>
              {departing ? "✓ Approved" : `Approve ${chosen?.name ?? "carrier"} and send it on its way`}
            </button>
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
                  <input type="radio" name="carrier" className="accent-black" checked={sel} disabled={out || busy || departing} onChange={() => onChoose(r.id === c.recommended ? null : r.id)} />
                  <span className="flex-1 font-semibold">
                    {r.name} <span className="font-normal text-ink-3">· {r.service}</span>
                    {r.id === c.recommended && <span className="badge ml-2 bg-accent text-black">Recommended</span>}
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
  );
}
