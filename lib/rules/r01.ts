import type { Item } from "../types";
import type { CheckContext } from "./context";
import type { CheckResult } from "./types";
import { input, itemName, itemScope, missingResult, missingText, ruleResult } from "./helpers";
import { infoResult } from "./info";

// R-01 — HS code at least 6 digits (Red, per item). Blank is Red even though the template's
// Field Guide says the column "may be blank": the rulebook wins.

const FORMULA = "HS code must be a string of digits, at least 6 long";

export function r01(it: Item, ctx: CheckContext): CheckResult[] {
  const name = itemName(it);
  const desc = it.description.value ? ` — ${it.description.value}` : "";
  const scope = itemScope(it);
  const hs = it.hsCode;
  const inputs = [input("HS code", hs)];
  const out: CheckResult[] = [];

  const suggestion = ctx.hsSuggestions?.[it.itemId];
  const fix: CheckResult["fix"] = {
    text: `Enter the full HS code for ${name}${desc}.`,
    noApplyReason: "HS codes need your own check — we never fill them in for you.",
  };
  if (suggestion) {
    fix.suggestion = {
      label: "Suggestion — please verify. You are legally responsible for the code.",
      value: suggestion.code,
      reason: suggestion.reason,
    };
  }

  if (hs.unreadable) return [missingResult("R-01", scope, [missingText(`${name} HS code`, hs)], inputs, FORMULA)];

  const digits = hs.value;
  const raw = hs.raw?.trim() ?? "";

  if (digits === null) {
    const blank = raw === "";
    out.push(
      ruleResult("R-01", scope, {
        status: "fail",
        found: blank ? `${name}: No HS code.` : `${name}: HS code "${hs.raw}" isn't valid — ${hs.problem ?? "it contains characters other than digits"}.`,
        shouldBe: "At least 6 digits, e.g. 691200.",
        fix,
        why: { formula: FORMULA, inputs, result: blank ? "Blank → fail" : "Not all digits → fail" },
      }),
    );
    return out;
  }

  const len = digits.length;
  const leadingZeroHint = (guess: string) =>
    `Excel may have dropped a leading zero — did you mean ${guess}? If so, enter the code as text.`;

  if (len < 6) {
    if (it.hsWasNumeric && len === 5) fix.hint = leadingZeroHint(`0${digits}`);
    out.push(
      ruleResult("R-01", scope, {
        status: "fail",
        found: `${name}: HS code ${digits} has only ${len} digit${len === 1 ? "" : "s"}.`,
        shouldBe: "At least 6 digits.",
        fix,
        why: { formula: FORMULA, inputs, result: `${len} digits < 6 → fail` },
      }),
    );
    return out;
  }

  out.push(
    ruleResult("R-01", scope, {
      status: "pass",
      found: `${name}: HS code ${digits} (${len} digits).`,
      shouldBe: "At least 6 digits.",
      fix: { text: "" },
      why: { formula: FORMULA, inputs, result: `${len} digits ≥ 6 → pass` },
    }),
  );

  // Advisory notes on a passing code (Info tier, approved Q7).
  if (it.hsWasNumeric && (len === 7 || len === 9)) {
    out.push(
      infoResult(`hs-leading-zero:${it.itemId}`, scope, {
        found: `${name}: HS code ${digits} has ${len} digits and was typed as a number.`,
        shouldBe: "HS codes have an even number of digits (6, 8 or 10).",
        fix: { text: leadingZeroHint(`0${digits}`) },
        why: { formula: "Numeric cell with an odd digit count", inputs, result: "Possible lost leading zero" },
      }),
    );
  }
  if (len > 10) {
    out.push(
      infoResult(`hs-long:${it.itemId}`, scope, {
        found: `${name}: HS code ${digits} has ${len} digits.`,
        shouldBe: "HS codes are normally 6–10 digits.",
        fix: { text: "Check the code against your tariff classification." },
        why: { formula: "6 ≤ digits ≤ 10", inputs, result: `${len} digits` },
      }),
    );
  }
  if (/^0+$/.test(digits)) {
    out.push(
      infoResult(`hs-zero:${it.itemId}`, scope, {
        found: `${name}: HS code ${digits}.`,
        shouldBe: "This isn't a real HS code.",
        fix: { text: `Enter the real HS code for ${name}${desc}.` },
        why: { formula: "All zeros", inputs, result: "Not a real code" },
      }),
    );
  }
  const advice = ctx.hsAdvice?.[it.itemId];
  if (advice && !advice.fits && it.description.value) {
    out.push(
      infoResult(`hs-advice:${it.itemId}`, scope, {
        found: `AI advice: HS code ${digits} doesn't appear to match "${it.description.value}" — please check.`,
        shouldBe: advice.reason,
        fix: { text: "Check the code against your tariff classification. This is AI advice, not a rule." },
        why: { formula: "AI advisory (Gemini)", inputs: [...inputs, input("Description", it.description)], result: "Possible mismatch" },
      }),
    );
  }
  return out;
}
