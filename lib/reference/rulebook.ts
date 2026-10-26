// The official rulebook (spec §2.3). Severity comes ONLY from this table.

export type RuleId = "R-01" | "R-02" | "R-03" | "R-04" | "R-05" | "R-06" | "R-07" | "R-08" | "R-09" | "R-10";
export type RuleSeverity = "red" | "amber";

export interface RuleDef {
  id: RuleId;
  shortName: string;
  /** What sellers see — no rule codes (they don't know the rulebook). */
  plainName: string;
  /** One sentence: what we check, in everyday words. */
  plainCheck: string;
  rule: string;
  severity: RuleSeverity;
  whyItMatters: string;
}

export const RULEBOOK: Record<RuleId, RuleDef> = {
  "R-01": {
    id: "R-01",
    plainName: "Customs (HS) code",
    plainCheck: "Every product needs its full customs code, at least 6 digits.",
    shortName: "HS code at least 6 digits",
    rule: "Every item must have an HS code of at least 6 digits",
    severity: "red",
    whyItMatters:
      "Customs uses the HS code to decide duty and restrictions. Without a valid code, the goods will be held.",
  },
  "R-02": {
    id: "R-02",
    plainName: "Declared value matches the products",
    plainCheck: "The total value you declare must match quantity × price for your products (within 1%).",
    shortName: "Declared value ≠ item total",
    rule: "Total declared value must equal the sum of quantity × unit price across all items (within 1%)",
    severity: "red",
    whyItMatters:
      "Customs relies on the declared value. If it doesn't match the invoice lines, the shipment is held.",
  },
  "R-03": {
    id: "R-03",
    plainName: "Units, boxes and quantity add up",
    plainCheck: "For each product, units per box × number of boxes must equal the quantity.",
    shortName: "Units × cartons ≠ quantity",
    rule: "For each item, units per carton × cartons must equal quantity",
    severity: "red",
    whyItMatters:
      "The receiving warehouse counts cartons and units. A mismatch gets reported as missing stock.",
  },
  "R-04": {
    id: "R-04",
    plainName: "Box count matches the products",
    plainCheck: "The booking's total boxes must equal the boxes of all products added together.",
    shortName: "Booking cartons ≠ item cartons",
    rule: "Total cartons on the booking must equal the sum of cartons across all items",
    severity: "red",
    whyItMatters:
      "The warehouse checks the carton count against the booking. A mismatch means a dispute or a refused delivery.",
  },
  "R-05": {
    id: "R-05",
    plainName: "Pallet weight within the carrier's limit",
    plainCheck: "Total weight ÷ pallets must not be more than the carrier accepts per pallet.",
    shortName: "Weight per pallet over carrier max",
    rule: "Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet",
    severity: "red",
    whyItMatters: "The carrier will refuse an overweight pallet at collection.",
  },
  "R-06": {
    id: "R-06",
    plainName: "No dangerous goods",
    plainCheck: "No lithium batteries, aerosols or flammable liquids on a normal road shipment.",
    shortName: "Dangerous goods",
    rule: "No lithium batteries, aerosols or flammable liquids",
    severity: "red",
    whyItMatters:
      "These goods need special dangerous-goods paperwork and handling. A normal road shipment will be stopped.",
  },
  "R-07": {
    id: "R-07",
    plainName: "Total weight is realistic",
    plainCheck: "Total gross weight must be at least what the products alone weigh.",
    shortName: "Gross weight below product weight",
    rule: "Total gross weight must be at least the sum of unit weight × quantity across all items",
    severity: "amber",
    whyItMatters:
      "The declared gross weight is physically impossible, so the carrier and customs will question it.",
  },
  "R-08": {
    id: "R-08",
    plainName: "Warehouse delivery slot",
    plainCheck: "Deliveries to a warehouse need a delivery appointment booked.",
    shortName: "Warehouse needs an appointment",
    rule: "Shipments to a warehouse must have a delivery appointment booked",
    severity: "amber",
    whyItMatters:
      "Warehouses turn away trucks that arrive without a booked slot, causing re-delivery fees and delays.",
  },
  "R-09": {
    id: "R-09",
    plainName: "Country of origin",
    plainCheck: "Every product needs the country where it was made.",
    shortName: "Country of origin missing",
    rule: "Every item must have a country of origin",
    severity: "amber",
    whyItMatters: "Customs needs where the goods were made to calculate duty.",
  },
  "R-10": {
    id: "R-10",
    plainName: "Ready date",
    plainCheck: "The ready-to-ship date can't be in the past.",
    shortName: "Ready date in the past",
    rule: "Ready to ship date must not be in the past",
    severity: "amber",
    whyItMatters: "Collection can't be arranged for a date that has passed.",
  },
};

export const RULE_IDS = Object.keys(RULEBOOK) as RuleId[];
