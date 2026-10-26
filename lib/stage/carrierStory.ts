import type { CarrierView, DatesView } from "../booking/state";
import { dec } from "../num";
import { fmtDateLong, fmtGBP } from "../format";

// "Why this carrier", written from the numbers (never by AI): what was asked for, what the pick
// gives, the trade-off against each other carrier, and why any were ruled out.

const BASIS: Record<string, string> = {
  Cheapest: "the lowest total cost, then the shortest transit",
  Fastest: "the fewest working days in transit, then the best on-time record",
  "Most reliable": "the best on-time record, then the lowest cost",
  Balanced: "an equal mix of cost, speed and reliability",
};

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}

export function carrierStory(c: CarrierView, dates: DatesView | null): string[] {
  const pick = c.rows.find((r) => r.id === c.chosen);
  if (!pick) return [];
  const out: string[] = [];
  if (c.priority) out.push(`You asked for ${c.priority.toLowerCase()}, so we rank the carriers that can take this load by ${BASIS[c.priority] ?? "your priority"}.`);
  out.push(
    `${pick.name} (${pick.service}) costs ${pick.totalCost ? fmtGBP(pick.totalCost) : `${fmtGBP(pick.pricePerPallet ?? "0")} per pallet`}, takes ${plural(pick.transitDays, "working day")} and arrives on time ${pick.onTimePct}% of the time${dates ? `, estimated delivery ${fmtDateLong(dates.delivery)}` : ""}.`,
  );
  for (const r of c.rows) {
    if (r.id === pick.id || r.eligible === false) continue;
    const parts: string[] = [];
    const a = r.totalCost ?? r.pricePerPallet;
    const b = pick.totalCost ?? pick.pricePerPallet;
    if (a && b) {
      const d = dec(a).minus(b);
      parts.push(d.isZero() ? "would cost the same" : d.isPositive() ? `would cost ${fmtGBP(d)} more (${fmtGBP(a)})` : `would cost ${fmtGBP(d.abs())} less (${fmtGBP(a)})`);
    }
    const days = pick.transitDays - r.transitDays;
    parts.push(days > 0 ? `arrive ${plural(days, "day")} sooner` : days < 0 ? `arrive ${plural(-days, "day")} later` : "take the same time");
    const pts = r.onTimePct - pick.onTimePct;
    parts.push(pts > 0 ? `be ${plural(pts, "point")} more reliable` : pts < 0 ? `be ${plural(-pts, "point")} less reliable` : "be just as reliable");
    out.push(`${r.name} ${parts[0]}, ${parts.slice(1).join(" and ")}.`);
  }
  for (const r of c.rows) {
    if (r.eligible === false && r.excludedReason) out.push(`${r.name} can't take this load: ${r.excludedReason}`);
  }
  return out;
}
