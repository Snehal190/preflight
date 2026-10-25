"use client";

import { useEffect, useRef, useState } from "react";

const MAX_SECONDS = 60;

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of options) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

/**
 * Records up to 60 s with MediaRecorder, sends it for transcription, and hands back the text.
 * The caller puts it in an editable box — a transcript is never sent automatically (spec §12.1).
 */
export function VoiceRecorder({ onTranscript, disabled }: { onTranscript: (text: string) => void; disabled: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setState("transcribing");
        try {
          const type = (r.mimeType || "audio/webm").split(";")[0];
          const form = new FormData();
          form.append("audio", new File(chunks, `voice.${type.split("/")[1]}`, { type }));
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({ error: "Transcription failed." }))) as { transcript?: string; error?: string };
          if (!res.ok || !data.transcript) throw new Error(data.error ?? "I couldn't hear anything — try again or type instead.");
          onTranscript(data.transcript);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Transcription failed.");
        } finally {
          setState("idle");
        }
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) r.state === "recording" && r.stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access was blocked. Allow it in the browser's address bar, or type instead.");
    }
  }

  if (!supported) return <span className="text-xs text-ink/60">Voice isn't supported in this browser — please type.</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "recording" ? (
        <button type="button" className="btn btn-dark" onClick={() => rec.current?.stop()}>
          ■ Stop ({MAX_SECONDS - seconds}s left)
        </button>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={start} disabled={disabled || state === "transcribing"} aria-label="Record a voice message">
          {state === "transcribing" ? "Transcribing…" : "🎙 Speak"}
        </button>
      )}
      {error && <span role="alert" className="text-xs text-bad">{error}</span>}
    </div>
  );
}
