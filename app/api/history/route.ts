import { z } from "zod";
import { HistoryEntrySchema } from "@/lib/history";
import { addToHistory, persistent, readHistory } from "@/lib/history/server";

const Body = z.object({ entries: z.array(HistoryEntrySchema).min(1).max(2000) });

/** Every shipment checked on this server, newest first. */
export async function GET() {
  return Response.json({ entries: await readHistory(), persistent });
}

/** Adds or updates shipments (after an upload, a confirmed chat booking, or a change). */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) return Response.json({ error: "Invalid request." }, { status: 400 });
    await addToHistory(body.data.entries);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("history failed", e);
    return Response.json({ error: "Couldn't save the history." }, { status: 500 });
  }
}
