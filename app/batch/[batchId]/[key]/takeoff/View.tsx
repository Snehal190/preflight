"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useBooking } from "@/lib/client/useBooking";
import { takeoffSummary, whatHappensNext } from "@/lib/booking/takeoff";
import { AssumptionLine } from "@/app/components/IssueCard";

export default function View() {
  const { batchId, key: rawKey } = useParams<{ batchId: string; key: string }>();
  const key = decodeURIComponent(rawKey);
  const bk = useBooking(batchId, key);
  if (!bk.loaded) return null;
  if (!bk.entry) return <p>Booking not found in this browser.</p>;
  const { booking, evaluation: e, state } = bk.entry;
  const back = `/batch/${batchId}/${encodeURIComponent(key)}`;

  if (e.status !== "ready") {
    return (
      <p>
        This booking isn&apos;t ready for take-off yet ({e.headline}). <Link className="underline" href={back}>Back to the checks</Link>.
      </p>
    );
  }

  const acknowledged = e.results.filter((r) => r.status === "fail" && r.severity === "amber");
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link href={`${back}/carrier`} className="text-sm underline">← Carrier</Link>
        <p className="eyebrow">Ready for take-off</p>
        <h1 className="text-[34px] sm:text-[40px]">You&apos;re all set, your flight is about to take off.</h1>
        <p className="text-lg">{takeoffSummary(booking, e)}</p>
        <p className="text-sm text-ink/70">This is a booking request ready for take-off. Nothing has been sent to a carrier.</p>
        {e.dates?.assumptions.map((a) => <AssumptionLine key={a} id={a} />)}
      </div>

      {acknowledged.length > 0 && (
        <section className="rounded-xl border border-warn/40 p-4 space-y-2">
          <h2 className="text-2xl">Risks you accepted</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {acknowledged.map((r) => {
              const a = state.acknowledged.find((x) => x.id === r.id);
              return (
                <li key={r.id}>
                  <strong>{r.title}</strong>: {r.found} {a && <span className="text-ink/60">(acknowledged by {a.name}, {new Date(a.at).toLocaleString("en-GB")})</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-3xl">What happens next</h2>
        <ol className="list-decimal pl-5 space-y-1">
          {whatHappensNext(booking, e).map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </section>

      <section className="flex flex-wrap gap-3 items-center">
        <button type="button" className="btn" disabled title="Waiting for the invoice template">Download invoice</button>
        <button type="button" className="btn btn-ghost" disabled title="Needs the database (build step 9)">Copy share link</button>
        <span className="text-sm text-ink/60">Invoice: waiting for the template. Share link: needs the database.</span>
      </section>
    </div>
  );
}
