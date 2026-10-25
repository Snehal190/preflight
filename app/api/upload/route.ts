import { nanoid } from "nanoid";
import { parseUpload, bookingLabel } from "@/lib/parse";
import { MAX_FILE_BYTES } from "@/lib/parse/cells";
import { emptyState } from "@/lib/booking/state";
import { evaluate, refreshAiAdvice } from "@/lib/booking/server";

export const maxDuration = 60;

const MAX_FILES = 4;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return Response.json({ error: "Choose the Bookings and Items sheets to upload." }, { status: 400 });
    if (files.length > MAX_FILES) return Response.json({ error: `Upload at most ${MAX_FILES} files.` }, { status: 400 });
    if (files.reduce((n, f) => n + f.size, 0) > MAX_FILE_BYTES) return Response.json({ error: "The upload is larger than 4 MB." }, { status: 400 });

    const parsed = await parseUpload(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

    const states = await refreshAiAdvice(parsed.bookings, parsed.bookings.map(emptyState));
    const bookings = await Promise.all(
      parsed.bookings.map(async (booking, i) => ({ booking, label: bookingLabel(booking), state: states[i], evaluation: await evaluate(booking, states[i]) })),
    );
    return Response.json({
      batch: { id: nanoid(), createdAt: new Date().toISOString(), files: files.map((f) => f.name), warnings: parsed.warnings, bookings },
    });
  } catch (e) {
    console.error("upload failed", e);
    return Response.json({ error: "Something went wrong reading the upload. Please try again." }, { status: 500 });
  }
}
