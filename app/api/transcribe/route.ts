import { aiConfigured, transcribeAudio } from "@/lib/ai";

// Voice: transcription only (spec §12.1). The transcript goes back to the seller to correct and send.

const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // approved Q14 (Vercel body limit 4.5 MB)
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|x-m4a|m4a)(;.*)?$/;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) return Response.json({ error: "No recording received." }, { status: 400 });
    if (audio.size === 0) return Response.json({ error: "The recording was empty." }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "The recording is too long — keep it under 60 seconds." }, { status: 400 });
    if (!AUDIO_TYPES.test(audio.type)) return Response.json({ error: "That isn't an audio recording." }, { status: 400 });
    if (!aiConfigured()) return Response.json({ error: "Voice is unavailable right now — please type instead." }, { status: 503 });
    const mime = audio.type.split(";")[0];
    const res = await transcribeAudio(Buffer.from(await audio.arrayBuffer()).toString("base64"), mime);
    if (!res.ok) return Response.json({ error: "I couldn't transcribe that — please try again or type instead." }, { status: 502 });
    return Response.json({ transcript: res.data });
  } catch (e) {
    console.error("transcribe failed", e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
