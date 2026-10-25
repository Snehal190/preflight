import type { Booking, FieldValue, Item } from "../types";
import {
  CURRENCIES,
  DESTINATION_CITIES,
  DESTINATION_COUNTRIES,
  DESTINATION_TYPES,
  ITEM_ORIGIN_COUNTRIES,
  ORIGIN_CITIES,
  PRIORITIES,
  YES_NO,
} from "../reference/allowed";
import type { Cell } from "../parse/cells";
import { parseDate, parseDecimal, parseEnum, parseHsCode, parsePositiveInt, parseText, type Parsed } from "../parse/values";

// Seller edits on the Check page. The typed text goes through the same parsers as an upload, so a
// bad value becomes Missing data with its reason — never silently fixed. Source becomes "stated".

type Parser = (c: Cell | undefined) => Parsed<unknown>;

export const BOOKING_EDITABLE: Record<string, { label: string; parse: Parser }> = {
  sellerName: { label: "Seller name", parse: parseText },
  originCity: { label: "Origin city", parse: (c) => parseEnum(c, ORIGIN_CITIES) },
  destinationCity: { label: "Destination city", parse: (c) => parseEnum(c, DESTINATION_CITIES) },
  destinationCountry: { label: "Destination country", parse: (c) => parseEnum(c, DESTINATION_COUNTRIES) },
  destinationType: { label: "Destination type", parse: (c) => parseEnum(c, DESTINATION_TYPES) },
  readyDate: { label: "Ready to ship date", parse: parseDate },
  priority: { label: "Seller priority", parse: (c) => parseEnum(c, PRIORITIES) },
  pallets: { label: "Pallets", parse: parsePositiveInt },
  cartons: { label: "Cartons", parse: parsePositiveInt },
  declaredValue: { label: "Total declared value (£)", parse: (c) => parseDecimal(c, "gte0") },
  currency: { label: "Currency", parse: (c) => parseEnum(c, CURRENCIES) },
  grossWeightKg: { label: "Total gross weight (kg)", parse: (c) => parseDecimal(c, "gt0") },
  appointmentBooked: { label: "Delivery appointment booked", parse: (c) => parseEnum(c, YES_NO, { yesNo: true }) },
};

export const ITEM_EDITABLE: Record<string, { label: string; parse: Parser }> = {
  sku: { label: "SKU", parse: parseText },
  description: { label: "Description", parse: parseText },
  hsCode: { label: "HS code", parse: parseHsCode },
  quantity: { label: "Quantity", parse: parsePositiveInt },
  unitPrice: { label: "Unit price (£)", parse: (c) => parseDecimal(c, "gte0") },
  unitsPerCarton: { label: "Units per carton", parse: parsePositiveInt },
  cartons: { label: "Cartons", parse: parsePositiveInt },
  unitWeightKg: { label: "Unit weight (kg)", parse: (c) => parseDecimal(c, "gt0") },
  countryOfOrigin: { label: "Country of origin", parse: (c) => parseEnum(c, ITEM_ORIGIN_COUNTRIES) },
};

function toField(old: FieldValue<unknown>, text: string, parse: Parser): FieldValue<unknown> {
  const cell: Cell = text.trim() === "" ? { kind: "empty" } : { kind: "text", value: text };
  const p = parse(cell);
  const f: FieldValue<unknown> = { value: p.value, raw: p.raw, source: "stated", location: old.location };
  if (p.problem) f.problem = p.problem;
  return f;
}

export function editBookingField(b: Booking, field: string, text: string): Booking {
  const def = BOOKING_EDITABLE[field];
  if (!def) throw new Error(`Field ${field} can't be edited`);
  const next = structuredClone(b);
  (next as unknown as Record<string, FieldValue<unknown>>)[field] = toField((b as unknown as Record<string, FieldValue<unknown>>)[field], text, def.parse);
  return next;
}

export function editItemField(b: Booking, itemId: string, field: string, text: string): Booking {
  const def = ITEM_EDITABLE[field];
  if (!def) throw new Error(`Field ${field} can't be edited`);
  const next = structuredClone(b);
  const it = next.items.find((x) => x.itemId === itemId);
  if (!it) throw new Error(`No item ${itemId}`);
  const rec = it as unknown as Record<string, FieldValue<unknown>>;
  rec[field] = toField(rec[field], text, def.parse);
  if (field === "hsCode") (it as Item).hsWasNumeric = false;
  return next;
}
