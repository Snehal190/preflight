import type { Booking, FieldValue, Item } from "../types";
import type { ChatFlags } from "./session";
import { fmtDateLong, fmtGBP, fmtNum } from "../format";

// The "What to tell us" reference block beside the mic: everything the seller needs to say,
// ticked off as it's captured (from the booking itself, so it can't drift from the checks).

export type CheckState = "done" | "todo" | "unknown" | "problem";

export interface ChecklistItem {
  label: string;
  example: string;
  state: CheckState;
  /** What the seller actually gave (shown instead of the example once it's in). */
  value: string | null;
  optional?: boolean;
}

export interface ChecklistGroup {
  title: string;
  items: ChecklistItem[];
}

const has = (f: FieldValue<unknown>) => f.value !== null;

function forProducts(items: Item[], field: keyof Item, declined: string[], key: string): CheckState {
  if (items.length === 0) return "todo";
  if (items.every((it) => has(it[field] as FieldValue<unknown>))) return "done";
  if (items.every((it) => has(it[field] as FieldValue<unknown>) || declined.includes(`${key}:${it.itemId}`))) return "unknown";
  return "todo";
}

function show(f: FieldValue<unknown>): string | null {
  if (f.value === null) return null;
  return typeof f.value === "number" ? fmtNum(f.value) : String(f.value);
}

/**
 * `problems` marks fields a check has flagged (from the results), so a captured-but-wrong value
 * shows as a problem rather than a tick.
 */
export function tellUsChecklist(b: Booking, flags: ChatFlags, problems: Record<string, "bad" | "warn"> = {}): ChecklistGroup[] {
  const d = flags.declined;
  const values = (field: keyof Item, fmt: (v: string) => string = (v) => v) => {
    const vs = b.items.map((it) => show(it[field] as FieldValue<unknown>)).filter((v): v is string => v !== null).map(fmt);
    return vs.length ? vs.join(" · ") : null;
  };
  const one = (f: FieldValue<unknown>, key: string): CheckState => (has(f) ? "done" : d.includes(key) ? "unknown" : "todo");
  const p = (field: keyof Item, key = String(field)) => forProducts(b.items, field, d, key);
  const gross: CheckState = has(b.grossWeightKg) ? "done" : flags.grossUnknown ? "unknown" : "todo";
  const it = (label: string, example: string, state: CheckState, value: string | null, field?: string, optional = false): ChecklistItem => ({
    label,
    example,
    state: field && problems[field] && state !== "todo" ? "problem" : state,
    value,
    ...(optional ? { optional } : {}),
  });
  const groups: ChecklistGroup[] = [
    {
      title: "Route",
      items: [
        it("Collection city", "London, Manchester, Birmingham or Leeds", one(b.originCity, "originCity"), show(b.originCity)),
        it("Destination city", "Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam", one(b.destinationCity, "destinationCity"), show(b.destinationCity)),
      ],
    },
    {
      title: "Each product",
      items: [
        it("What it is", "“ceramic coffee mugs”", b.items.length && b.items.every((x) => has(x.description)) ? "done" : "todo", values("description"), "description"),
        it("How many units", "“1,080 mugs”", p("quantity"), values("quantity"), "quantity"),
        it("Price per unit (£)", "“£5 each”", p("unitPrice"), values("unitPrice", fmtGBP)),
        it("Units per box", "“12 to a box”", p("unitsPerCarton"), values("unitsPerCarton"), "cartons"),
        it("Weight of one unit", "“0.5 kg each” (or a box weight)", p("unitWeightKg"), values("unitWeightKg", (v) => `${v} kg`)),
        it("Customs (HS) code", "“691200” — or say you don't know", p("hsCode"), values("hsCode"), "hsCode"),
        it("Country where it's made", "“made in the UK”", p("countryOfOrigin"), values("countryOfOrigin"), "countryOfOrigin"),
        it("SKU", "“MUG-01”", p("sku"), values("sku"), undefined, true),
      ],
    },
    {
      title: "Packing",
      items: [
        it("Number of pallets", "“on 3 pallets”", one(b.pallets, "pallets"), show(b.pallets), "pallets"),
        it("Total weight", "“620 kg in total”, including boxes and pallets", gross, b.grossWeightKg.value ? `${fmtNum(b.grossWeightKg.value)} kg` : null, "grossWeightKg"),
      ],
    },
    {
      title: "Delivery",
      items: [
        it("Ready-to-ship date", "“ready next Thursday”", one(b.readyDate, "readyDate"), b.readyDate.value ? fmtDateLong(b.readyDate.value) : null, "readyDate"),
        it("Warehouse or business address", "“an Amazon warehouse” / “a shop”", one(b.destinationType, "destinationType"), show(b.destinationType)),
        ...(b.destinationType.value === "Warehouse"
          ? [it("Delivery slot booked?", "“slot booked” / “not yet”", one(b.appointmentBooked, "appointmentBooked"), show(b.appointmentBooked), "appointmentBooked")]
          : []),
        it("What matters most", "cheapest, fastest, most reliable or balanced", one(b.priority, "priority"), show(b.priority)),
      ],
    },
    { title: "You", items: [it("Seller (company) name", "“Northfield Goods”", one(b.sellerName, "sellerName"), show(b.sellerName))] },
  ];
  return groups;
}

export const EXAMPLE_SENTENCE =
  "“I'm sending 1,080 ceramic mugs from Manchester to a warehouse in Frankfurt — £5 each, 12 to a box, half a kilo each, on 3 pallets, 620 kg in total. Ready next Thursday, cheapest please.”";
