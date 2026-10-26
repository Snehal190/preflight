import type { Booking, FieldValue, Item } from "../types";
import { dec, sum } from "../num";
import { fmtGBP, fmtNum } from "../format";

// Values code worked out (source "derived") are recomputed whenever their inputs change — e.g.
// after a fix is applied. Values the seller stated or confirmed are never touched (spec §4.2).

const isDerived = (f: FieldValue<unknown>) => f.source === "derived" && f.value !== null;

function recomputeItem(it: Item): void {
  const q = it.quantity;
  const u = it.unitsPerCarton;
  const c = it.cartons;
  if (isDerived(q) && u.value !== null && c.value !== null) it.quantity = { ...q, value: u.value * c.value, formula: `${fmtNum(u.value)} per carton × ${fmtNum(c.value)} cartons` };
  else if (isDerived(c) && q.value !== null && u.value !== null && q.value % u.value === 0) it.cartons = { ...c, value: q.value / u.value, formula: `${fmtNum(q.value)} units ÷ ${fmtNum(u.value)} per carton` };
  else if (isDerived(u) && q.value !== null && c.value !== null && q.value % c.value === 0) it.unitsPerCarton = { ...u, value: q.value / c.value, formula: `${fmtNum(q.value)} units ÷ ${fmtNum(c.value)} cartons` };
}

export function recomputeDerived(b: Booking): void {
  for (const it of b.items) recomputeItem(it);
  if (isDerived(b.cartons) && b.items.length && b.items.every((it) => it.cartons.value !== null)) {
    const parts = b.items.map((it) => it.cartons.value!);
    const total = parts.reduce((n, x) => n + x, 0);
    b.cartons = { ...b.cartons, value: total, formula: `sum of product cartons: ${parts.map(fmtNum).join(" + ")}${parts.length > 1 ? ` = ${fmtNum(total)}` : ""}` };
  }
  if (isDerived(b.declaredValue) && b.items.length && b.items.every((it) => it.quantity.value !== null && it.unitPrice.value !== null)) {
    const total = sum(b.items.map((it) => dec(it.quantity.value!).times(it.unitPrice.value!)));
    b.declaredValue = { ...b.declaredValue, value: total.toFixed(), formula: b.items.map((it) => `${fmtNum(it.quantity.value!)} × ${fmtGBP(it.unitPrice.value!)}`).join(" + ") };
  }
}
