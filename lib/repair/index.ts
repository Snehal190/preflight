import type { Booking, FieldValue } from "../types";
import { dec } from "../num";
import { fmtGBP, fmtNum } from "../format";
import { runChecks, type CheckContext, type CheckReport, type CheckResult } from "../rules";
import type { Patch, TestedFix } from "../rules/types";
import { itemName } from "../rules/helpers";
import { itemTotal } from "../rules/r02";
import { itemCartonTotal } from "../rules/r03r04";
import { typoPattern } from "./typo";
import { recomputeDerived } from "../booking/derived";
import { RULEBOOK, type RuleId } from "../reference/rulebook";

/** Seller-facing rule name in quotes, e.g. “Declared value matches the products”. */
function named(ruleId: string): string {
  return `“${RULEBOOK[ruleId as RuleId].plainName}”`;
}

// Fix-suggestion engine (spec §9). Proposes numeric edits, re-runs ALL rules on each single edit
// and each pair, throws away anything that creates a new problem, and ranks what's left.

const REPAIRABLE = new Set(["R-02", "R-03", "R-04", "R-05"]);
const MAX_SHOWN = 3;

/** Fixed field order for deterministic tie-breaks. */
const FIELD_ORDER = ["quantity", "cartons:item", "unitsPerCarton", "unitPrice", "cartons:booking", "declaredValue", "pallets"];

function fieldRank(p: Patch): number {
  const key = p.target === "item" ? (p.field === "cartons" ? "cartons:item" : p.field) : p.field === "cartons" ? "cartons:booking" : p.field;
  return FIELD_ORDER.indexOf(key);
}

function patchKey(p: Patch): string {
  return p.target === "item" ? `item:${p.itemId}:${p.field}` : `booking:${p.field}`;
}

function rawOf(f: FieldValue<unknown>): string | null {
  return f.value === null ? null : String(f.value);
}

/** Candidate single edits for the booking's current failures. */
export function candidateEdits(b: Booking, report: CheckReport): Patch[] {
  const out: Patch[] = [];
  const failing = (ruleId: string) => report.results.filter((r) => r.ruleId === ruleId && r.status === "fail" && !r.nonBlocking);

  const r03 = failing("R-03");
  const r02 = failing("R-02").length > 0;
  for (const it of b.items) {
    const q = it.quantity.value;
    const u = it.unitsPerCarton.value;
    const c = it.cartons.value;
    if (q === null || u === null || c === null || u * c === q) continue;
    if (!r03.some((r) => r.scope.kind === "item" && r.scope.itemId === it.itemId)) continue;
    const derived = (f: FieldValue<unknown>) => f.source === "derived";
    // Label for messages: the SKU, or the product's name when there's no SKU (chat bookings).
    const sku = it.sku.value ?? itemName(it);
    if (!derived(it.quantity)) out.push({ target: "item", itemId: it.itemId, sku, field: "quantity", from: String(q), to: String(u * c) });
    if (q % u === 0 && !derived(it.cartons)) out.push({ target: "item", itemId: it.itemId, sku, field: "cartons", from: String(c), to: String(q / u) });
    if (q % c === 0 && !derived(it.unitsPerCarton)) out.push({ target: "item", itemId: it.itemId, sku, field: "unitsPerCarton", from: String(u), to: String(q / c) });
  }

  if (failing("R-04").length && b.cartons.value !== null && b.cartons.source !== "derived") {
    const total = itemCartonTotal(b);
    if (total !== null && total > 0) out.push({ target: "booking", field: "cartons", from: rawOf(b.cartons), to: String(total) });
  }

  if (r02 && b.declaredValue.value !== null && b.declaredValue.source !== "derived") {
    const total = itemTotal(b);
    if (total !== null) out.push({ target: "booking", field: "declaredValue", from: rawOf(b.declaredValue), to: total.toFixed() });
  }

  const r05 = failing("R-05");
  if (r05.length && report.carrier.noneEligible && report.carrier.minPalletsAny && b.pallets.value !== null) {
    out.push({ target: "booking", field: "pallets", from: rawOf(b.pallets), to: String(report.carrier.minPalletsAny) });
  }
  return dedupe(out);
}

function dedupe(ps: Patch[]): Patch[] {
  const seen = new Map<string, Patch>();
  for (const p of ps) seen.set(`${patchKey(p)}=${p.to}`, p);
  return [...seen.values()];
}

/** Apply edits; edited fields get source "fixed" (old value kept by version history). */
export function applyPatches(b: Booking, patches: Patch[]): Booking {
  const next: Booking = structuredClone(b);
  for (const p of patches) {
    const fixed = (old: FieldValue<unknown>, value: number | string): FieldValue<number | string> => ({
      value,
      raw: String(value),
      source: "fixed",
      location: old.location,
    });
    if (p.target === "booking") {
      const v = p.field === "declaredValue" ? p.to : Number(p.to);
      (next as Record<string, unknown>)[p.field] = fixed(next[p.field], v);
    } else {
      const it = next.items.find((x) => x.itemId === p.itemId);
      if (!it) throw new Error(`No item ${p.itemId}`);
      const v = p.field === "unitPrice" ? p.to : Number(p.to);
      (it as Record<string, unknown>)[p.field] = fixed(it[p.field], v);
    }
  }
  recomputeDerived(next);
  return next;
}

