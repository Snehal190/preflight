import type { Booking, FieldValue } from "../types";
import { dec } from "../num";
import { analyseCarriers, type CarrierAnalysis } from "../carrier";
import type { CheckContext } from "./context";
import { BOOKING_SCOPE, input, itemName, itemScope, missingText } from "./helpers";
import { bookingInfo } from "./info";
import { r01 } from "./r01";
import { r02 } from "./r02";
import { r03, r04 } from "./r03r04";
import { r05, r07, netWeight } from "./weights";
import { r06 } from "./r06";
import { r08, r09, r10 } from "./r08r09r10";
import { isBlocking, needsAcknowledgement, type CheckResult, type CheckScope } from "./types";
import { RULEBOOK, type RuleId } from "../reference/rulebook";

export type { CheckContext } from "./context";
export * from "./types";

// Runs all 10 rules on every booking, every time, and reports every failure (spec §6).
// Pure: no AI, no I/O. Same input → same output.

export type BookingStatus = "blocked" | "check" | "ready";

export interface CheckReport {
  results: CheckResult[];
  carrier: CarrierAnalysis;
  status: BookingStatus;
  counts: { red: number; amber: number; info: number; missing: number; needsAnswer: number; mustFix: number; toCheck: number };
  headline: string;
}

function dataResult(key: string, scope: CheckScope, found: string, fix: string, inputs: CheckResult["why"]["inputs"]): CheckResult {
  return {
    id: `DATA:${key}`,
    ruleId: "DATA",
    title: "Missing data",
    status: "missing_data",
    severity: null,
    scope,
    found,
    shouldBe: "A readable value from the allowed list.",
    whyItMatters: "Without it we can't finish the checks or choose a carrier.",
    fix: { text: fix },
    why: { formula: "Required field", inputs, result: "Not available — blocks progress." },
  };
}

const REQUIRED_BOOKING_FIELDS: [keyof Booking, string][] = [
  ["bookingId", "Booking ID"],
  ["sellerName", "Seller name"],
  ["originCity", "Origin city"],
  ["originCountry", "Origin country"],
  ["destinationCity", "Destination city"],
  ["destinationCountry", "Destination country"],
  ["currency", "Currency"],
  ["priority", "Seller priority"],
];

function dataChecks(b: Booking): CheckResult[] {
  const out: CheckResult[] = [];
  const dup = b.integrity.duplicateIdRows;
  if (dup && dup.length >= 2) {
    out.push(
      dataResult(
        "duplicate-id",
        BOOKING_SCOPE,
        `Two bookings share this ID (rows ${dup.slice(0, -1).join(", ")} and ${dup.at(-1)}), so we can't tell which items belong to which.`,
        "Give each booking its own Booking ID in both sheets, then upload again.",
        [input("Booking ID", b.bookingId)],
      ),
    );
  }
  for (const [key, label] of REQUIRED_BOOKING_FIELDS) {
    const f = b[key] as FieldValue<unknown>;
    if (f.value === null) out.push(dataResult(String(key), BOOKING_SCOPE, missingText(label, f), `Fill in ${label.toLowerCase()}.`, [input(label, f)]));
  }
  if (b.items.length === 0) {
    out.push(dataResult("no-items", BOOKING_SCOPE, "This booking has no items.", "Add the booking's items (Items sheet rows with this Booking ID).", [input("Booking ID", b.bookingId)]));
  }
  for (const it of b.items) {
    if (it.sku.value === null) out.push(dataResult(`sku:${it.itemId}`, itemScope(it), missingText(`${itemName(it)} SKU`, it.sku), "Fill in the SKU.", [input("SKU", it.sku)]));
  }
  return out;
}

