import type { Booking, FieldValue, Item } from "../types";
import type { ChatFlags } from "./session";

// The "What to tell us" reference block beside the mic: everything the seller needs to say,
// ticked off as it's captured (from the booking itself, so it can't drift from the checks).

export type CheckState = "done" | "todo" | "unknown";

export interface ChecklistItem {
  label: string;
  example: string;
  state: CheckState;
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

export function tellUsChecklist(b: Booking, flags: ChatFlags): ChecklistGroup[] {
  const d = flags.declined;
  const one = (f: FieldValue<unknown>, key: string): CheckState => (has(f) ? "done" : d.includes(key) ? "unknown" : "todo");
  const p = (field: keyof Item, key = String(field)) => forProducts(b.items, field, d, key);
  const gross: CheckState = has(b.grossWeightKg) ? "done" : flags.grossUnknown ? "unknown" : "todo";
  const groups: ChecklistGroup[] = [
    {
      title: "Route",
      items: [
        { label: "Collection city", example: "London, Manchester, Birmingham or Leeds", state: one(b.originCity, "originCity") },
        { label: "Destination city", example: "Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam", state: one(b.destinationCity, "destinationCity") },
      ],
    },
    {
      title: "Each product",
      items: [
        { label: "What it is", example: "“ceramic coffee mugs”", state: b.items.length && b.items.every((it) => has(it.description)) ? "done" : "todo" },
        { label: "How many units", example: "“1,080 mugs”", state: p("quantity") },
        { label: "Price per unit (£)", example: "“£5 each”", state: p("unitPrice") },
        { label: "Units per box", example: "“12 to a box”", state: p("unitsPerCarton") },
        { label: "Weight of one unit", example: "“0.5 kg each” (or a box weight)", state: p("unitWeightKg") },
        { label: "Customs (HS) code", example: "“691200” — or say you don't know", state: p("hsCode") },
        { label: "Country where it's made", example: "“made in the UK”", state: p("countryOfOrigin") },
        { label: "SKU", example: "“MUG-01”", state: p("sku"), optional: true },
      ],
    },
    {
      title: "Packing",
      items: [
        { label: "Number of pallets", example: "“on 3 pallets”", state: one(b.pallets, "pallets") },
        { label: "Total weight", example: "“620 kg in total”, including boxes and pallets", state: gross },
      ],
    },
    {
      title: "Delivery",
      items: [
        { label: "Ready-to-ship date", example: "“ready next Thursday”", state: one(b.readyDate, "readyDate") },
        { label: "Warehouse or business address", example: "“an Amazon warehouse” / “a shop”", state: one(b.destinationType, "destinationType") },
        ...(b.destinationType.value === "Warehouse"
          ? [{ label: "Delivery slot booked?", example: "“slot booked” / “not yet”", state: one(b.appointmentBooked, "appointmentBooked") }]
          : []),
        { label: "What matters most", example: "cheapest, fastest, most reliable or balanced", state: one(b.priority, "priority") },
      ],
    },
    { title: "You", items: [{ label: "Seller (company) name", example: "“Northfield Goods”", state: one(b.sellerName, "sellerName") }] },
  ];
  return groups;
}

export const EXAMPLE_SENTENCE =
  "“I'm sending 1,080 ceramic mugs from Manchester to a warehouse in Frankfurt — £5 each, 12 to a box, half a kilo each, on 3 pallets, 620 kg in total. Ready next Thursday, cheapest please.”";
