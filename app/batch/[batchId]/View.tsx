"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { loadBatch, type StoredBatch } from "@/lib/client/store";
import { compareWorstFirst } from "@/lib/booking/sort";
import { fmtGBP } from "@/lib/format";
import { StatusBadge } from "@/app/components/StatusBadge";

export default function View() {
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<StoredBatch | null | undefined>(undefined);
  useEffect(() => {
    setBatch(loadBatch(batchId));
  }, [batchId]);

  if (batch === undefined) return null;
  if (batch === null) return <p>We couldn&apos;t find these results in this browser. <Link className="underline" href="/upload">Upload again</Link>.</p>;

  const rows = [...batch.bookings].sort((a, b) => compareWorstFirst({ id: a.label, evaluation: a.evaluation }, { id: b.label, evaluation: b.evaluation }));

  return (
    <div className="space-y-6">
      <h1 className="text-5xl">Your bookings</h1>
      <p className="text-sm text-ink/60">{batch.files.join(", ")} · {batch.bookings.length} booking{batch.bookings.length === 1 ? "" : "s"}</p>

      {batch.warnings.length > 0 && (
        <div role="status" className="rounded-lg border border-warn/40 bg-warn/5 p-4 space-y-1">
          <p className="font-semibold">About this file</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {batch.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-ink/20">
              {["Booking", "Seller", "Route", "Status", "Must fix", "Please check", "Advice", "Missing info", "Questions", "Provisional carrier"].map((h) => (
                <th key={h} className="py-2 pr-3 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, booking: b, evaluation: e }) => {
              const row = b.bookingId.location?.kind === "cell" ? b.bookingId.location.row : null;
              const chosen = e.carrier.rows.find((r) => r.id === e.carrier.chosen);
              return (
                <tr key={key} className="border-b border-ink/10 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <Link className="underline font-semibold" href={`/batch/${batchId}/${encodeURIComponent(key)}`}>{label}</Link>
                    {row && !label.includes("(row") && <span className="text-ink/50"> · row {row}</span>}
                  </td>
                  <td className="py-2 pr-3">{b.sellerName.value ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{b.originCity.value ?? "?"} → {b.destinationCity.value ?? "?"}{b.destinationCountry.value ? `, ${b.destinationCountry.value}` : ""}</td>
                  <td className="py-2 pr-3"><StatusBadge status={e.status} /><div className="text-xs mt-1">{e.headline}</div></td>
                  <td className="py-2 pr-3">{e.counts.red}</td>
                  <td className="py-2 pr-3">{e.counts.amber}</td>
                  <td className="py-2 pr-3">{e.counts.info}</td>
                  <td className="py-2 pr-3">{e.counts.missing}</td>
                  <td className="py-2 pr-3">{e.counts.needsAnswer}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {chosen ? `${chosen.name}${chosen.totalCost ? ` · ${fmtGBP(chosen.totalCost)}` : ""}` : e.carrier.noneEligible ? "No carrier fits" : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
