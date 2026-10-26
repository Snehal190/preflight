import type { Item } from "../types";
import {
  DG_CATEGORY_LABEL,
  effectiveTier,
  hsHint,
  normaliseForMatch,
  scanKeywords,
  type DgCategory,
} from "../reference/dangerousGoods";
import type { CheckContext } from "./context";
import { input, itemName, itemScope, missingResult, ruleResult, withSku } from "./helpers";
import type { CheckResult } from "./types";

// R-06 — no lithium batteries, aerosols or flammable liquids (Red, per item). Spec §6 R-06.
// Keyword Red can never be cleared — not by the AI, not by a seller answer.
// AI can only ADD a flag. HS hints and uncertain AI produce a question.

/** How a seller would say it: "contains a lithium battery", "is an aerosol can". */
const PLAIN: Record<DgCategory, string> = {
  lithium: "contains a lithium battery",
  aerosol: "is an aerosol can",
  flammable_liquid: "is a flammable liquid",
};
const WHY_NOT = "Road carriers can't take lithium batteries, aerosols or flammable liquids on a normal pallet.";

const FORMULA = "Keyword match (not negated) OR AI flag with high confidence → Red; HS hint / ambiguous word / uncertain AI → ask";

/** Key for the seller's Yes/No answer. Includes the description so an edited description is re-asked. */
export function r06AnswerKey(it: Item): string {
  return `R-06:${it.itemId}:${normaliseForMatch(it.description.value ?? "")}`;
}

export function r06(it: Item, ctx: CheckContext): CheckResult {
  const name = itemName(it);
  const scope = itemScope(it);
  const inputs = withSku([input("Description", it.description), input("SKU", it.sku), input("HS code", it.hsCode)], it);
  const desc = it.description.value?.trim();
  if (!desc) {
    return missingResult("R-06", scope, [`${name}: description is blank, so we can't check it for dangerous goods.`], inputs, FORMULA, `Add a description for ${name}.`);
  }

  const fix: CheckResult["fix"] = {
    text: `Take ${name} off this booking, or send it separately with a dangerous-goods carrier.`,
    noApplyReason: "Dangerous goods need your own action.",
  };
  // The SKU is scanned on its own: a word in a SKU must never cancel a match in the description.
  const hits = [...scanKeywords(desc), ...scanKeywords(it.sku.value ?? "")];
  // Cite the most specific matching term ("power bank" rather than "mah").
  const red = hits.filter((h) => effectiveTier(h) === "red").sort((a, b) => b.term.length - a.term.length)[0];
  const ai = ctx.dgAi?.available ? ctx.dgAi.byItemId[it.itemId] : undefined;
  const negated = hits.filter((h) => h.negatedBy).map((h) => `"${h.term}" cancelled by "${h.negatedBy}"`);
  const aiInputs = ai ? [{ label: "AI review", value: `${ai.category} (${ai.confidence}), ${ai.reason}` }] : [];
  const allInputs = [...inputs, ...aiInputs];
  const negNote = negated.length ? ` (${negated.join("; ")})` : "";

  if (red) {
    return ruleResult("R-06", scope, {
      status: "fail",
      found: `${name} "${desc}" ${PLAIN[red.category]} (the description says "${red.term}"). ${WHY_NOT}`,
      shouldBe: "No lithium batteries, aerosols or flammable liquids.",
      fix,
      why: { formula: FORMULA, inputs: allInputs, result: `Keyword "${red.term}" (${red.category}) → Red${negNote}` },
    });
  }
  if (ai && ai.category !== "none" && ai.category !== "unsure" && ai.confidence === "high") {
    return ruleResult("R-06", scope, {
      status: "fail",
      found: `${name} "${desc}" ${PLAIN[ai.category]}. Our AI check: ${ai.reason} ${WHY_NOT}`,
      shouldBe: "No lithium batteries, aerosols or flammable liquids.",
      fix,
      why: { formula: FORMULA, inputs: allInputs, result: `AI flag ${ai.category}, high confidence → Red` },
    });
  }

  // Reasons to ask instead of deciding.
  const asks: { category: DgCategory | null; why: string }[] = [];
  for (const h of hits) {
    if (effectiveTier(h) === "ask") {
      asks.push({ category: h.category, why: h.downgradedBy ? `the description says "${h.term}" but also "${h.downgradedBy}"` : `the description says "${h.term}"` });
    }
  }
  const hint = hsHint(it.hsCode.value);
  if (hint) asks.push({ category: hint.category, why: `its HS code ${it.hsCode.value} is the customs code for ${hint.label}` });
  if (ai && ai.category === "unsure") asks.push({ category: null, why: `our AI check couldn't tell (${ai.reason.replace(/\.$/, "")})` });
  if (ai && ai.category !== "none" && ai.category !== "unsure" && ai.confidence !== "high") {
    asks.push({ category: ai.category, why: `our AI check thinks it may be ${DG_CATEGORY_LABEL[ai.category]} (${ai.reason.replace(/\.$/, "")})` });
  }

  if (asks.length) {
    const cat = asks.find((a) => a.category)?.category ?? null;
    const what = cat ? DG_CATEGORY_LABEL[cat] : "a lithium battery, an aerosol or a flammable liquid";
    const prompt = `Does '${desc}' contain ${what}?`;
    const answerKey = r06AnswerKey(it);
    const answer = ctx.answers?.[answerKey];
    const reasonText = asks.map((a) => a.why).join(", and ");
    if (answer === "yes") {
      return ruleResult("R-06", scope, {
        status: "fail",
        found: `${name}: you told us "${desc}" contains ${what}.`,
        shouldBe: "No lithium batteries, aerosols or flammable liquids.",
        fix,
        why: { formula: FORMULA, inputs: allInputs, result: `Asked because: ${reasonText}. Your answer: Yes → Red` },
        question: { prompt, answerKey },
      });
    }
    if (answer === "no") {
      return ruleResult("R-06", scope, {
        status: "pass",
        found: `${name}: you told us "${desc}" does not contain ${what}.`,
        shouldBe: "No lithium batteries, aerosols or flammable liquids.",
        fix: { text: "" },
        why: { formula: FORMULA, inputs: allInputs, result: `Asked because: ${reasonText}. Your answer: No → pass (recorded)` },
        question: { prompt, answerKey },
      });
    }
    return ruleResult("R-06", scope, {
      status: "needs_answer",
      found: `${name} "${desc}" may be dangerous goods: ${reasonText}. Please confirm whether it contains ${what}.`,
      shouldBe: "No lithium batteries, aerosols or flammable liquids.",
      fix: { text: `Answer Yes or No. If yes, take ${name} off this booking or send it with a dangerous-goods carrier.` },
      why: { formula: FORMULA, inputs: allInputs, result: `Asked because: ${reasonText}` },
      question: { prompt, answerKey },
    });
  }

  return ruleResult("R-06", scope, {
    status: "pass",
    found: `${name}: no dangerous-goods keywords${ai ? ", and the AI review found none" : ""}${negNote}.`,
    shouldBe: "No lithium batteries, aerosols or flammable liquids.",
    fix: { text: "" },
    why: { formula: FORMULA, inputs: allInputs, result: `No flags${negNote} → pass` },
  });
}
