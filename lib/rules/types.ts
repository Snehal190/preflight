import type { AssumptionId } from "../reference/assumptions";
import type { CarrierId } from "../reference/carriers";
import type { RuleId } from "../reference/rulebook";
import type { FieldSource, Location } from "../types";

// Spec §4.3 / §3.4: everything an issue card needs, produced by code only.

export type CheckStatus = "pass" | "fail" | "not_applicable" | "missing_data" | "needs_answer";
export type Severity = "red" | "amber" | "info";

export type CheckScope = { kind: "booking" } | { kind: "item"; itemId: string; sku: string | null };

export interface CheckInput {
  label: string;
  /** Display value, e.g. "1,800" or "(blank)". */
  value: string;
  source?: FieldSource;
  location?: Location | null;
  /** SKU of the item this input belongs to (shown in "Where"). */
  sku?: string | null;
}

export type BookingPatchField = "pallets" | "cartons" | "declaredValue";
export type ItemPatchField = "quantity" | "unitPrice" | "unitsPerCarton" | "cartons";

/** A numeric edit the repair engine has tested (spec §9). */
export type Patch =
  | { target: "booking"; field: BookingPatchField; from: string | null; to: string }
  | { target: "item"; itemId: string; sku: string | null; field: ItemPatchField; from: string | null; to: string };

export interface TestedFix {
  patches: Patch[];
  /** "Change quantity of MUG-01 from 1,800 to 1,080". */
  summary: string;
  /** "R-02 also passes exactly if quantity = 1,080, so 1,080 is very likely correct." */
  evidence: string;
  /** "Looks like two digits were swapped." */
  typo: string | null;
  /** "Tested: clears R-02 and R-03, no new issues." */
  badge: string;
  clears: string[];
  score: number;
}

export interface CheckResult {
  /** Stable per booking: "R-03:item:<itemId>", "R-05:preferred", "INFO:dup-sku:MUG-01", "DATA:sellerName". */
  id: string;
  ruleId: RuleId | "INFO" | "DATA";
  /** "R-03 · Units × cartons ≠ quantity", "Info", "Missing data". */
  title: string;
  status: CheckStatus;
  /** From the rulebook for R-xx; "info" for INFO; null for DATA (Missing data is a state). */
  severity: Severity | null;
  /** A Red fail that doesn't block (the R-05 preferred-carrier visibility card). */
  nonBlocking?: boolean;
  scope: CheckScope;
  /** What we found — with the actual values. */
  found: string;
  /** What it should be — the formula with real numbers. */
  shouldBe: string;
  whyItMatters: string;
  fix: {
    text: string;
    /** Extra hint, e.g. the leading-zero hint on R-01. */
    hint?: string;
    /** AI suggestion, always labelled; never auto-applied. */
    suggestion?: { label: string; value: string; reason: string };
    tested?: TestedFix[];
    /** Why no Apply button is offered, when relevant. */
    noApplyReason?: string;
  };
  /** Why? panel. */
  why: { formula: string; inputs: CheckInput[]; result: string };
  /** Needs-your-answer question with Yes/No answers. */
  question?: { prompt: string; answerKey: string };
  assumptions?: AssumptionId[];
  carrierId?: CarrierId;
}

export function isBlocking(r: CheckResult): boolean {
  if (r.status === "missing_data" || r.status === "needs_answer") return true;
  return r.status === "fail" && r.severity === "red" && !r.nonBlocking;
}

export function needsAcknowledgement(r: CheckResult): boolean {
  return r.status === "fail" && r.severity === "amber";
}
