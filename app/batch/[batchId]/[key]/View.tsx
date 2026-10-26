"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useBooking } from "@/lib/client/useBooking";
import { postJson } from "@/lib/client/store";
import { StatusBadge } from "@/app/components/StatusBadge";
import { IssueCard } from "@/app/components/IssueCard";
import { FieldsPanel } from "@/app/components/FieldsPanel";
import { Chips } from "@/app/components/Chips";
import { VerifyStage } from "@/app/components/VerifyStage";
import { CarrierPanel } from "@/app/components/CarrierPanel";

const STEPS = ["Verify", "Fix", "Carrier", "Take-off"] as const;

/**
 * One booking, one flow: verify (3D + deep analysis) → fix what's wrong → carrier → approve.
 * The carrier only appears once every must-fix is sorted; the lorry only leaves on approval.
 */
export default function View() {
  const { batchId, key: rawKey } = useParams<{ batchId: string; key: string }>();
  const key = decodeURIComponent(rawKey);
  const bk = useBooking(batchId, key);
  const [verified, setVerified] = useState(false);
  const [runKey, setRunKey] = useState(() => `${Date.now()}`);
  const [departing, setDeparting] = useState(false);
  if (!bk.loaded) return null;
  if (!bk.entry) return <p>Booking not found in this browser. <Link className="underline" href="/upload">Upload again</Link>.</p>;
  const { booking, evaluation: e, state, versions, label } = bk.entry;

  const ready = e.status === "ready";
  const issues = e.results.filter((r) => r.status !== "pass" && r.status !== "not_applicable");
  const passed = e.results.filter((r) => r.status === "pass" || r.status === "not_applicable");
  const ackFor = (id: string) => state.acknowledged.find((a) => a.id === id);
  const step = departing ? 3 : !verified ? 0 : ready ? 2 : 1;
  const multi = (bk.batch?.bookings.length ?? 0) > 1;
  const takeoffHref = `/batch/${batchId}/${encodeURIComponent(key)}/takeoff`;

  async function suggestHs(itemId: string, description: string) {
    try {
      const res = await postJson<{ suggestion: { code: string; reason: string } | null; unavailable?: boolean }>("/api/hs-suggest", { description });
      if (res.suggestion) bk.useHsSuggestion(itemId, res.suggestion.code, res.suggestion.reason);
      else alert(res.unavailable ? "The AI assistant is unavailable right now." : "The AI couldn't suggest a code for this description.");
    } catch {
      alert("The AI assistant is unavailable right now.");
    }
  }

  function approve() {
    setDeparting(true);
    document.getElementById("verify")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-12 pb-16">
      <div className="space-y-4 pt-4">
        {multi && (
          <Link href={`/batch/${batchId}`} className="text-sm text-ink-2 underline">
            ← All bookings
          </Link>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="eyebrow">Checking your booking</p>
            <h1 className="text-[34px] sm:text-[44px]">{label}</h1>
            <p className="text-ink-2">
              {booking.sellerName.value ?? "—"} · {booking.originCity.value ?? "?"} → {booking.destinationCity.value ?? "?"}
              {booking.destinationCountry.value ? `, ${booking.destinationCountry.value}` : ""}
            </p>
          </div>
          <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${i === step ? "border-ink bg-accent font-bold text-black" : i < step ? "border-line bg-paper text-ink" : "border-line text-ink-3"}`}>
                <span className="mono text-xs">{i < step ? "✓" : i + 1}</span> {s}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* 1 · Verify */}
      <section id="verify" className="scroll-mt-20 space-y-4">
        <VerifyStage
          evaluation={e}
          label={label}
          runKey={runKey}
          departing={departing}
          onFinished={() => setVerified(true)}
          banner={
            departing ? (
              <div className="absolute inset-x-4 bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink px-5 py-4 text-paper shadow-lg" style={{ animation: "pop .4s ease-out" }}>
                <div>
                  <p className="text-lg font-extrabold">
                    <span className="text-accent">✓</span> All checks passed — on its way to {booking.destinationCity.value}
                  </p>
                  <p className="text-sm opacity-80">Booking request ready for take-off. Nothing has been sent to a carrier yet.</p>
                </div>
                <Link href={takeoffHref} className="btn">See take-off summary →</Link>
              </div>
            ) : null
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={e.status} />
          <span className="font-semibold">{e.headline}</span>
          {bk.busy && <span className="text-sm text-ink-3">Re-checking…</span>}
          <button type="button" className="btn btn-ghost ml-auto text-sm" disabled={bk.busy || departing} onClick={() => setRunKey(`${Date.now()}`)}>
            ↻ Replay the checks
          </button>
        </div>
        <Chips chips={bk.lastChips} />
        {bk.error && <p role="alert" className="font-semibold text-bad">{bk.error}</p>}
      </section>

      {/* 2 · Fix */}
      {verified && issues.length > 0 && (
        <section className="space-y-4">
          <div className="space-y-1">
            <p className="eyebrow">Step 2</p>
            <h2 className="text-[28px] sm:text-[34px]">What to fix</h2>
            <p className="text-ink-2">Apply a tested fix, answer the questions, edit a value, or accept a risk. Everything re-checks straight away.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {issues.map((r) => {
              const item = r.scope.kind === "item" ? booking.items.find((it) => r.scope.kind === "item" && it.itemId === r.scope.itemId) : undefined;
              const canSuggest = r.ruleId === "R-01" && r.status === "fail" && item && item.hsCode.value === null && item.description.value;
              return (
                <IssueCard
                  key={r.id}
                  r={r}
                  busy={bk.busy}
                  acknowledgedBy={ackFor(r.id)}
                  onApply={bk.applyFix}
                  onAnswer={bk.answer}
                  onAcknowledge={bk.acknowledge}
                  onUnacknowledge={bk.unacknowledge}
                  onSuggestHs={canSuggest ? () => suggestHs(item.itemId, item.description.value!) : undefined}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* 3 · Carrier */}
      {verified && (
        <section className="space-y-4">
          <div className="space-y-1">
            <p className="eyebrow">Step 3</p>
            <h2 className="text-[28px] sm:text-[34px]">Your carrier</h2>
          </div>
          {ready ? (
            <CarrierPanel evaluation={e} busy={bk.busy} departing={departing} onChoose={(id) => bk.chooseCarrier(id)} onApprove={approve} />
          ) : (
            <div className="card p-6 text-ink-2">
              We&apos;ll recommend a carrier here once every must-fix above is sorted and any risks are accepted. The lorry can&apos;t leave with an open box.
            </div>
          )}
        </section>
      )}

      {verified && (
        <section className="grid gap-4 lg:grid-cols-2">
          <details className="card p-5">
            <summary className="cursor-pointer font-semibold">Booking details — edit any value</summary>
            <div className="mt-4">
              <FieldsPanel booking={booking} busy={bk.busy} onEditBooking={bk.editBookingField} onEditItem={bk.editItemField} />
            </div>
          </details>
          <div className="space-y-4">
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold">Passed checks ({passed.length})</summary>
              <ul className="mt-3 space-y-1.5 text-sm">
                {passed.map((r) => (
                  <li key={r.id}>
                    <strong>{r.title}</strong> — {r.found}
                  </li>
                ))}
              </ul>
            </details>
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold">Version history ({versions.length})</summary>
              <ol className="mt-3 space-y-2 text-sm">
                {[...versions].reverse().map((v) => (
                  <li key={v.n} className="border-t border-line pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>v{v.n}</strong> {v.cause} · {new Date(v.at).toLocaleString("en-GB")}
                      {v.n !== versions.length && (
                        <button type="button" className="text-xs underline" disabled={bk.busy} onClick={() => bk.undoTo(v.n)}>
                          Undo to this version
                        </button>
                      )}
                    </div>
                    <Chips chips={v.chips} />
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </section>
      )}
    </div>
  );
}
