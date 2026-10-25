import { z } from "zod";
import { aiConfigured, extractFromMessage, suggestHsCode } from "@/lib/ai";
import { ChatSessionSchema } from "@/lib/chat/session";
import { handleTurn } from "@/lib/chat/engine";
import { LIST_FOR_PROMPT } from "@/lib/chat/normalize";
import { londonToday } from "@/lib/dates/today";
import { evaluate, refreshAiAdvice } from "@/lib/booking/server";
import type { Booking } from "@/lib/types";
import { newBlockingIssues } from "@/lib/chat/announce";

export const maxDuration = 60;

const Body = z.object({ session: ChatSessionSchema, text: z.string().trim().min(1).max(2000), transcript: z.boolean() });

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

export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) return Response.json({ error: "Invalid request." }, { status: 400 });
    const { session, text, transcript } = body.data;
    const today = londonToday();
    const extraction = aiConfigured()
      ? await extractFromMessage(text, { bookingSoFar: soFar(session.booking), allowedValues: LIST_FOR_PROMPT, today, lastQuestion: session.lastQuestion })
      : ({ ok: false, reason: "unavailable" } as const);
    const before = await evaluate(session.booking, session.state);
    const turn = await handleTurn(session, text, transcript, extraction, { today, suggestHs: (d) => suggestHsCode(d) });
    const next = turn.session;
    [next.state] = await refreshAiAdvice([next.booking], [next.state]);
    const evaluation = await evaluate(next.booking, next.state);
    // Say so in the reply when this turn created a Red or a question (spec: everything re-runs).
    const raised = newBlockingIssues(before, evaluation);
    if (raised.length) {
      const last = next.messages[next.messages.length - 1];
      last.text += `\n\n**Heads-up — new issue${raised.length > 1 ? "s" : ""}:**\n${raised.map((r) => `• ${r}`).join("\n")}`;
    }
    if (turn.justConfirmed) {
      const last = next.messages[next.messages.length - 1];
      last.text += ` Your checks: ${evaluation.headline}. Open the check page to fix anything, then continue to the carrier.`;
    }
    return Response.json({ session: next, evaluation });
  } catch (e) {
    console.error("chat failed", e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
