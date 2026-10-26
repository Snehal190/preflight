import type { Booking, FieldValue } from "../types";
import type { CheckResult } from "../rules/types";
import { fmtDateLong, fmtGBP, fmtNum } from "../format";
import { itemName } from "../rules/helpers";
import { BOOKING_EDITABLE, ITEM_EDITABLE } from "./edit";
import { RULEBOOK, type RuleId } from "../reference/rulebook";
import type { Evaluation } from "./state";

// Change chips (spec §12.8): `Pallets 3 → 4` · `R-05: Red → Pass` · `Cost £660 → £880` · `Carrier unchanged`.

const MONEY = new Set(["declaredValue", "unitPrice"]);

function show(f: FieldValue<unknown> | undefined, field = ""): string {
  if (!f || f.value === null) return f?.raw ? `"${f.raw}" (unreadable)` : "(blank)";
  if (MONEY.has(field)) return fmtGBP(String(f.value));
  return typeof f.value === "number" ? fmtNum(f.value) : String(f.value);
}

export function statusLabel(r: CheckResult | undefined): string {
  if (!r) return "-";
  switch (r.status) {
    case "pass":
      return "Pass";
    case "not_applicable":
      return "N/A";
    case "missing_data":
      return "Missing info";
    case "needs_answer":
      return "Needs answer";
    case "fail":
      return r.severity === "red" ? "Red" : r.severity === "amber" ? "Amber" : "Info";
  }
}

function resultLabel(r: CheckResult): string {
  if (r.ruleId === "DATA") return `Missing info (${r.id.slice(5).split(":")[0]})`;
  if (r.ruleId === "INFO") return "Advice";
  const who = r.scope.kind === "item" ? ` (${r.scope.sku ?? "item"})` : r.id.endsWith(":preferred") ? " (preferred carrier)" : "";
  return `${RULEBOOK[r.ruleId as RuleId].plainName}${who}`;
}

export function changeChips(prevB: Booking, prevE: Evaluation, nextB: Booking, nextE: Evaluation): string[] {
  const chips: string[] = [];

  for (const [field, def] of Object.entries(BOOKING_EDITABLE)) {
    const a = (prevB as unknown as Record<string, FieldValue<unknown>>)[field];
    const b = (nextB as unknown as Record<string, FieldValue<unknown>>)[field];
    if (show(a) !== show(b)) chips.push(`${def.label.replace(/ \(.*\)$/, "")} ${show(a, field)} → ${show(b, field)}`);
  }
  for (const it of nextB.items) {
    const old = prevB.items.find((x) => x.itemId === it.itemId);
    if (!old) {
      chips.push(`Added ${itemName(it)}`);
      continue;
    }
    for (const [field, def] of Object.entries(ITEM_EDITABLE)) {
      const a = (old as unknown as Record<string, FieldValue<unknown>>)[field];
      const b = (it as unknown as Record<string, FieldValue<unknown>>)[field];
      if (show(a) !== show(b)) chips.push(`${itemName(it)} ${def.label.replace(/ \(.*\)$/, "").toLowerCase()} ${show(a, field)} → ${show(b, field)}`);
    }
  }
  for (const it of prevB.items) if (!nextB.items.some((x) => x.itemId === it.itemId)) chips.push(`Removed ${itemName(it)}`);

  const ids = new Set([...prevE.results, ...nextE.results].filter((r) => r.severity !== "info").map((r) => r.id));
  for (const id of ids) {
    const a = prevE.results.find((r) => r.id === id);
    const b = nextE.results.find((r) => r.id === id);
    // A result that vanished was missing data now filled (the field chip shows it); a new one
    // is only worth a chip if it isn't a pass.
    if (!b) continue;
    if (!a && (b.status === "pass" || b.status === "not_applicable")) continue;
    const la = statusLabel(a);
    const lb = statusLabel(b);
    if (la !== lb) chips.push(`${resultLabel(b)}: ${la} → ${lb}`);
  }

  const cost = (e: Evaluation) => e.carrier.rows.find((r) => r.id === e.carrier.chosen)?.totalCost ?? null;
  const ca = cost(prevE);
  const cb = cost(nextE);
  if (ca !== cb) chips.push(`Cost ${ca ? fmtGBP(ca) : "-"} → ${cb ? fmtGBP(cb) : "-"}`);
  const name = (e: Evaluation) => e.carrier.rows.find((r) => r.id === e.carrier.chosen)?.name ?? "none";
  chips.push(prevE.carrier.chosen === nextE.carrier.chosen ? "Carrier unchanged" : `Carrier ${name(prevE)} → ${name(nextE)}`);
  const del = (e: Evaluation) => (e.dates ? fmtDateLong(e.dates.delivery) : "-");
  if (del(prevE) !== del(nextE)) chips.push(`Delivery ${del(prevE)} → ${del(nextE)}`);
  return chips;
}