/** Item-level rules can't run on a booking with no items (spec §5.4 rule 18). */
function noItemsResults(): CheckResult[] {
  return (["R-01", "R-03", "R-06", "R-09"] as RuleId[]).map((ruleId) => ({
    id: `${ruleId}:booking:no-items`,
    ruleId,
    title: `${ruleId} · ${RULEBOOK[ruleId].shortName}`,
    status: "missing_data",
    severity: RULEBOOK[ruleId].severity,
    scope: BOOKING_SCOPE,
    found: "This booking has no items, so this item check can't run.",
    shouldBe: "At least one item.",
    whyItMatters: RULEBOOK[ruleId].whyItMatters,
    fix: { text: "Add the booking's items." },
    why: { formula: RULEBOOK[ruleId].rule, inputs: [], result: "Not run — no items." },
  }));
}

export interface RunOptions {
  /** Estimated delivery date for the chosen carrier (used in R-08's fix text). */
  estimatedDelivery?: string | null;
}

export function runChecks(b: Booking, ctx: CheckContext, opts: RunOptions = {}): CheckReport {
  const carrier = analyseCarriers({
    destinationCountry: b.destinationCountry.value,
    pallets: b.pallets.value,
    grossKg: b.grossWeightKg.value !== null ? dec(b.grossWeightKg.value) : null,
    netKg: netWeight(b),
    priority: b.priority.value,
  });

  const results: CheckResult[] = [...dataChecks(b)];
  if (b.items.length === 0) results.push(...noItemsResults());
  for (const it of b.items) results.push(...r01(it, ctx));
  results.push(r02(b));
  for (const it of b.items) results.push(r03(it));
  results.push(r04(b));
  results.push(...r05(b, ctx, carrier));
  for (const it of b.items) results.push(r06(it, ctx));
  results.push(r07(b));
  results.push(r08(b, opts.estimatedDelivery ?? null));
  for (const it of b.items) results.push(r09(it));
  results.push(r10(b, ctx.today));
  results.push(...bookingInfo(b, ctx));

  return { results, carrier, ...summarise(results, ctx.acknowledged ?? []) };
}

/** Status per spec §7. `acknowledged` = IDs of Amber results the seller accepted. */
export function summarise(results: CheckResult[], acknowledged: readonly string[]): Pick<CheckReport, "status" | "counts" | "headline"> {
  const ack = new Set(acknowledged);
  const mustFix = results.filter(isBlocking).length;
  const toCheck = results.filter((r) => needsAcknowledgement(r) && !ack.has(r.id)).length;
  const counts = {
    // Blocking Reds only: the non-blocking R-05 preferred-carrier note is shown but not counted.
    red: results.filter((r) => r.status === "fail" && r.severity === "red" && !r.nonBlocking).length,
    amber: results.filter(needsAcknowledgement).length,
    info: results.filter((r) => r.severity === "info").length,
    missing: results.filter((r) => r.status === "missing_data").length,
    needsAnswer: results.filter((r) => r.status === "needs_answer").length,
    mustFix,
    toCheck,
  };
  const status: BookingStatus = mustFix > 0 ? "blocked" : toCheck > 0 ? "check" : "ready";
  const parts: string[] = [];
  if (mustFix) parts.push(`${mustFix} must-fix`);
  if (toCheck) parts.push(`${toCheck} to check`);
  return { status, counts, headline: parts.length ? parts.join(" · ") : "Ready for take-off" };
}

const DISPLAY_GROUP = (r: CheckResult): number => {
  if (r.status === "missing_data") return 0;
  if (r.status === "fail" && r.severity === "red") return 1;
  if (r.status === "needs_answer") return 2;
  if (r.status === "fail" && r.severity === "amber") return 3;
  if (r.severity === "info") return 4;
  return 5; // pass / not applicable
};

/** Card order: Missing data → Red → Needs your answer → Amber → Info → passes (spec §1.4). Stable. */
export function orderForDisplay(results: CheckResult[]): CheckResult[] {
  return results.map((r, i) => ({ r, i })).sort((a, b) => DISPLAY_GROUP(a.r) - DISPLAY_GROUP(b.r) || a.i - b.i).map((x) => x.r);
}
