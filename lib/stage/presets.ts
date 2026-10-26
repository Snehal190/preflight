import type { Booking, FieldValue, Item } from "../types";
import { addDays, dayOfWeek } from "../dates/today";

// Sample bookings for the one-screen check. Built like an upload (source "file", with cells) so
// every card can say where a value came from. Dates are relative to today so demos never go stale.

function nextWorkingDay(iso: string, plus: number): string {
  let d = addDays(iso, plus);
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, 1);
  return d;
}

let row = 3;
function cell<T>(value: T | null, column: string, sheet = "Bookings"): FieldValue<T> {
  return { value, raw: value === null ? null : String(value), source: "file", location: { kind: "cell", sheet, row, column } };
}

interface ItemSpec {
  sku: string;
  description: string;
  hs: string | null;
  qty: number;
  price: string;
  upc: number;
  cartons: number;
  kg: string;
  origin: Item["countryOfOrigin"]["value"];
}

interface PresetSpec {
  id: string;
  seller: string;
  origin: Booking["originCity"]["value"];
  city: Booking["destinationCity"]["value"];
  country: Booking["destinationCountry"]["value"];
  type: Booking["destinationType"]["value"];
  readyInDays: number;
  priority: Booking["priority"]["value"];
  pallets: number;
  cartons: number;
  declared: string;
  gross: string;
  appointment: Booking["appointmentBooked"]["value"];
  items: ItemSpec[];
}

function build(p: PresetSpec, today: string, r: number): Booking {
  row = r;
  const ready = p.readyInDays >= 0 ? nextWorkingDay(today, p.readyInDays) : addDays(today, p.readyInDays);
  const items: Item[] = p.items.map((it, i) => {
    row = r + i;
    return {
      itemId: `${p.id}-${i + 1}`,
      sku: cell(it.sku, "SKU", "Items"),
      description: cell(it.description, "Description", "Items"),
      hsCode: cell(it.hs, "HS code", "Items"),
      hsWasNumeric: false,
      quantity: cell(it.qty, "Quantity", "Items"),
      unitPrice: cell(it.price, "Unit price", "Items"),
      unitsPerCarton: cell(it.upc, "Units per carton", "Items"),
      cartons: cell(it.cartons, "Cartons", "Items"),
      unitWeightKg: cell(it.kg, "Unit weight (kg)", "Items"),
      countryOfOrigin: cell(it.origin, "Country of origin", "Items"),
    };
  });
  row = r;
  return {
    key: p.id,
    bookingId: cell(p.id, "Booking ID"),
    sellerName: cell(p.seller, "Seller name"),
    originCity: cell(p.origin, "Origin"),
    originCountry: cell("United Kingdom" as const, "Origin"),
    destinationCity: cell(p.city, "Destination"),
    destinationCountry: cell(p.country, "Destination"),
    destinationType: cell(p.type, "Destination type"),
    readyDate: cell(ready, "Ready to ship date"),
    priority: cell(p.priority, "Seller priority"),
    pallets: cell(p.pallets, "Pallets"),
    cartons: cell(p.cartons, "Cartons"),
    declaredValue: cell(p.declared, "Total declared value"),
    currency: cell("GBP" as const, "Currency"),
    grossWeightKg: cell(p.gross, "Total gross weight (kg)"),
    appointmentBooked: cell(p.appointment, "Delivery appointment booked"),
    items,
    integrity: {},
  };
}

const MUGS: ItemSpec = { sku: "MUG-01", description: "Ceramic coffee mug, 350 ml", hs: "691200", qty: 1080, price: "5", upc: 12, cartons: 90, kg: "0.5", origin: "United Kingdom" };

export const PRESETS: { id: string; label: string; spec: PresetSpec }[] = [
  {
    id: "BK-012",
    label: "BK-012 · Northfield Goods: all clear",
    spec: { id: "BK-012", seller: "Northfield Goods", origin: "Manchester", city: "Frankfurt", country: "Germany", type: "Warehouse", readyInDays: 4, priority: "Cheapest", pallets: 3, cartons: 90, declared: "5400", gross: "620", appointment: "Yes", items: [MUGS] },
  },
  {
    id: "BK-102",
    label: "BK-102 · Typo Traders: quantity typo",
    spec: { id: "BK-102", seller: "Typo Traders", origin: "Leeds", city: "Paris", country: "France", type: "Warehouse", readyInDays: 6, priority: "Cheapest", pallets: 3, cartons: 90, declared: "5400", gross: "1000", appointment: "Yes", items: [{ ...MUGS, qty: 1800 }] },
  },
  {
    id: "BK-105",
    label: "BK-105 · Gadget Hub: dangerous goods",
    spec: {
      id: "BK-105", seller: "Gadget Hub", origin: "London", city: "Rotterdam", country: "Netherlands", type: "Business address", readyInDays: 5, priority: "Cheapest", pallets: 1, cartons: 20, declared: "500", gross: "120", appointment: "No",
      items: [
        { sku: "PB-01", description: "Portable power bank 10000mAh", hs: "850760", qty: 100, price: "3", upc: 10, cartons: 10, kg: "0.3", origin: "China" },
        { sku: "CH-01", description: "Portable charger", hs: "850760", qty: 100, price: "2", upc: 10, cartons: 10, kg: "0.2", origin: "China" },
      ],
    },
  },
  {
    id: "BK-104",
    label: "BK-104 · Heavy Haul: too heavy for express",
    spec: { id: "BK-104", seller: "Heavy Haul", origin: "Manchester", city: "Berlin", country: "Germany", type: "Business address", readyInDays: 3, priority: "Fastest", pallets: 4, cartons: 100, declared: "12000", gross: "1800", appointment: "No", items: [{ sku: "TILE-01", description: "Ceramic floor tile", hs: "690721", qty: 2400, price: "5", upc: 24, cartons: 100, kg: "0.6", origin: "Turkey" }] },
  },
  {
    id: "BK-107",
    label: "BK-107 · Late Larry: box count + past date",
    spec: { id: "BK-107", seller: "Late Larry", origin: "Birmingham", city: "Frankfurt", country: "Germany", type: "Warehouse", readyInDays: -10, priority: "Cheapest", pallets: 3, cartons: 100, declared: "5400", gross: "620", appointment: "No", items: [MUGS] },
  },
];

export function presetBooking(id: string, today: string): Booking {
  const i = PRESETS.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(`Unknown preset ${id}`);
  // Business-address presets don't need an appointment: leave it blank like a real sheet would.
  const b = build(PRESETS[i].spec, today, 3 + i);
  if (b.destinationType.value === "Business address") b.appointmentBooked = { ...b.appointmentBooked, value: null, raw: null };
  return b;
}
