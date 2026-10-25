import type { Booking, Item } from "../types";
import { fmtDateField, fmtDateLong } from "../format";
import { BOOKING_SCOPE, input, itemName, itemScope, missingResult, missingText, ruleResult, withSku } from "./helpers";
import type { CheckResult } from "./types";

// R-08 — warehouse needs an appointment (Amber, per booking).

const R08_FORMULA = "Destination type = Warehouse → delivery appointment booked = Yes";

export function r08(b: Booking, estimatedDelivery: string | null): CheckResult {
  const inputs = [input("Destination type", b.destinationType), input("Delivery appointment booked", b.appointmentBooked)];
  const type = b.destinationType.value;
  if (type === null) return missingResult("R-08", BOOKING_SCOPE, [missingText("Destination type", b.destinationType)], inputs, R08_FORMULA);
  if (type === "Business address") {
    return ruleResult("R-08", BOOKING_SCOPE, {
      status: "not_applicable",
      found: "Not applicable — business address.",
      shouldBe: "Appointments are only needed for warehouse deliveries.",
      fix: { text: "" },
      why: { formula: R08_FORMULA, inputs, result: "Business address → not applicable" },
    });
  }
  const appt = b.appointmentBooked.value;
  if (appt === null) return missingResult("R-08", BOOKING_SCOPE, [missingText("Delivery appointment booked", b.appointmentBooked)], inputs, R08_FORMULA);
  const passed = appt === "Yes";
  const when = estimatedDelivery ? fmtDateLong(estimatedDelivery) : "your estimated delivery date";
  return ruleResult("R-08", BOOKING_SCOPE, {
    status: passed ? "pass" : "fail",
    found: passed ? "Warehouse delivery with an appointment booked." : "Warehouse delivery, but no delivery appointment is booked.",
    shouldBe: "Appointment booked = Yes for warehouse deliveries.",
    fix: {
      text: passed ? "" : `Book a delivery slot with the receiving warehouse for around ${when}, then mark appointment = Yes.`,
      noApplyReason: "Only you can book the slot with the warehouse.",
    },
    why: { formula: R08_FORMULA, inputs, result: `Warehouse + ${appt} → ${passed ? "pass" : "fail"}` },
  });
}

// R-09 — every item has a country of origin (Amber, per item).

export function r09(it: Item): CheckResult {
  const name = itemName(it);
  const scope = itemScope(it);
  const f = it.countryOfOrigin;
  const inputs = withSku([input("Country of origin", f)], it);
  const formula = "Country of origin is filled in";
  if (f.value === null && f.raw && f.raw.trim() !== "") {
    return missingResult("R-09", scope, [missingText(`${name} country of origin`, f)], inputs, formula);
  }
  const passed = f.value !== null;
  return ruleResult("R-09", scope, {
    status: passed ? "pass" : "fail",
    found: passed ? `${name}: made in ${f.value}.` : `${name}: no country of origin.`,
    shouldBe: "The country where the goods were made.",
    fix: {
      text: passed ? "" : `Add where ${name} was made (not where it ships from).`,
      noApplyReason: "Only you know where the goods were made.",
    },
    why: { formula, inputs, result: passed ? "Filled → pass" : "Blank → fail" },
  });
}

// R-10 — ready date not in the past (Amber, per booking). "Today" is Europe/London, injected.

export function r10(b: Booking, today: string): CheckResult {
  const f = b.readyDate;
  const inputs = [input("Ready to ship date", f, f.value ? fmtDateLong(f.value) : undefined), { label: "Today (Europe/London)", value: fmtDateLong(today) }];
  const formula = "Ready to ship date ≥ today (Europe/London)";
  if (f.value === null) return missingResult("R-10", BOOKING_SCOPE, [missingText("Ready to ship date", f)], inputs, formula);
  const passed = f.value >= today;
  return ruleResult("R-10", BOOKING_SCOPE, {
    status: passed ? "pass" : "fail",
    found: passed ? `Ready to ship ${fmtDateLong(f.value)}.` : `Ready to ship ${fmtDateLong(f.value)}, which is in the past (today is ${fmtDateLong(today)}).`,
    shouldBe: `Today (${fmtDateLong(today)}) or later.`,
    fix: {
      text: passed ? "" : `Choose today (${fmtDateField(today)}) or a later date.`,
      noApplyReason: "You pick the new date.",
    },
    why: { formula, inputs, result: `${f.value} ${passed ? "≥" : "<"} ${today} → ${passed ? "pass" : "fail"}` },
  });
}
