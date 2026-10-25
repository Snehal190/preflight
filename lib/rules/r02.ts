import type { Booking } from "../types";
import { Decimal, dec, sum } from "../num";
import { fmtGBP, fmtNum } from "../format";
import { BOOKING_SCOPE, computedInput, input, itemName, missingResult, missingText, ruleResult, withSku } from "./helpers";
import type { CheckInput, CheckResult } from "./types";

// R-02 — declared value within 1% of item total (Red, per booking).
// ASSUMPTION A3: the 1% is measured against the item total. Uses stated quantities even when R-03 fails.
// Pass iff |declared − itemTotal| ≤ 0.01 × itemTotal — multiplication only, so no divide-by-zero.

const FORMULA = "|declared value − Σ (quantity × unit price)| ≤ 1% × Σ (quantity × unit price)";

export function itemTotal(b: Booking): Decimal | null {
  const lines: Decimal[] = [];
  for (const it of b.items) {
    if (it.quantity.value === null || it.unitPrice.value === null) return null;
    lines.push(dec(it.quantity.value).times(it.unitPrice.value));
  }
  return sum(lines);
}

/** Percentage shown with enough decimals that a fail never displays as "1.00%". */
export function gapPctText(gap: Decimal, base: Decimal, passed: boolean): string {
  const pct = gap.div(base).times(100);
  for (let dp = 1; dp <= 6; dp++) {
    const shown = pct.toDecimalPlaces(dp);
    if (passed ? shown.lte(1) : shown.gt(1)) return `${fmtNum(shown.toFixed(dp))}%`;
  }
  return `${pct.toFixed()}%`;
}

export function r02(b: Booking): CheckResult {
  const inputs: CheckInput[] = [input("Total declared value", b.declaredValue, b.declaredValue.value !== null ? fmtGBP(b.declaredValue.value) : undefined)];
  const reasons: string[] = [];
  if (b.declaredValue.value === null) reasons.push(missingText("Total declared value", b.declaredValue));
  for (const it of b.items) {
    const n = itemName(it);
    inputs.push(...withSku([input(`${n} quantity`, it.quantity), input(`${n} unit price`, it.unitPrice, it.unitPrice.value !== null ? fmtGBP(it.unitPrice.value) : undefined)], it));
    if (it.quantity.value === null) reasons.push(missingText(`${n} quantity`, it.quantity));
    if (it.unitPrice.value === null) reasons.push(missingText(`${n} unit price`, it.unitPrice));
  }
  if (reasons.length) return missingResult("R-02", BOOKING_SCOPE, reasons, inputs, FORMULA);

  const declared = dec(b.declaredValue.value!);
  const total = itemTotal(b)!;
  const gap = declared.minus(total).abs();
  const allowed = total.times("0.01");
  const passed = gap.lte(allowed);

  const lineText = b.items.length
    ? b.items.map((it) => `${itemName(it)} ${fmtNum(it.quantity.value!)} × ${fmtGBP(it.unitPrice.value!)} = ${fmtGBP(dec(it.quantity.value!).times(it.unitPrice.value!))}`).join("; ")
    : "this booking has no items, so the item total is £0";
  const pctText = total.isZero() ? (gap.isZero() ? "0%" : "n/a — the item total is £0") : gapPctText(gap, total, passed);
  inputs.push(computedInput("Item total", fmtGBP(total)), computedInput("Gap", `${fmtGBP(gap)} (${pctText})`));

  const range = `${fmtGBP(total.minus(allowed))} – ${fmtGBP(total.plus(allowed))}`;
  return ruleResult("R-02", BOOKING_SCOPE, {
    status: passed ? "pass" : "fail",
    found: `Declared value ${fmtGBP(declared)}; items add up to ${fmtGBP(total)} (gap ${fmtGBP(gap)}${total.isZero() ? "" : `, ${pctText} of the item total`}).`,
    shouldBe: `Within 1% of the item total: ${range}. Item total: ${lineText}.`,
    fix: {
      text: passed ? "" : `Change the declared value to ${fmtGBP(total)}, or correct the item line that's wrong.`,
    },
    why: { formula: FORMULA, inputs, result: `${fmtGBP(gap)} ${passed ? "≤" : ">"} ${fmtGBP(allowed)} → ${passed ? "pass" : "fail"}` },
    assumptions: ["A3"],
  });
}
