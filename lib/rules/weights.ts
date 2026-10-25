import type { Booking } from "../types";
import { Decimal, dec, sum } from "../num";
import { fmtGBP, fmtKg, fmtNum } from "../format";
import { carrierById } from "../reference/carriers";
import { carrierWeightLine, ceilDiv, fmtKg1, type CarrierAnalysis } from "../carrier";
import type { CheckContext } from "./context";
import { BOOKING_SCOPE, computedInput, input, itemName, missingResult, missingText, ruleResult, withSku } from "./helpers";
import type { CheckInput, CheckResult } from "./types";

/** Σ unit weight × quantity; null if any item lacks either. Zero items → 0. */
export function netWeight(b: Booking): Decimal | null {
  const lines: Decimal[] = [];
  for (const it of b.items) {
    if (it.unitWeightKg.value === null || it.quantity.value === null) return null;
    lines.push(dec(it.unitWeightKg.value).times(it.quantity.value));
  }
  return sum(lines);
}

// R-05 — weight per pallet ≤ chosen carrier's max (Red, per booking).
// Evaluated on evalWeight = max(gross, net) (approved Q11/Q12), gross alone when net is unknown (A9).

const R05_FORMULA = "max(gross weight, product weight) ÷ pallets ≤ chosen carrier's max kg per pallet";

function weightBasisText(a: CarrierAnalysis, gross: Decimal, net: Decimal | null): string {
  if (a.evalBasis === "net") return `${fmtKg(net!)} (your products alone; more than the stated gross weight of ${fmtKg(gross)})`;
  return fmtKg(gross);
}

export function r05(b: Booking, ctx: CheckContext, a: CarrierAnalysis): CheckResult[] {
  const net = netWeight(b);
  const inputs: CheckInput[] = [
    input("Total gross weight (kg)", b.grossWeightKg),
    input("Pallets", b.pallets),
    computedInput("Product weight (Σ unit weight × quantity)", net ? fmtKg(net) : "unknown"),
  ];
  const reasons: string[] = [];
  if (b.grossWeightKg.value === null) reasons.push(missingText("Total gross weight", b.grossWeightKg));
  if (b.pallets.value === null) reasons.push(missingText("Pallets", b.pallets));
  if (reasons.length) return [missingResult("R-05", BOOKING_SCOPE, reasons, inputs, R05_FORMULA)];

  const gross = dec(b.grossWeightKg.value!);
  const pallets = b.pallets.value!;
  const evalW = a.evalWeight!;
  const wpp = evalW.div(pallets);
  const line = carrierWeightLine(a);
  const basis = weightBasisText(a, gross, net);
  const calc = `${basis} ÷ ${fmtNum(pallets)} pallets = ${fmtKg1(wpp)} per pallet`;
  const assumptions = a.evalBasis === "gross_only" ? (["A9"] as const) : undefined;
  inputs.push(computedInput("Weight per pallet", fmtKg1(wpp)), computedInput("Carrier limits", line));
  const out: CheckResult[] = [];

  if (a.noneEligible) {
    const n = a.minPalletsAny!;
    const perCarrier = a.rows
      .map((r) => `${r.carrier.name}: ${r.minPallets} pallets${r.pricePerPallet ? ` (${r.minPallets} × ${fmtGBP(r.pricePerPallet)} = ${fmtGBP(r.pricePerPallet.times(r.minPallets!))})` : ""}`)
      .join("; ");
    out.push(
      ruleResult("R-05", BOOKING_SCOPE, {
        status: "fail",
        found: `${calc}, above every carrier's limit (${line}).`,
        shouldBe: `At most ${fmtKg(Math.max(...a.rows.map((r) => r.carrier.maxKgPerPallet)))} per pallet (the highest carrier limit).`,
        fix: { text: `Repack onto at least ${n} pallets (${fmtKg1(evalW.div(n))} each). Minimum per carrier — ${perCarrier}.` },
        why: { formula: R05_FORMULA, inputs, result: `No carrier can take ${fmtKg1(wpp)} per pallet → fail` },
        assumptions: assumptions ? [...assumptions] : undefined,
      }),
    );
    if (a.netWeightNote) out[0].found += ` ${a.netWeightNote}`;
    return out;
  }

  const chosenId = ctx.chosenCarrierId ?? a.recommended;
  if (!chosenId) {
    const allFit = a.rows.every((r) => r.eligible === true);
    if (allFit) {
      out.push(
        ruleResult("R-05", BOOKING_SCOPE, {
          status: "pass",
          found: `${calc} — within every carrier's limit (${line}).`,
          shouldBe: "Within the chosen carrier's limit.",
          fix: { text: "" },
          why: { formula: R05_FORMULA, inputs, result: "Passes for every carrier → pass" },
          assumptions: assumptions ? [...assumptions] : undefined,
        }),
      );
    } else {
      out.push(
        missingResult(
          "R-05",
          BOOKING_SCOPE,
          [`${calc} fits some carriers but not others (${line}), and no carrier can be chosen yet because the seller priority or destination country is missing.`],
          inputs,
          R05_FORMULA,
          "Fill in the seller priority and destination country so a carrier can be chosen.",
        ),
      );
    }
    return out;
  }

  const chosen = a.rows.find((r) => r.carrier.id === chosenId)!;
  const manual = Boolean(ctx.chosenCarrierId);
  const max = chosen.carrier.maxKgPerPallet;
  const passed = wpp.lte(max);
  const label = `${chosen.carrier.name}${manual ? " (your choice)" : " (recommended)"}`;
  const needed = ceilDiv(evalW, max);
  out.push(
    ruleResult("R-05", BOOKING_SCOPE, {
      status: passed ? "pass" : "fail",
      found: `${calc}; ${label} accepts max ${fmtKg(max)}. ${line}.${a.netWeightNote ? ` ${a.netWeightNote}` : ""}`,
      shouldBe: `At most ${fmtKg(max)} per pallet for ${chosen.carrier.name}.`,
      fix: {
        text: passed
          ? ""
          : `Choose a carrier that can take ${fmtKg1(wpp)} per pallet${a.recommended ? ` (we recommend ${carrierById(a.recommended).name})` : ""}, or repack onto ${needed} pallets (${fmtKg1(evalW.div(needed))} each) to use ${chosen.carrier.name}.`,
      },
      why: { formula: R05_FORMULA, inputs, result: `${fmtKg1(wpp)} ${passed ? "≤" : ">"} ${fmtKg(max)} → ${passed ? "pass" : "fail"}` },
      assumptions: assumptions ? [...assumptions] : undefined,
      carrierId: chosen.carrier.id,
    }),
  );

  // Visibility rule: the carrier the seller's priority would pick fails on weight. Never hide it.
  const pref = a.preferred ? a.rows.find((r) => r.carrier.id === a.preferred)! : null;
  if (pref && pref.carrier.id !== chosenId && pref.eligible === false) {
    const pn = ceilDiv(evalW, pref.carrier.maxKgPerPallet);
    const instead = a.recommended && a.recommended !== pref.carrier.id ? ` We've recommended ${carrierById(a.recommended).name} instead (${fmtKg(carrierById(a.recommended).maxKgPerPallet)} limit).` : "";
    out.push(
      ruleResult("R-05", BOOKING_SCOPE, {
        idSuffix: "preferred",
        nonBlocking: true,
        status: "fail",
        found: `Red for ${pref.carrier.name} (your '${a.priority}' choice): ${calc}, but ${pref.carrier.name} accepts max ${fmtKg(pref.carrier.maxKgPerPallet)}.${instead}`,
        shouldBe: `At most ${fmtKg(pref.carrier.maxKgPerPallet)} per pallet for ${pref.carrier.name}.`,
        fix: {
          text: a.alternative?.text ?? `To use ${pref.carrier.name}, repack onto ${pn} pallets (${fmtKg1(evalW.div(pn))} each).`,
        },
        why: { formula: R05_FORMULA, inputs, result: `${fmtKg1(wpp)} > ${fmtKg(pref.carrier.maxKgPerPallet)} for ${pref.carrier.name}; doesn't block because ${chosen.carrier.name} passes` },
        assumptions: assumptions ? [...assumptions] : undefined,
        carrierId: pref.carrier.id,
      }),
    );
  }
  return out;
}

