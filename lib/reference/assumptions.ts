// Approved assumptions (spec §3.2). Any new entry needs product-owner approval and a line in ASSUMPTIONS.md.

export type AssumptionId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9";

export interface Assumption {
  id: AssumptionId;
  /** Short text shown after the bold "ASSUMPTION:" label. */
  label: string;
  why: string;
}

export const EMPTY_PALLET_KG = "25";

export const ASSUMPTIONS: Record<AssumptionId, Assumption> = {
  A1: {
    id: "A1",
    label: `empty pallet weight = ${EMPTY_PALLET_KG} kg (standard UK wooden pallet)`,
    why: "You didn't know your gross weight or your pallet weight, so we estimated it.",
  },
  A2: {
    id: "A2",
    label: "transit days are working days (Mon–Fri, excluding public holidays)",
    why: "The carrier rate card doesn't say whether transit days are calendar or working days.",
  },
  A3: {
    id: "A3",
    label: "the 1% tolerance on the declared value is measured against the products' total (quantity × price)",
    why: "The rulebook doesn't say what the 1% is measured against.",
  },
  A4: {
    id: "A4",
    label: "no SKU given, so items are numbered ITEM-1, ITEM-2, …",
    why: "You said the item has no SKU.",
  },
  A5: {
    id: "A5",
    label: "route priced on the country column",
    why: "The destination city isn't in the destination country, so we used the country to price the route.",
  },
  A6: {
    id: "A6",
    label: "unit weight = carton weight ÷ units per carton, which includes the carton's own packaging",
    why: "You gave a carton weight instead of a unit weight.",
  },
  A7: {
    id: "A7",
    label: "delivery appointment set to No for a business address (no delivery slot needed)",
    why: "Appointments are only needed for warehouse deliveries.",
  },
  A8: {
    id: "A8",
    label: "public holidays not checked (holiday service unavailable)",
    why: "We couldn't reach the public-holiday service, so only weekends were skipped.",
  },
  A9: {
    id: "A9",
    label: "net weight unknown, eligibility checked on gross weight only",
    why: "At least one item has no unit weight, so we can't compute the product weight.",
  },
};
