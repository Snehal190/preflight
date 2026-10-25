import Decimal from "decimal.js";

// All money and weight arithmetic goes through decimal.js (spec §6). No floats, no epsilons.

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function dec(v: string | number | Decimal): Decimal {
  return new Decimal(v);
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0));
}
