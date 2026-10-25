"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useBooking } from "@/lib/client/useBooking";
import { fmtGBP, fmtKg } from "@/lib/format";
import { StatusBadge } from "@/app/components/StatusBadge";
import { CarrierSummary, DatesLine } from "@/app/components/CarrierBits";
import { Chips } from "@/app/components/Chips";
import { AssumptionLine } from "@/app/components/IssueCard";

export default function View() {
  const { batchId, key: rawKey } = useParams<{ batchId: string; key: string }>();
  const key = decodeURIComponent(rawKey);
  const router = useRouter();
  const bk = useBooking(batchId, key);
  if (!bk.loaded) return null;
  if (!bk.entry) return <p>Booking not found in this browser.</p>;
  const { evaluation: e, label } = bk.entry;
  const c = e.carrier;
  const back = `/batch/${batchId}/${encodeURIComponent(key)}`;
  const r05 = e.results.filter((r) => r.ruleId === "R-05");

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href={back} className="text-sm underline">← Back to checks</Link>
        <h1 className="text-5xl">Carrier · {label}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={e.status} />
          <span className="font-semibold">{e.headline}</span>
          {bk.busy && <span className="text-sm">Re-checking…</span>}
        </div>
        <Chips chips={bk.lastChips} />
        {bk.error && <p role="alert" className="text-bad font-semibold">{bk.error}</p>}
      </div>

      <section className="rounded-xl border border-ink p-4 space-y-3">
        <h2 className="text-2xl">{c.chosenIsManual ? "Your choice" : "Our recommendation"}</h2>
        <CarrierSummary c={c} provisional={e.status !== "ready"} />
        {c.runnerUp && <p className="text-sm">{c.runnerUp}</p>}
        {c.alternative && <p className="text-sm"><strong>Alternative:</strong> {c.alternative}</p>}
        {c.netWeightNote && <p className="text-sm font-semibold">{c.netWeightNote}</p>}
        {c.evalBasis === "gross_only" && <AssumptionLine id="A9" />}
        {c.balanced && (
          <div className="text-sm space-y-1">
            <p><strong>Confidence:</strong> {c.balanced.confidenceText}</p>
            {c.balanced.marginal.map((m, i) => <p key={i}>{m}</p>)}
            <details>
              <summary className="cursor-pointer font-semibold">Why?</summary>
              <p>TOPSIS (equal weights on cost, transit days, on-time %): {Object.entries(c.balanced.topsis).map(([k, v]) => `${k} ${v}`).join(" · ")} → {c.balanced.topsisWinner}</p>
              <p>Min-max weighted check: {Object.entries(c.balanced.minMax).map(([k, v]) => `${k} ${v}`).join(" · ")} → {c.balanced.minMaxWinner}</p>
            </details>
          </div>
        )}
        <DatesLine dates={e.dates} />
      </section>

      {r05.map((r) => (
        <p key={r.id} className={`text-sm ${r.status === "fail" ? "text-bad font-semibold" : ""}`}>
          {r.title}: {r.found}
        </p>
      ))}

      <section className="space-y-3">
        <h2 className="text-2xl">All carriers on this route</h2>
        <div className="space-y-2">
          {c.rows.map((row) => {
            const eligible = row.eligible === true;
            const selected = c.chosen === row.id;
            return (
              <label key={row.id} className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 ${selected ? "border-ink" : "border-ink/15"} ${eligible ? "" : "opacity-50"}`}>
                <input
                  type="radio"
                  name="carrier"
                  checked={selected}
                  disabled={!eligible || bk.busy}
                  onChange={() => bk.chooseCarrier(row.id === c.recommended ? null : row.id)}
                  className="mt-1"
                />
                <span className="space-y-0.5">
                  <span className="block font-semibold">
                    {row.name} {row.service}
                    {row.id === c.recommended && " · recommended"}
                    {row.id === c.preferred && row.id !== c.recommended && ` · your '${c.priority}' pick`}
                  </span>
                  <span className="block text-sm">
                    {row.totalCost ? fmtGBP(row.totalCost) : row.pricePerPallet ? `${fmtGBP(row.pricePerPallet)} per pallet` : "—"} · {row.transitDays} working days · {row.onTimePct}% on time · max {fmtKg(row.maxKgPerPallet)} per pallet
                  </span>
                  {!eligible && row.excludedReason && <span className="block text-sm text-bad">Excluded: {row.excludedReason}</span>}
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-ink/60">Choosing another carrier re-runs R-05 and the cost straight away.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-dark" disabled={e.status !== "ready" || !c.chosen || bk.busy} onClick={() => router.push(`${back}/takeoff`)}>
          Confirm →
        </button>
        {e.status !== "ready" && <span className="text-sm text-ink/70">Resolve the remaining issues on the <Link className="underline" href={back}>checks page</Link> first.</span>}
      </div>
    </div>
  );
}
