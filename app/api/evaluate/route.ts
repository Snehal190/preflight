import { z } from "zod";
import { BookingSchema } from "@/lib/types";
import { BookingStateSchema } from "@/lib/booking/state";
import { evaluate, refreshAiAdvice } from "@/lib/booking/server";


const Body = z.object({ booking: BookingSchema, state: BookingStateSchema });

/** Re-runs every check, the carrier logic and the dates after any change. */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) return Response.json({ error: "Invalid request." }, { status: 400 });
    const [state] = await refreshAiAdvice([body.data.booking], [body.data.state]);
    return Response.json({ state, evaluation: await evaluate(body.data.booking, state) });
  } catch (e) {
    console.error("evaluate failed", e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
