import { z } from "zod";
import { BookingSchema, type Booking, type FieldValue } from "../types";
import { BookingStateSchema, emptyState } from "../booking/state";

// One chat = one booking (spec §12.9). The whole session travels with each message (until the DB
// step), validated with Zod on the server.

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(6000),
  /** True when the seller's message came from a (corrected) voice transcript. */
  transcript: z.boolean(),
  at: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatFlagsSchema = z.object({
  /** Items we've asked for a SKU once. */
  skuAsked: z.array(z.string()),
  /** "field" or "field:itemId" the seller said they don't know (not asked again). */
  declined: z.array(z.string()),
  grossUnknown: z.boolean(),
  palletWeightUnknown: z.boolean(),
  palletWeightKg: z.string().nullable(),
  /** Carton weights given instead of unit weights, by item. */
  cartonWeights: z.record(z.string(), z.string()),
  readbackShown: z.boolean(),
  readbackConfirmed: z.boolean(),
  dateConfirmed: z.boolean(),
  pendingHs: z.object({ itemId: z.string(), code: z.string(), reason: z.string() }).nullable(),
  itemCounter: z.number().int(),
  generatedSkus: z.number().int(),
  /** A check problem asked as a yes/no question (one at a time, so "yes" is never ambiguous). */
  pendingIssue: z
    .object({ resultId: z.string(), prompt: z.string(), action: z.any() })
    .nullable()
    .default(null),
  /** Problems already asked about (by finding), so we don't nag every turn. */
  issuesAsked: z.array(z.string()).default([]),
});
export type ChatFlags = z.infer<typeof ChatFlagsSchema>;

export const ChatSessionSchema = z.object({
  id: z.string(),
  booking: BookingSchema,
  state: BookingStateSchema,
  messages: z.array(ChatMessageSchema).max(400),
  flags: ChatFlagsSchema,
  lastQuestion: z.string().nullable(),
  aiUnavailable: z.boolean(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

/** A field nobody has given yet. */
export function blank<T>(): FieldValue<T> {
  return { value: null, raw: null, source: "stated", location: null };
}

export function isGiven(f: FieldValue<unknown>): boolean {
  return !(f.value === null && f.raw === null);
}

export function newChatSession(id: string): ChatSession {
  const booking: Booking = {
    key: id,
    bookingId: { value: `CHAT-${id.slice(0, 6).toUpperCase()}`, raw: null, source: "derived", location: null, formula: "reference generated for this chat" },
    sellerName: blank(),
    originCity: blank(),
    // Fixed facts, never asked (spec §12.2).
    originCountry: { value: "United Kingdom", raw: null, source: "derived", location: null, formula: "PreFlight only books from the UK" },
    destinationCity: blank(),
    destinationCountry: blank(),
    destinationType: blank(),
    readyDate: blank(),
    priority: blank(),
    pallets: blank(),
    cartons: blank(),
    declaredValue: blank(),
    currency: { value: "GBP", raw: null, source: "derived", location: null, formula: "PreFlight works in GBP only" },
    grossWeightKg: blank(),
    appointmentBooked: blank(),
    items: [],
    integrity: {},
  };
  return {
    id,
    booking,
    state: emptyState(),
    messages: [],
    flags: {
      skuAsked: [],
      declined: [],
      grossUnknown: false,
      palletWeightUnknown: false,
      palletWeightKg: null,
      cartonWeights: {},
      readbackShown: false,
      readbackConfirmed: false,
      dateConfirmed: false,
      pendingHs: null,
      itemCounter: 0,
      generatedSkus: 0,
      pendingIssue: null,
      issuesAsked: [],
    },
    lastQuestion: null,
    aiUnavailable: false,
  };
}

export const WELCOME =
  "Hi! Tell me about your shipment — where it's going, what's in it, and how it's packed. You can type or use the microphone. I'll only ask for what's missing.";

/** Form fallback: add an empty product the seller fills in field by field. */
export function addBlankItem(s: ChatSession): ChatSession {
  const next = structuredClone(s);
  next.flags.itemCounter += 1;
  next.booking.items.push({
    itemId: `c${next.flags.itemCounter}`,
    sku: blank(),
    description: blank(),
    hsCode: blank(),
    hsWasNumeric: false,
    quantity: blank(),
    unitPrice: blank(),
    unitsPerCarton: blank(),
    cartons: blank(),
    unitWeightKg: blank(),
    countryOfOrigin: blank(),
  });
  next.flags.readbackShown = false;
  next.flags.readbackConfirmed = false;
  return next;
}
