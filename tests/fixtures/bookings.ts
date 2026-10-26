import type { Booking, FieldValue, Item } from "@/lib/types";

// Test builders. Every field defaults to source "file" at a plausible cell, mirroring an upload.

let row = 3;
export function fv<T>(value: T | null, raw?: string | null, column = "x"): FieldValue<T> {
  return {
    value,
    raw: raw === undefined ? (value === null ? null : String(value)) : raw,
    source: "file",
    location: { kind: "cell", sheet: "Bookings", row, column },
  };
}

export function item(overrides: Partial<Item> = {}, id = "it-1"): Item {
  return {
    itemId: id,
    sku: fv("MUG-01"),
    description: fv("Ceramic coffee mug, 350 ml"),
    hsCode: fv("691200"),
    hsWasNumeric: false,
    quantity: fv(1080),
    unitPrice: fv("5.00"),
    unitsPerCarton: fv(12),
    cartons: fv(90),
    unitWeightKg: fv("0.5"),
    countryOfOrigin: fv("United Kingdom" as const),
    ...overrides,
  };
}

/** BK-001 exactly as in the template (spec §2.4). */
export function bk001(overrides: Partial<Booking> = {}): Booking {
  row = 3;
  return {
    key: "batch:BK-001",
    bookingId: fv("BK-001"),
    sellerName: fv("Northfield Goods"),
    originCity: fv("Leeds" as const),
    originCountry: fv("United Kingdom" as const),
    destinationCity: fv("Frankfurt" as const),
    destinationCountry: fv("Germany" as const),
    destinationType: fv("Warehouse" as const),
    readyDate: fv("2026-11-05", "05-11-2026"),
    priority: fv("Cheapest" as const),
    pallets: fv(3),
    cartons: fv(90),
    declaredValue: fv("5400"),
    currency: fv("GBP" as const),
    grossWeightKg: fv("620"),
    appointmentBooked: fv("Yes" as const),
    items: [item()],
    integrity: {},
    ...overrides,
  };
}

/** A day before BK-001's ready date, so R-10 passes. */
export const TODAY = "2026-10-25";
