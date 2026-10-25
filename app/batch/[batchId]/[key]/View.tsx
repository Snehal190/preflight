"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useBooking } from "@/lib/client/useBooking";
import { postJson } from "@/lib/client/store";
import { StatusBadge } from "@/app/components/StatusBadge";
import { IssueCard } from "@/app/components/IssueCard";
import { FieldsPanel } from "@/app/components/FieldsPanel";
import { CarrierSummary, DatesLine } from "@/app/components/CarrierBits";
import { Chips } from "@/app/components/Chips";

export default function View() {
  const { batchId, key: rawKey } = useParams<{ batchId: string; key: string }>();
  const key = decodeURIComponent(rawKey);
  const router = useRouter();
  const bk = useBooking(batchId, key);
  if (!bk.loaded) return null;
  if (!bk.entry) return <p>Booking not found in this browser. <Link className="underline" href="/upload">Upload again</Link>.</p>;
  const { booking, evaluation: e, state, versions, label } = bk.entry;

  const issues = e.results.filter((r) => r.status !== "pass" && r.status !== "not_applicable");
  const passed = e.results.filter((r) => r.status === "pass" || r.status === "not_applicable");
  const ackFor = (id: string) => state.acknowledged.find((a) => a.id === id);

  async function suggestHs(itemId: string, description: string) {
    try {
      const res = await postJson<{ suggestion: { code: string; reason: string } | null; unavailable?: boolean }>("/api/hs-suggest", { description });
      if (res.suggestion) bk.useHsSuggestion(itemId, res.suggestion.code, res.suggestion.reason);
      else alert(res.unavailable ? "The AI assistant is unavailable right now." : "The AI couldn't suggest a code for this description.");
    } catch {
      alert("The AI assistant is unavailable right now.");
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href={`/batch/${batchId}`} className="text-sm underline">← All bookings</Link>
        <h1 className="text-5xl">{label}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={e.status} />
          <span className="font-semibold">{e.headline}</span>
          {bk.busy && <span className="text-sm">Re-checking…</span>}
        </div>
        <Chips chips={bk.lastChips} />
        {bk.error && <p role="alert" className="text-bad font-semibold">{bk.error}</p>}
      </div>

      <section className="rounded-xl border border-ink/15 p-4 space-y-3">
        <h2 className="text-2xl">Carrier</h2>
        <CarrierSummary c={e.carrier} provisional={e.status !== "ready"} />
        <DatesLine dates={e.dates} />
      </section>

      <section className="space-y-3">
        <h2 className="text-3xl">Issues ({issues.length})</h2>
        {issues.length === 0 && <p>No issues — every check passed.</p>}
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
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-dark" disabled={e.status !== "ready" || bk.busy} onClick={() => router.push(`/batch/${batchId}/${encodeURIComponent(key)}/carrier`)}>
          Continue to carrier →
        </button>
        {e.status !== "ready" && <span className="text-sm text-ink/70">Fix every Red and Missing-data issue, answer every question, and fix or acknowledge every Amber first.</span>}
      </div>

      <details className="rounded-xl border border-ink/15 p-4">
        <summary className="cursor-pointer font-semibold">Passed checks ({passed.length})</summary>
        <ul className="mt-2 space-y-1 text-sm">
          {passed.map((r) => (
            <li key={r.id}><strong>{r.title}</strong> — {r.found}</li>
          ))}
        </ul>
      </details>

      <details className="rounded-xl border border-ink/15 p-4" open>
        <summary className="cursor-pointer font-semibold">Booking details (edit any field)</summary>
        <div className="mt-3">
          <FieldsPanel booking={booking} busy={bk.busy} onEditBooking={bk.editBookingField} onEditItem={bk.editItemField} />
        </div>
      </details>

      <details className="rounded-xl border border-ink/15 p-4">
        <summary className="cursor-pointer font-semibold">Version history ({versions.length})</summary>
        <ol className="mt-2 space-y-2 text-sm">
          {[...versions].reverse().map((v) => (
            <li key={v.n} className="border-t border-ink/10 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <strong>v{v.n}</strong> {v.cause} · {new Date(v.at).toLocaleString("en-GB")}
                {v.n !== versions.length && (
                  <button type="button" className="underline text-xs" disabled={bk.busy} onClick={() => bk.undoTo(v.n)}>Undo to this version</button>
                )}
              </div>
              <Chips chips={v.chips} />
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
