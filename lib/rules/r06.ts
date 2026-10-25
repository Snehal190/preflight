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
import { input, itemName, itemScope, missingResult, ruleResult } from "./helpers";
import type { CheckResult } from "./types";

// R-06 — no lithium batteries, aerosols or flammable liquids (Red, per item). Spec §6 R-06.
// Keyword Red can never be cleared — not by the AI, not by a seller answer.
// AI can only ADD a flag. HS hints and uncertain AI produce a question.

const FORMULA = "Keyword match (not negated) OR AI flag with high confidence → Red; HS hint / ambiguous word / uncertain AI → ask";

/** Key for the seller's Yes/No answer. Includes the description so an edited description is re-asked. */
export function r06AnswerKey(it: Item): string {
  return `R-06:${it.itemId}:${normaliseForMatch(it.description.value ?? "")}`;
}

export function r06(it: Item, ctx: CheckContext): CheckResult {
  const name = itemName(it);
  const scope = itemScope(it);
  const inputs = [input("Description", it.description), input("SKU", it.sku), input("HS code", it.hsCode)];
  const desc = it.description.value?.trim();
  if (!desc) {
    return missingResult("R-06", scope, [`${name}: description is blank, so we can't check it for dangerous goods.`], inputs, FORMULA, `Add a description for ${name}.`);
  }

  const fix: CheckResult["fix"] = {
    text: `Remove ${name} from this shipment, or ship it separately as dangerous goods.`,
    noApplyReason: "Dangerous goods need your own action.",
  };
  const hits = scanKeywords(`${desc} ${it.sku.value ?? ""}`);
  const red = hits.find((h) => effectiveTier(h) === "red");
  const ai = ctx.dgAi?.available ? ctx.dgAi.byItemId[it.itemId] : undefined;
  const negated = hits.filter((h) => h.negatedBy).map((h) => `"${h.term}" cancelled by "${h.negatedBy}"`);
  const aiInputs = ai ? [{ label: "AI review", value: `${ai.category} (${ai.confidence}) — ${ai.reason}` }] : [];
  const allInputs = [...inputs, ...aiInputs];
  const negNote = negated.length ? ` (${negated.join("; ")})` : "";

  if (red) {
    return ruleResult("R-06", scope, {
      status: "fail",
      found: `${name}: "${desc}" contains "${red.term}", which means ${DG_CATEGORY_LABEL[red.category]}.`,
      shouldBe: "No lithium batteries, aerosols or flammable liquids.",
      fix,
      why: { formula: FORMULA, inputs: allInputs, result: `Keyword "${red.term}" (${red.category}) → Red${negNote}` },
    });
  }
  if (ai && ai.category !== "none" && ai.category !== "unsure" && ai.confidence === "high") {
    return ruleResult("R-06", scope, {
      status: "fail",
      found: `${name}: AI review says "${desc}" is likely ${DG_CATEGORY_LABEL[ai.category]} — ${ai.reason}`,
      shouldBe: "No lithium batteries, aerosols or flammable liquids.",
      fix,
      why: { formula: FORMULA, inputs: allInputs, result: `AI flag ${ai.category}, high confidence → Red` },
    });
  }

  // Reasons to ask instead of deciding.
  const asks: { category: DgCategory | null; why: string }[] = [];
  for (const h of hits) {
    if (effectiveTier(h) === "ask") {
      asks.push({ category: h.category, why: h.downgradedBy ? `"${h.term}" with "${h.downgradedBy}"` : `"${h.term}"` });
    }
  }
  const hint = hsHint(it.hsCode.value);
  if (hint) asks.push({ category: hint.category, why: `HS code starts ${hint.prefix} (${hint.label})` });
  if (ai && ai.category === "unsure") asks.push({ category: null, why: `AI review unsure — ${ai.reason}` });
  if (ai && ai.category !== "none" && ai.category !== "unsure" && ai.confidence !== "high") {
    asks.push({ category: ai.category, why: `AI review: possibly ${DG_CATEGORY_LABEL[ai.category]} (${ai.confidence} confidence) — ${ai.reason}` });
  }

  if (asks.length) {
    const cat = asks.find((a) => a.category)?.category ?? null;
    const what = cat ? DG_CATEGORY_LABEL[cat] : "a lithium battery, an aerosol or a flammable liquid";
    const prompt = `Does '${desc}' contain ${what}?`;
    const answerKey = r06AnswerKey(it);
    const answer = ctx.answers?.[answerKey];
    const reasonText = asks.map((a) => a.why).join("; ");
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
      found: `${name}: we can't tell whether "${desc}" contains ${what} (${reasonText}).`,
      shouldBe: "No lithium batteries, aerosols or flammable liquids.",
      fix: { text: "Answer the question: Yes or No." },
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
