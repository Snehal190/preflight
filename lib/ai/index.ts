import { createHash } from "node:crypto";
import { z } from "zod";
import { asData, callJson, type AiResult } from "./client";
import { DG_SYSTEM, EXTRACT_SYSTEM, HS_SYSTEM, TRANSCRIBE_SYSTEM } from "./prompts";
import type { DgAiResult } from "../rules/context";

export { aiConfigured } from "./client";

// --- Cache (spec §6 R-06: same description → same answer). Neon-backed in lib/db; memory default.

export interface AiCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, kind: string, value: unknown): Promise<void>;
}

const memory = new Map<string, unknown>();
export const memoryCache: AiCache = {
  async get(k) {
    return memory.get(k);
  },
  async set(k, _kind, v) {
    memory.set(k, v);
  },
};

export function normaliseDescription(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cacheKey(kind: string, ...parts: string[]): string {
  return createHash("sha256").update([kind, ...parts].join("\u0000")).digest("hex");
}

// --- (3) Dangerous goods + HS advisory, one batched call per upload (chunked).

const DgItemSchema = z.object({
  id: z.string(),
  category: z.enum(["lithium", "aerosol", "flammable_liquid", "none", "unsure"]),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
  hsFits: z.boolean().nullable(),
  hsReason: z.string().nullable(),
});
const DgBatchSchema = z.object({ items: z.array(DgItemSchema) });

export interface ItemForAi {
  id: string;
  description: string;
  hsCode: string | null;
}

export interface ItemAiAdvice {
  dg: DgAiResult;
  hs: { fits: boolean; reason: string } | null;
}

const CHUNK = 40;

/**
 * Returns advice per item ID, or `available: false` if the AI couldn't be reached
 * (the checks then run on keywords + HS hints only, with a banner).
 */
export async function classifyItems(items: ItemForAi[], cache: AiCache = memoryCache): Promise<{ available: boolean; byId: Record<string, ItemAiAdvice> }> {
  const byId: Record<string, ItemAiAdvice> = {};
  const todo = new Map<string, { key: string; item: ItemForAi; ids: string[] }>();
  for (const it of items) {
    if (!it.description.trim()) continue;
    const key = cacheKey("dg", normaliseDescription(it.description), it.hsCode ?? "");
    const hit = (await cache.get(key)) as ItemAiAdvice | undefined;
    if (hit) {
      byId[it.id] = hit;
      continue;
    }
    const entry = todo.get(key) ?? { key, item: it, ids: [] };
    entry.ids.push(it.id);
    todo.set(key, entry);
  }
  const unique = [...todo.values()];
  let available = true;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const text = chunk
      .map((e, n) => asData("item", e.item.description, { id: String(n), ...(e.item.hsCode ? { hs: e.item.hsCode } : {}) }))
      .join("\n");
    const res = await callJson(DgBatchSchema, { system: DG_SYSTEM, parts: [{ text }] });
    if (!res.ok) {
      console.warn(`AI dangerous-goods check failed (${res.reason}); falling back to keywords for ${chunk.length} descriptions`);
      available = false;
      continue;
    }
    for (const r of res.data.items) {
      const e = chunk[Number(r.id)];
      if (!e) continue; // the model can't invent items
      const advice: ItemAiAdvice = {
        dg: { category: r.category, confidence: r.confidence, reason: noDash(r.reason) },
        hs: e.item.hsCode && r.hsFits !== null ? { fits: r.hsFits, reason: noDash(r.hsReason ?? "") } : null,
      };
      await cache.set(e.key, "dg", advice);
      for (const id of e.ids) byId[id] = advice;
    }
  }
  return { available, byId };
}

// --- (4) HS suggestion for a blank code (advice only, never applied automatically).

/** Sellers never see em dashes (product owner), including in the AI's own wording. */
export const noDash = (t: string) => t.replace(/\s*—\s*/g, ", ");

const HsSchema = z.object({ code: z.string(), reason: z.string(), confidence: z.enum(["high", "medium", "low"]) });

export async function suggestHsCode(description: string, cache: AiCache = memoryCache): Promise<{ code: string; reason: string } | null> {
  const key = cacheKey("hs", normaliseDescription(description));
  const hit = (await cache.get(key)) as { code: string; reason: string } | undefined;
  if (hit) return hit;
  const res = await callJson(HsSchema, { system: HS_SYSTEM, parts: [{ text: asData("description", description) }] });
  if (!res.ok) return null;
  const code = res.data.code.replace(/\D/g, "");
  if (code.length < 6) return null;
  const out = { code, reason: noDash(res.data.reason) };
  await cache.set(key, "hs", out);
  return out;
}

