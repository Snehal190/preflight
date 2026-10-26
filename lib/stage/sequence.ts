import type { CheckResult } from "../rules/types";
import { RULEBOOK, RULE_IDS, type RuleId } from "../reference/rulebook";

// The "Now checking" stage: the 10 rules in order, each with its worst state, in plain words.
// A check is "packed in the box" when it doesn't block take-off (pass, not needed, or a warning).

export type StepState = "pass" | "amber" | "fail" | "na" | "missing" | "question";

export interface StageStep {
  ruleId: RuleId;
  name: string;
  state: StepState;
  /** What we found, from the most serious result for this rule. */
  detail: string;
  why: string;
}

const RANK: Record<StepState, number> = { missing: 0, fail: 1, question: 2, amber: 3, pass: 4, na: 5 };

export function stepState(r: CheckResult): StepState {
  switch (r.status) {
    case "pass":
      return "pass";
    case "not_applicable":
      return "na";
    case "missing_data":
      return "missing";
    case "needs_answer":
      return "question";
    case "fail":
      return r.severity === "red" ? "fail" : "amber";
  }
}

export function checkSequence(results: CheckResult[]): StageStep[] {
  return RULE_IDS.map((ruleId) => {
    const rs = results.filter((r) => r.ruleId === ruleId && !r.nonBlocking);
    const worst = [...rs].sort((a, b) => RANK[stepState(a)] - RANK[stepState(b)])[0];
    const state: StepState = worst ? stepState(worst) : "na";
    return {
      ruleId,
      name: RULEBOOK[ruleId].plainName,
      state,
      detail: worst?.found ?? "",
      why: RULEBOOK[ruleId].whyItMatters,
    };
  });
}

export function isPacked(s: StepState): boolean {
  return s === "pass" || s === "na" || s === "amber";
}

export const STATE_LABEL: Record<StepState, string> = {
  pass: "OK",
  amber: "Please check",
  fail: "Must fix",
  na: "Not needed",
  missing: "Missing info",
  question: "Question for you",
};

/** Which booking fields to colour in the booking panel, from the results. */
export function fieldFlags(results: CheckResult[]): Record<string, "bad" | "warn"> {
  const FIELDS: Partial<Record<RuleId, string[]>> = {
    "R-01": ["hsCode"],
    "R-02": ["declaredValue"],
    "R-03": ["quantity", "cartons"],
    "R-04": ["cartons"],
    "R-05": ["pallets", "grossWeightKg"],
    "R-06": ["description"],
    "R-07": ["grossWeightKg"],
    "R-08": ["appointmentBooked"],
    "R-09": ["countryOfOrigin"],
    "R-10": ["readyDate"],
  };
  const out: Record<string, "bad" | "warn"> = {};
  for (const r of results) {
    if (r.nonBlocking || r.severity === "info" || r.status === "pass" || r.status === "not_applicable") continue;
    const level = r.status === "fail" && r.severity === "amber" ? "warn" : "bad";
    const fields = r.ruleId === "DATA" ? [r.id.slice(5).split(":")[0]] : (FIELDS[r.ruleId as RuleId] ?? []);
    for (const f of fields) if (out[f] !== "bad") out[f] = level;
  }
  return out;
}
