import type { Booking, Item } from "../types";
import { fmtNum } from "../format";
import { BOOKING_SCOPE, computedInput, input, itemName, itemScope, missingResult, missingText, ruleResult, withSku } from "./helpers";
import type { CheckInput, CheckResult } from "./types";

// R-03 — units per carton × cartons = quantity (Red, per item). Exact integer match.

const R03_FORMULA = "units per carton × cartons = quantity";

export function r03(it: Item): CheckResult {
  const name = itemName(it);
  const scope = itemScope(it);
  const inputs = withSku([input("Units per carton", it.unitsPerCarton), input("Cartons", it.cartons), input("Quantity", it.quantity)], it);
  const reasons: string[] = [];
  if (it.unitsPerCarton.value === null) reasons.push(missingText(`${name} units per carton`, it.unitsPerCarton));
  if (it.cartons.value === null) reasons.push(missingText(`${name} cartons`, it.cartons));
  if (it.quantity.value === null) reasons.push(missingText(`${name} quantity`, it.quantity));
  if (reasons.length) return missingResult("R-03", scope, reasons, inputs, R03_FORMULA);

  const upc = it.unitsPerCarton.value!;
  const cartons = it.cartons.value!;
  const qty = it.quantity.value!;
  const product = upc * cartons;
  const passed = product === qty;
  const calc = `${fmtNum(upc)} per carton × ${fmtNum(cartons)} cartons = ${fmtNum(product)}`;
  return ruleResult("R-03", scope, {
    status: passed ? "pass" : "fail",
    found: passed ? `${name}: ${calc}, matching quantity ${fmtNum(qty)}.` : `${name}: ${calc}, but quantity says ${fmtNum(qty)}.`,
    shouldBe: `${calc}.`,
    fix: { text: passed ? "" : `Check which of units per carton (${fmtNum(upc)}), cartons (${fmtNum(cartons)}) or quantity (${fmtNum(qty)}) is wrong for ${name}.` },
    why: { formula: R03_FORMULA, inputs, result: `${fmtNum(product)} ${passed ? "=" : "≠"} ${fmtNum(qty)} → ${passed ? "pass" : "fail"}` },
  });
}

// R-04 — booking cartons = Σ item cartons (Red, per booking). Exact integer match.

const R04_FORMULA = "booking cartons = Σ item cartons";

export function itemCartonTotal(b: Booking): number | null {
  let total = 0;
  for (const it of b.items) {
    if (it.cartons.value === null) return null;
    total += it.cartons.value;
  }
  return total;
}

export function r04(b: Booking): CheckResult {
  const inputs: CheckInput[] = [input("Booking cartons", b.cartons)];
  const reasons: string[] = [];
  if (b.cartons.value === null) reasons.push(missingText("Booking cartons", b.cartons));
  for (const it of b.items) {
    inputs.push(...withSku([input(`${itemName(it)} cartons`, it.cartons)], it));
    if (it.cartons.value === null) reasons.push(missingText(`${itemName(it)} cartons`, it.cartons));
  }
  if (reasons.length) return missingResult("R-04", BOOKING_SCOPE, reasons, inputs, R04_FORMULA);

  const stated = b.cartons.value!;
  const total = itemCartonTotal(b)!;
  const passed = stated === total;
  const breakdown = b.items.length
    ? `${b.items.map((it) => `${itemName(it)} ${fmtNum(it.cartons.value!)}`).join(" + ")} = ${fmtNum(total)}`
    : "this booking has no items, so the item cartons add up to 0";
  inputs.push(computedInput("Σ item cartons", fmtNum(total)));
  return ruleResult("R-04", BOOKING_SCOPE, {
    status: passed ? "pass" : "fail",
    found: passed ? `Booking says ${fmtNum(stated)} cartons; items add up to ${fmtNum(total)}.` : `Booking says ${fmtNum(stated)} cartons, but the items add up to ${fmtNum(total)} (${breakdown}).`,
    shouldBe: `Booking cartons = ${breakdown}.`,
    fix: { text: passed ? "" : `Change the booking's cartons to ${fmtNum(total)}, or correct the item cartons that are wrong.` },
    why: { formula: R04_FORMULA, inputs, result: `${fmtNum(stated)} ${passed ? "=" : "≠"} ${fmtNum(total)} → ${passed ? "pass" : "fail"}` },
  });
}
