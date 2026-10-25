import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

// Every Gemini call goes through here (spec §13): temperature 0, structured JSON with a response
// schema, Zod validation, 20 s timeout, one retry on malformed output or timeout, then a graceful
// failure the caller must handle. The key stays server-side.

export const AI_TIMEOUT_MS = 20_000;

export type AiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface AiRequest {
  system: string;
  parts: AiPart[];
  /** JSON Schema for the response. */
  jsonSchema: unknown;
  signal: AbortSignal;
}

/** Returns the model's raw text. Injected in tests. */
export type AiTransport = (req: AiRequest) => Promise<string>;

export type AiResult<T> = { ok: true; data: T } | { ok: false; reason: "unavailable" | "timeout" | "malformed" | "error" };

export function aiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
}

let client: GoogleGenAI | null = null;

const geminiTransport: AiTransport = async ({ system, parts, jsonSchema, signal }) => {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const res = await client.models.generateContent({
    model: process.env.GEMINI_MODEL!,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: system,
      temperature: 0,
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
      abortSignal: signal,
      httpOptions: { timeout: AI_TIMEOUT_MS },
    },
  });
  return res.text ?? "";
};

let transportOverride: AiTransport | null = null;

/** Tests only: replace the network transport (null restores Gemini). */
export function setAiTransport(t: AiTransport | null): void {
  transportOverride = t;
}

/** Zod schema → JSON Schema Gemini accepts (no $schema / additionalProperties keywords). */
export function toGeminiSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === "$schema" || k === "additionalProperties") continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return strip(json);
}

async function once(transport: AiTransport, req: Omit<AiRequest, "signal">, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([transport({ ...req, signal: ctrl.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function callJson<T>(
  schema: z.ZodType<T>,
  req: { system: string; parts: AiPart[] },
  opts: { timeoutMs?: number } = {},
): Promise<AiResult<T>> {
  const transport = transportOverride ?? (aiConfigured() ? geminiTransport : null);
  if (!transport) return { ok: false, reason: "unavailable" };
  const full = { ...req, jsonSchema: toGeminiSchema(schema) };
  let last: AiResult<T> = { ok: false, reason: "error" };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await once(transport, full, opts.timeoutMs ?? AI_TIMEOUT_MS);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        last = { ok: false, reason: "malformed" };
        continue;
      }
      const v = schema.safeParse(parsed);
      if (v.success) return { ok: true, data: v.data };
      last = { ok: false, reason: "malformed" };
    } catch (e) {
      last = { ok: false, reason: e instanceof Error && e.message === "timeout" ? "timeout" : "error" };
      if (last.reason === "error") console.warn("AI call failed:", e instanceof Error ? e.message.slice(0, 300) : e);
      // Only malformed output and timeouts are retried.
      if (last.reason !== "timeout") return last;
    }
  }
  return last;
}

/** Wraps seller-provided text as data. Angle brackets are neutralised so it can't close the tag. */
export function asData(tag: string, text: string, attrs: Record<string, string> = {}): string {
  const safe = text.replace(/</g, "‹").replace(/>/g, "›");
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/["<>]/g, "")}"`)
    .join("");
  return `<${tag}${a}>${safe}</${tag}>`;
}