/** A result that still needs work: blocking, or an Amber to check. Info and passes don't count. */
function problemIds(report: CheckReport): Set<string> {
  return new Set(
    report.results
      .filter((r) => r.severity !== "info" && !r.nonBlocking && (r.status === "fail" || r.status === "missing_data" || r.status === "needs_answer"))
      .map((r) => r.id),
  );
}

function fieldLabel(p: Patch): string {
  const names: Record<string, string> = { quantity: "quantity", cartons: "cartons", unitsPerCarton: "units per carton", unitPrice: "unit price", declaredValue: "declared value", pallets: "pallets" };
  return p.target === "item" ? `${p.sku ?? "item"} ${names[p.field]}` : p.field === "cartons" ? "booking cartons" : names[p.field];
}

function fmtPatchValue(p: Patch, v: string | null): string {
  if (v === null) return "(blank)";
  return p.field === "declaredValue" || p.field === "unitPrice" ? fmtGBP(v) : fmtNum(v);
}

/** The rule an edit was proposed for; other rules it clears are the supporting evidence. */
function primaryRule(p: Patch): string {
  if (p.target === "item") return "R-03";
  return p.field === "declaredValue" ? "R-02" : p.field === "cartons" ? "R-04" : "R-05";
}

function joinAnd(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

function ruleIdOf(resultId: string): string {
  return resultId.split(":")[0];
}

interface Evaluated {
  fix: TestedFix;
  clearedIds: string[];
}

function evaluate(b: Booking, ctx: CheckContext, baseProblems: Set<string>, baselineHasPreferred: boolean, patches: Patch[]): Evaluated | null {
  const edited = applyPatches(b, patches);
  const after = runChecks(edited, ctx);
  const afterProblems = problemIds(after);
  for (const id of afterProblems) if (!baseProblems.has(id)) return null; // creates a new failure
  const clearedIds = [...baseProblems].filter((id) => !afterProblems.has(id));
  if (clearedIds.length === 0) return null;

  const typos = patches.map((p) => (p.from !== null ? typoPattern(p.from, p.to) : null));
  const typo = typos.find((t) => t !== null) ?? null;
  const clearedRules = [...new Set(clearedIds.map(ruleIdOf))].sort();
  const score = 10 * clearedIds.length - 3 * patches.length + (typo ? 4 : 0);

  const summary = patches.map((p, i) => `${i === 0 ? "Change" : "change"} ${fieldLabel(p)} from ${fmtPatchValue(p, p.from)} to ${fmtPatchValue(p, p.to)}`).join(", and ");
  // "exactly": declared value equals the item total to the penny, not just within 1%.
  const editedTotal = itemTotal(edited);
  const exact = clearedRules.includes("R-02") && editedTotal !== null && edited.declaredValue.value !== null && dec(edited.declaredValue.value).eq(editedTotal);
  let evidence: string;
  if (patches.length === 1 && clearedRules.length > 1) {
    const p = patches[0];
    const primary = primaryRule(p);
    const others = clearedRules.filter((r) => r !== primary);
    evidence = `${joinAnd(others.map(named))} also pass${others.length === 1 ? "es" : ""}${exact ? " exactly" : ""} if ${fieldLabel(p)} = ${fmtPatchValue(p, p.to)}, so ${fmtPatchValue(p, p.to)} is very likely correct.`;
  } else {
    evidence = `With ${patches.length === 1 ? "this change" : "these changes"}, ${joinAnd(clearedRules.map(named))} pass${clearedRules.length === 1 ? "es" : ""}.`;
  }
  // The non-blocking R-05 note (preferred carrier over its limit) isn't a failure, but say so.
  const prefCard = after.results.find((r) => r.id === "R-05:booking:preferred");
  if (prefCard && !baselineHasPreferred) evidence += ` Note: ${prefCard.found}`;
  const badge = `Tested: fixes ${joinAnd(clearedRules.map(named))}, no new issues.`;
  return { fix: { patches, summary, evidence, typo, badge, clears: clearedRules, score }, clearedIds };
}

function compareFixes(a: TestedFix, b: TestedFix): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.patches.length !== b.patches.length) return a.patches.length - b.patches.length;
  const ra = a.patches.map(fieldRank).join(",");
  const rb = b.patches.map(fieldRank).join(",");
  if (ra !== rb) return ra < rb ? -1 : 1;
  const ka = a.patches.map((p) => `${patchKey(p)}=${p.to}`).join("|");
  const kb = b.patches.map((p) => `${patchKey(p)}=${p.to}`).join("|");
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export interface RepairOutcome {
  /** Ranked tested fixes per failing result ID (top 3). */
  byResult: Record<string, TestedFix[]>;
  /** Why Apply is never offered for this booking, if so. */
  blockedReason: string | null;
}