// R-07 — gross weight ≥ Σ unit weight × quantity (Amber, per booking). Exactly equal passes.

const R07_FORMULA = "gross weight ≥ Σ (unit weight × quantity)";

export function r07(b: Booking): CheckResult {
  const inputs: CheckInput[] = [input("Total gross weight (kg)", b.grossWeightKg)];
  const reasons: string[] = [];
  if (b.grossWeightKg.value === null) reasons.push(missingText("Total gross weight", b.grossWeightKg));
  for (const it of b.items) {
    const n = itemName(it);
    inputs.push(...withSku([input(`${n} unit weight (kg)`, it.unitWeightKg), input(`${n} quantity`, it.quantity)], it));
    if (it.unitWeightKg.value === null) reasons.push(missingText(`${n} unit weight`, it.unitWeightKg));
    if (it.quantity.value === null) reasons.push(missingText(`${n} quantity`, it.quantity));
  }
  if (reasons.length) return missingResult("R-07", BOOKING_SCOPE, reasons, inputs, R07_FORMULA);

  const gross = dec(b.grossWeightKg.value!);
  const net = netWeight(b)!;
  const passed = gross.gte(net);
  const breakdown = b.items.length
    ? b.items.map((it) => `${itemName(it)} ${fmtNum(it.unitWeightKg.value!)} kg × ${fmtNum(it.quantity.value!)} = ${fmtKg(dec(it.unitWeightKg.value!).times(it.quantity.value!))}`).join("; ")
    : "this booking has no items, so the product weight is 0 kg";
  inputs.push(computedInput("Product weight", fmtKg(net)));
  return ruleResult("R-07", BOOKING_SCOPE, {
    status: passed ? "pass" : "fail",
    found: `Gross weight ${fmtKg(gross)}; products alone weigh ${fmtKg(net)}.`,
    shouldBe: `At least ${fmtKg(net)} (${breakdown}), plus cartons and pallets.`,
    fix: {
      text: passed ? "" : `Your products alone weigh ${fmtKg(net)}, but gross weight says ${fmtKg(gross)}. Re-weigh the shipment; gross weight must include products, cartons and pallets.`,
      noApplyReason: "There's no single correct gross weight — only a re-weigh can tell.",
    },
    why: { formula: R07_FORMULA, inputs, result: `${fmtKg(gross)} ${passed ? "≥" : "<"} ${fmtKg(net)} → ${passed ? "pass" : "fail"}` },
  });
}
