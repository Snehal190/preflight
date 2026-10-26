import { z } from "zod";
import { BookingSchema } from "@/lib/types";
import { BookingStateSchema } from "@/lib/booking/state";
import { aiConfigured, extractFromMessage, suggestHsCode } from "@/lib/ai";
import { ChatSessionSchema } from "@/lib/chat/session";
import { editSession, handleTurn } from "@/lib/chat/engine";
import { LIST_FOR_PROMPT } from "@/lib/chat/normalize";
import { londonToday } from "@/lib/dates/today";
import type { Booking } from "@/lib/types";
import { refreshAiAdvice } from "@/lib/booking/server";

export const maxDuration = 60;

const Body = z.object({
  booking: BookingSchema,
  state: BookingStateSchema,
  /** The conversation so far for this booking, or null to start one. */
  session: ChatSessionSchema.nullable(),
  text: z.string().trim().min(1).max(2000),
  transcript: z.boolean(),
});

/** The booking so far as plain values, for the extraction prompt. */
function soFar(b: Booking): Record<string, unknown> {
  const pick = (o: object) =>
    Object.fromEntries(
      Object.entries(o)
        .filter(([, v]) => v && typeof v === "object" && "value" in v)
        .map(([k, v]) => [k, (v as { value: unknown }).value]),
    );
  return { ...pick(b), items: b.items.map((it) => pick(it)) };
}

/**
 * Changes to an uploaded booking, spoken or typed ("make the quantity 200", "we booked the slot").
 * Same rules as the chat: the seller's values are kept as stated, and every check re-runs.
 */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) return Response.json({ error: "Invalid request." }, { status: 400 });
    const { booking, state, text, transcript } = body.data;
    const today = londonToday();
    // Always start from the booking as it is now (it may have been edited on the page since).
    const session = body.data.session ? { ...body.data.session, booking, state } : editSession(booking, state, today);
    const extraction = aiConfigured()
      ? await extractFromMessage(text, { bookingSoFar: soFar(session.booking), allowedValues: LIST_FOR_PROMPT, today, lastQuestion: session.lastQuestion })
      : ({ ok: false, reason: "unavailable" } as const);
    const deps = { today, suggestHs: (d: string) => suggestHsCode(d), edit: true };
    let turn = await handleTurn(session, text, transcript, extraction, deps);
    // A product's description or HS code changed: get fresh AI advice for it, then answer again
    // with that advice, so the reply never quotes a review of the old wording.
    const [fresh] = await refreshAiAdvice([turn.session.booking], [turn.session.state]);
    if (JSON.stringify(fresh.ai) !== JSON.stringify(turn.session.state.ai)) {
      turn = await handleTurn({ ...session, state: { ...session.state, ai: fresh.ai } }, text, transcript, extraction, deps);
    }
    const next = turn.session;
    next.messages = next.messages.slice(-40);
    return Response.json({ session: next, reply: turn.reply });
  } catch (e) {
    console.error("booking chat failed", e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