export function suggestFixes(b: Booking, ctx: CheckContext, baseline: CheckReport = runChecks(b, ctx)): RepairOutcome {
  if (b.integrity.duplicateIdRows && b.integrity.duplicateIdRows.length > 1) {
    return { byResult: {}, blockedReason: "This booking shares its ID with another, so we can't safely suggest number changes." };
  }
  const baseProblems = problemIds(baseline);
  const baselineHasPreferred = baseline.results.some((r) => r.id === "R-05:booking:preferred");
  const singles = candidateEdits(b, baseline);
  const tried = new Set<string>();
  const results: Evaluated[] = [];

  const tryCombo = (patches: Patch[]) => {
    const keys = patches.map(patchKey);
    if (new Set(keys).size !== keys.length) return; // two edits to the same field
    const sig = patches.map((p) => `${patchKey(p)}=${p.to}`).sort().join("|");
    if (tried.has(sig)) return;
    tried.add(sig);
    const ordered = [...patches].sort((x, y) => fieldRank(x) - fieldRank(y) || (patchKey(x) < patchKey(y) ? -1 : 1));
    const e = evaluate(b, ctx, baseProblems, baselineHasPreferred, ordered);
    if (e) results.push(e);
  };

  for (const s of singles) tryCombo([s]);
  // Pairs: every single, then every candidate implied by the booking after that edit.
  for (const s of singles) {
    const b1 = applyPatches(b, [s]);
    const second = candidateEdits(b1, runChecks(b1, ctx)).map((p) => ({ ...p, from: rawFromOriginal(b, p) }));
    for (const t of [...singles, ...second]) tryCombo([s, t]);
  }

  // A pair is only worth showing if it clears more than either of its edits alone.
  const singleCleared = new Map<string, Set<string>>();
  for (const e of results) if (e.fix.patches.length === 1) singleCleared.set(`${patchKey(e.fix.patches[0])}=${e.fix.patches[0].to}`, new Set(e.clearedIds));
  const minimal = results.filter((e) => {
    if (e.fix.patches.length === 1) return true;
    return e.fix.patches.every((p) => {
      const alone = singleCleared.get(`${patchKey(p)}=${p.to}`);
      return !alone || e.clearedIds.some((id) => !alone.has(id));
    });
  });

  const byResult: Record<string, TestedFix[]> = {};
  for (const r of baseline.results) {
    if (!REPAIRABLE.has(r.ruleId) || r.status !== "fail" || r.nonBlocking) continue;
    const fixes = minimal.filter((e) => e.clearedIds.includes(r.id)).map((e) => e.fix).sort(compareFixes);
    byResult[r.id] = fixes.slice(0, MAX_SHOWN);
  }
  return { byResult, blockedReason: null };
}

/** The original value of the field a patch touches (pairs are described against the seller's data). */
function rawFromOriginal(b: Booking, p: Patch): string | null {
  if (p.target === "booking") return rawOf(b[p.field]);
  const it = b.items.find((x) => x.itemId === p.itemId);
  return it ? rawOf(it[p.field]) : null;
}

/** Attach tested fixes (or an honest "can't tell") to each repairable failing result. */
export function withFixes(report: CheckReport, outcome: RepairOutcome, b: Booking): CheckResult[] {
  return report.results.map((r) => {
    if (!REPAIRABLE.has(r.ruleId) || r.status !== "fail" || r.nonBlocking) return r;
    if (outcome.blockedReason) return { ...r, fix: { ...r.fix, noApplyReason: outcome.blockedReason } };
    const fixes = outcome.byResult[r.id] ?? [];
    if (fixes.length) return { ...r, fix: { ...r.fix, tested: fixes } };
    return { ...r, fix: { ...r.fix, noApplyReason: cantTellText(r, b) } };
  });
}

function cantTellText(r: CheckResult, b: Booking): string {
  const names: string[] = [];
  if (r.ruleId === "R-03" && r.scope.kind === "item") {
    const it = b.items.find((x) => x.itemId === (r.scope as { itemId: string }).itemId);
    const n = it ? itemName(it) : "this item";
    names.push(`${n} quantity`, `${n} units per carton`, `${n} cartons`);
  } else if (r.ruleId === "R-02") {
    names.push("the declared value", "each item's quantity", "each item's unit price");
  } else if (r.ruleId === "R-04") {
    names.push("the booking's cartons", "each item's cartons");
  } else {
    names.push("the gross weight", "the pallet count");
  }
  return `We can't tell which number is wrong, please check ${joinAnd(names)}.`;
}
