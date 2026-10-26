import type { CarrierView, DatesView } from "@/lib/booking/state";
import { fmtDateLong, fmtGBP } from "@/lib/format";
import { AssumptionLine } from "./IssueCard";

export function chosenRow(c: CarrierView) {
  return c.rows.find((r) => r.id === c.chosen) ?? null;
}

export function DatesLine({ dates }: { dates: DatesView | null }) {
  if (!dates) return <p className="text-sm text-ink/60">Dates appear once the ready date, destination and carrier are known.</p>;
  return (
    <div className="space-y-1 text-sm">
      <p>
        Collection <strong>{fmtDateLong(dates.collection)}</strong> · estimated delivery <strong>{fmtDateLong(dates.delivery)}</strong>
      </p>
      {dates.notes.map((n, i) => <p key={i} className="text-ink/70">{n}</p>)}
      {dates.assumptions.map((a) => <AssumptionLine key={a} id={a} />)}
    </div>
  );
}

export function CarrierSummary({ c, provisional }: { c: CarrierView; provisional: boolean }) {
  const row = chosenRow(c);
  return (
    <div className="space-y-2">
      {provisional && <p className="text-xs font-bold uppercase tracking-wide">Provisional: final once all issues are resolved</p>}
      {row ? (
        <p className="text-lg">
          <strong>{row.name}</strong> {row.service} · {row.totalCost ? fmtGBP(row.totalCost) : row.pricePerPallet ? `${fmtGBP(row.pricePerPallet)} per pallet` : "no price"} · {row.transitDays} working days · {row.onTimePct}% on time
          {c.chosenIsManual && <span className="text-sm"> (your choice)</span>}
        </p>
      ) : c.noneEligible ? (
        <p className="text-bad font-semibold">No carrier can take this load as packed, see R-05.</p>
      ) : (
        <p className="text-ink/70">No carrier yet, fill in the missing data (priority, destination, pallets, weight).</p>
      )}
      {c.reason && <p className="text-sm">{c.reason}</p>}
    </div>
  );
}
