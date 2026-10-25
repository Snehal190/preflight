import type { Booking } from "../types";
import { fmtDateLong, fmtGBP, fmtNum } from "../format";
import type { Evaluation } from "./state";

// Take-off page text (spec §1.6, §14.3), built only from the booking's real values. Nothing is
// described as already done: this is a booking request, not a booking.

export function takeoffSummary(b: Booking, e: Evaluation): string | null {
  const c = e.carrier.rows.find((r) => r.id === e.carrier.chosen);
  if (!c || !e.dates || b.cartons.value === null || b.pallets.value === null) return null;
  const descs = b.items.map((it) => it.description.value ?? it.sku.value ?? "item");
  const goods = descs.length === 1 ? descs[0] : `${descs.length} products (${descs.join("; ")})`;
  const type = b.destinationType.value === "Warehouse" ? "warehouse" : "business address";
  return [
    `${fmtNum(b.cartons.value)} cartons of ${goods} on ${fmtNum(b.pallets.value)} pallet${b.pallets.value === 1 ? "" : "s"}`,
    `${b.originCity.value} → ${b.destinationCity.value} (${type})`,
    `${c.name} ${c.service}`,
    c.totalCost ? fmtGBP(c.totalCost) : "",
    `collection ${fmtDateLong(e.dates.collection)}`,
    `estimated delivery ${fmtDateLong(e.dates.delivery)}`,
  ]
    .filter(Boolean)
    .join(", ")
    .concat(".");
}

export function whatHappensNext(b: Booking, e: Evaluation): string[] {
  const c = e.carrier.rows.find((r) => r.id === e.carrier.chosen);
  if (!c || !e.dates) return [];
  const steps: string[] = [];
  const r08 = e.results.find((r) => r.ruleId === "R-08");
  if (b.destinationType.value === "Warehouse" && r08?.status === "fail") {
    steps.push(`Book the delivery slot with the receiving warehouse for around ${fmtDateLong(e.dates.delivery)}.`);
  }
  steps.push("Print the commercial invoice and attach it to the shipment.");
  steps.push(`Collection by ${c.name} from ${b.originCity.value} on ${fmtDateLong(e.dates.collection)}.`);
  steps.push("UK export customs clearance (uses the HS codes, values and origins on the invoice).");
  steps.push(`In transit, ${c.transitDays} working day${c.transitDays === 1 ? "" : "s"}.`);
  steps.push(`Import customs in ${b.destinationCountry.value}.`);
  steps.push(`Delivery to ${b.destinationCity.value} ${b.destinationType.value === "Warehouse" ? "warehouse" : "business address"}, estimated ${fmtDateLong(e.dates.delivery)}.`);
  return steps;
}
