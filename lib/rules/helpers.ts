import type { FieldValue, Item, Location } from "../types";
import { RULEBOOK, type RuleId } from "../reference/rulebook";
import { fmtNum } from "../format";
import type { CheckInput, CheckResult, CheckScope } from "./types";

export function input<T>(label: string, f: FieldValue<T>, display?: string): CheckInput {
  let value: string;
  if (display !== undefined) value = display;
  else if (f.value === null) value = f.raw ? `"${f.raw}" (unreadable)` : "(blank)";
  else if (typeof f.value === "number") value = fmtNum(f.value);
  else value = String(f.value);
  return { label, value, source: f.source, location: f.location };
}

/** Tags item inputs with the item's SKU so "Where" can name it (spec §3.4). */
export function withSku(inputs: CheckInput[], it: Item): CheckInput[] {
  return inputs.map((i) => ({ ...i, sku: itemName(it) }));
}

export function computedInput(label: string, value: string): CheckInput {
  return { label, value, source: "derived", location: null };
}

/** "Quantity is blank." / "Quantity: "2.5" isn't a whole number." */
export function missingText(label: string, f: FieldValue<unknown>): string {
  if (f.problem) return `${label}: ${f.problem}`;
  if (f.raw && f.raw.trim() !== "") return `${label}: "${f.raw}" couldn't be read.`;
  return `${label} is blank.`;
}

export function itemName(it: Item): string {
  if (it.sku.value) return it.sku.value;
  const row = it.sku.location?.kind === "cell" ? it.sku.location.row : null;
  if (row) return `Item in row ${row}`;
  return it.description.value ?? "Unnamed item";
}

export function itemScope(it: Item): CheckScope {
  return { kind: "item", itemId: it.itemId, sku: it.sku.value ?? itemName(it) };
}

export const BOOKING_SCOPE: CheckScope = { kind: "booking" };

/** Seller-facing title: plain words, no rule code (the code is in the Why? panel). */
export function ruleTitle(id: RuleId): string {
  return RULEBOOK[id].plainName;
}

export function resultId(ruleId: string, scope: CheckScope, suffix?: string): string {
  const base = scope.kind === "booking" ? `${ruleId}:booking` : `${ruleId}:item:${scope.itemId}`;
  return suffix ? `${base}:${suffix}` : base;
}

/** Shell for a rule result; callers fill the rest. */
export function ruleResult(ruleId: RuleId, scope: CheckScope, partial: Omit<CheckResult, "id" | "ruleId" | "title" | "severity" | "scope" | "whyItMatters"> & { idSuffix?: string }): CheckResult {
  const { idSuffix, ...rest } = partial;
  return {
    id: resultId(ruleId, scope, idSuffix),
    ruleId,
    title: ruleTitle(ruleId),
    severity: RULEBOOK[ruleId].severity,
    scope,
    whyItMatters: RULEBOOK[ruleId].whyItMatters,
    ...rest,
  };
}

/** A rule that can't run because inputs are missing (never "pass"). */
export function missingResult(ruleId: RuleId, scope: CheckScope, reasons: string[], inputs: CheckInput[], formula: string, fixText?: string): CheckResult {
  return ruleResult(ruleId, scope, {
    status: "missing_data",
    found: reasons.join(" "),
    shouldBe: `We need ${reasons.length === 1 ? "this value" : "these values"} to check "${RULEBOOK[ruleId].plainName}".`,
    fix: { text: fixText ?? "Fill in the missing value(s) above, then the check will run." },
    why: { formula, inputs, result: "Not run — missing data." },
  });
}

export function locationText(loc: Location | null | undefined, sku?: string | null, label?: string): string {
  if (!loc) return "";
  // Uploads: sheet + row + column (+ SKU). Chat: the field name (spec §3.4).
  const base = loc.kind === "cell" ? `${loc.sheet} sheet, row ${loc.row}, column "${loc.column}"` : `chat — ${label ?? "field"}`;
  return sku ? `${base} (SKU ${sku})` : base;
}