// --- (1) Voice transcription.

const TranscriptSchema = z.object({ transcript: z.string() });

export async function transcribeAudio(base64: string, mimeType: string): Promise<AiResult<string>> {
  const res = await callJson(TranscriptSchema, {
    system: TRANSCRIBE_SYSTEM,
    parts: [{ text: "Transcribe this recording." }, { inlineData: { mimeType, data: base64 } }],
  });
  return res.ok ? { ok: true, data: res.data.transcript.trim() } : res;
}

// --- (2) Chat extraction. Values come back exactly as written; code interprets them.

export const BOOKING_FIELDS = [
  "sellerName",
  "originCity",
  "destinationCity",
  "destinationCountry",
  "destinationType",
  "readyDate",
  "priority",
  "pallets",
  "cartons",
  "declaredValue",
  "currency",
  "grossWeightKg",
  "palletWeightKg",
  "appointmentBooked",
] as const;
export const ITEM_FIELDS = [
  "sku",
  "description",
  "hsCode",
  "quantity",
  "unitPrice",
  "unitsPerCarton",
  "cartons",
  "unitWeightKg",
  "cartonWeightKg",
  "countryOfOrigin",
] as const;

const OperationSchema = z.object({
  op: z.enum(["set", "increment", "decrement", "unknown", "add_item", "update_item", "remove_item"]),
  /** Booking field, or item field for item ops. */
  field: z.enum([...BOOKING_FIELDS, ...ITEM_FIELDS]).nullable(),
  /** SKU or description the seller used for the item; null for booking fields. */
  itemRef: z.string().nullable(),
  /** Exactly as written ("5k", "Frankfrut", "next Thursday"). */
  value: z.string().nullable(),
  /** Unit as written, if any ("lb", "tonnes", "kg", "€"). */
  unit: z.string().nullable(),
  quote: z.string(),
});
export type ExtractOperation = z.infer<typeof OperationSchema>;

export const ExtractionSchema = z.object({
  operations: z.array(OperationSchema),
  ambiguities: z.array(z.object({ about: z.string(), quote: z.string() })),
  newShipment: z.boolean(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractContext {
  /** The booking so far, as plain field → value text. */
  bookingSoFar: Record<string, unknown>;
  allowedValues: Record<string, readonly string[]>;
  today: string;
  /** What the assistant last asked, so short answers ("Frankfurt") can be placed. */
  lastQuestion: string | null;
}

export async function extractFromMessage(message: string, ctx: ExtractContext): Promise<AiResult<Extraction>> {
  const text = [
    `Today (Europe/London): ${ctx.today}`,
    `Allowed values: ${JSON.stringify(ctx.allowedValues)}`,
    `Booking so far: ${JSON.stringify(ctx.bookingSoFar)}`,
    `Assistant's last question: ${ctx.lastQuestion ?? "(none)"}`,
    asData("seller_message", message),
  ].join("\n");
  return callJson(ExtractionSchema, { system: EXTRACT_SYSTEM, parts: [{ text }] });
}

// --- Quote verification (spec §12.3): stops invented numbers.

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, another: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
};

/** "add a pallet" supports value 1; "two pallets" supports 2. */
function numberWordIn(quote: string, value: string): boolean {
  const n = Number(value.replace(/,/g, ""));
  return quote.toLowerCase().split(/[^a-z]+/).some((w) => NUMBER_WORDS[w] === n);
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[\s,]+/g, "");
}

function loose(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * An operation is kept only if its quote really is in the seller's message (case- and
 * whitespace-insensitive) and, for numbers, the value's digits appear in that quote.
 */
export function verifyOperation(message: string, op: ExtractOperation): { ok: true } | { ok: false; why: string } {
  if (!op.quote.trim()) return { ok: false, why: "no quote" };
  if (!loose(message).includes(loose(op.quote)) && !squash(message).includes(squash(op.quote))) {
    return { ok: false, why: "quote not in message" };
  }
  if (op.value !== null && /\d/.test(op.value)) {
    if (!squash(op.quote).includes(squash(op.value)) && !numberWordIn(op.quote, op.value)) return { ok: false, why: "value not in quote" };
  }
  return { ok: true };
}

/** Keeps verified operations; the rest are discarded so the bot asks for them instead. */
export function verifiedOperations(message: string, ex: Extraction): { kept: ExtractOperation[]; discarded: ExtractOperation[] } {
  const kept: ExtractOperation[] = [];
  const discarded: ExtractOperation[] = [];
  for (const op of ex.operations) (verifyOperation(message, op).ok ? kept : discarded).push(op);
  return { kept, discarded };
}
