import { z } from "zod";
import {
  CURRENCIES,
  DESTINATION_CITIES,
  DESTINATION_COUNTRIES,
  DESTINATION_TYPES,
  ITEM_ORIGIN_COUNTRIES,
  ORIGIN_CITIES,
  PRIORITIES,
  YES_NO,
} from "./reference/allowed";

// Spec §4. Every booking/item field is a FieldValue: the value (or null), exactly what was typed,
// where it came from, and where it lives (cell or chat message).

export const FieldSourceSchema = z.enum(["file", "stated", "derived", "confirmed", "assumed", "fixed"]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

export const LocationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cell"),
    sheet: z.string(),
    /** 1-based spreadsheet row number. */
    row: z.number().int().positive(),
    column: z.string(),
  }),
  z.object({ kind: z.literal("chat"), messageId: z.string() }),
]);
export type Location = z.infer<typeof LocationSchema>;

export function fieldSchema<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullable(),
    /** Exactly as typed or spoken; null when the cell/answer was blank. */
    raw: z.string().nullable(),
    source: FieldSourceSchema,
    location: LocationSchema.nullable(),
    /** Why the value is null although something was typed (unreadable, not allowed, …). */
    problem: z.string().optional(),
    /** True when the value couldn't be read at all (e.g. formula with no saved value) → Missing data. */
    unreadable: z.boolean().optional(),
    /** Set when source is "assumed": the approved assumption used. */
    assumptionId: z.string().optional(),
    /** Set when source is "derived": the formula, with numbers. */
    formula: z.string().optional(),
  });
}

export interface FieldValue<T> {
  value: T | null;
  raw: string | null;
  source: FieldSource;
  location: Location | null;
  problem?: string;
  unreadable?: boolean;
  assumptionId?: string;
  formula?: string;
}

/** Non-negative decimal kept as a string so money/weights never pass through JS floats. */
export const DecimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal");
export const PositiveIntSchema = z.number().int().positive();
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const HsDigitsSchema = z.string().regex(/^\d+$/);

export const ItemSchema = z.object({
  /** Stable internal ID (row-based for uploads, generated for chat). */
  itemId: z.string(),
  sku: fieldSchema(z.string()),
  description: fieldSchema(z.string()),
  /** Digits only, or null. `hsCode.raw` holds the code exactly as found (hsCodeRaw). */
  hsCode: fieldSchema(HsDigitsSchema),
  /** True when the HS cell was a spreadsheet number (leading zeros may have been lost). */
  hsWasNumeric: z.boolean(),
  quantity: fieldSchema(PositiveIntSchema),
  unitPrice: fieldSchema(DecimalStringSchema),
  unitsPerCarton: fieldSchema(PositiveIntSchema),
  cartons: fieldSchema(PositiveIntSchema),
  unitWeightKg: fieldSchema(DecimalStringSchema),
  countryOfOrigin: fieldSchema(z.enum(ITEM_ORIGIN_COUNTRIES)),
});
export type Item = z.infer<typeof ItemSchema>;

export const BookingSchema = z.object({
  /** Internal key: batch + normalised booking ID (+ row when IDs are duplicated). */
  key: z.string(),
  bookingId: fieldSchema(z.string()),
  sellerName: fieldSchema(z.string()),
  originCity: fieldSchema(z.enum(ORIGIN_CITIES)),
  originCountry: fieldSchema(z.literal("United Kingdom")),
  destinationCity: fieldSchema(z.enum(DESTINATION_CITIES)),
  destinationCountry: fieldSchema(z.enum(DESTINATION_COUNTRIES)),
  destinationType: fieldSchema(z.enum(DESTINATION_TYPES)),
  readyDate: fieldSchema(IsoDateSchema),
  priority: fieldSchema(z.enum(PRIORITIES)),
  pallets: fieldSchema(PositiveIntSchema),
  cartons: fieldSchema(PositiveIntSchema),
  declaredValue: fieldSchema(DecimalStringSchema),
  currency: fieldSchema(z.enum(CURRENCIES)),
  grossWeightKg: fieldSchema(DecimalStringSchema),
  appointmentBooked: fieldSchema(z.enum(YES_NO)),
  items: z.array(ItemSchema),
  /** File-integrity problems that make the booking undecidable (spec §5.4). */
  integrity: z.object({
    /** Rows of every booking sharing this ID (length ≥ 2 means duplicated). */
    duplicateIdRows: z.array(z.number().int()).optional(),
  }),
});
export type Booking = z.infer<typeof BookingSchema>;
