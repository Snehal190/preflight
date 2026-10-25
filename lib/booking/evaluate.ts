import type { Booking } from "../types";
import { orderForDisplay, runChecks, type CheckContext } from "../rules";
import { suggestFixes, withFixes } from "../repair";
import type { CarrierAnalysis } from "../carrier";
import { carrierById } from "../reference/carriers";
import { computeDeliveryDates, holidaySetsFor } from "../dates/delivery";
import type { HolidayFetcher } from "../dates/holidays";
import type { BookingState, CarrierView, DatesView, Evaluation } from "./state";

// One full evaluation: checks → carrier → dates → checks again (R-08's fix names the delivery
// date) → tested fixes. Deterministic given the same booking, state, today and holidays.

export function contextFor(state: BookingState, today: string): CheckContext {
  const byItemId: NonNullable<CheckContext["dgAi"]>["byItemId"] = {};
  const hsAdvice: NonNullable<CheckContext["hsAdvice"]> = {};
  for (const [id, adv] of Object.entries(state.ai?.byItemId ?? {})) {
    byItemId[id] = adv.dg;
    if (adv.hs) hsAdvice[id] = adv.hs;
  }
  return {
    today,
    chosenCarrierId: state.chosenCarrierId,
    dgAi: state.ai ? { available: state.ai.available, byItemId } : undefined,
    answers: state.answers,
    acknowledged: state.acknowledged.map((a) => a.id),
    hsSuggestions: state.hsSuggestions,
    hsAdvice,
  };
}

function carrierView(a: CarrierAnalysis, chosen: CarrierView["chosen"], manual: boolean): CarrierView {
  return {
    route: a.route,
    priority: a.priority,
    evalWeight: a.evalWeight?.toFixed() ?? null,
    evalBasis: a.evalBasis,
    rows: a.rows.map((r) => ({
      id: r.carrier.id,
      name: r.carrier.name,
      service: r.carrier.service,
      pricePerPallet: r.pricePerPallet?.toFixed() ?? null,
      totalCost: r.totalCost?.toFixed() ?? null,
      transitDays: r.carrier.transitDays,
      onTimePct: r.carrier.onTimePct,
      maxKgPerPallet: r.carrier.maxKgPerPallet,
      weightPerPallet: r.weightPerPallet?.toFixed() ?? null,
      eligible: r.eligible,
      excludedReason: r.excludedReason,
      minPallets: r.minPallets,
    })),
    preferred: a.preferred,
    recommended: a.recommended,
    chosen,
    chosenIsManual: manual,
    ranking: a.ranking,
    reason: a.reason,
    runnerUp: a.runnerUp?.text ?? null,
    alternative: a.alternative?.text ?? null,
    noneEligible: a.noneEligible,
    minPalletsAny: a.minPalletsAny,
    netWeightNote: a.netWeightNote,
    balanced: a.balanced,
  };
}

export async function evaluateBooking(b: Booking, state: BookingState, today: string, holidays: HolidayFetcher): Promise<Evaluation> {
  const ctx = contextFor(state, today);
  const first = runChecks(b, ctx);
  const a = first.carrier;
  const manual = state.chosenCarrierId !== null;
  const chosen = state.chosenCarrierId ?? a.recommended;

  let dates: DatesView | null = null;
  if (chosen && b.readyDate.value && b.destinationCountry.value) {
    const sets = await holidaySetsFor(holidays, b.destinationCountry.value, b.destinationCity.value, b.readyDate.value < today ? today : b.readyDate.value);
    const d = computeDeliveryDates({
      readyDate: b.readyDate.value,
      today,
      transitDays: carrierById(chosen).transitDays,
      holidays: sets,
      destinationLabel: b.destinationCity.value ?? b.destinationCountry.value,
    });
    dates = { ...d, carrierId: chosen };
  }

  const report = runChecks(b, ctx, { estimatedDelivery: dates?.delivery ?? null });
  const results = orderForDisplay(withFixes(report, suggestFixes(b, ctx, report), b));
  return {
    results,
    status: report.status,
    counts: report.counts,
    headline: report.headline,
    carrier: carrierView(report.carrier, chosen, manual),
    dates,
    today,
  };
}
