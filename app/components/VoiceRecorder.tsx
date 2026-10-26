"use client";

import { useEffect, useRef, useState } from "react";

const MAX_SECONDS = 60;
/** Stop by itself after this much silence once the seller has started talking. */
const SILENCE_MS = 2500;

// Minimal typing for the browser's speech recognition (not in TypeScript's DOM lib).
interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of options) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

export type VoiceState = "idle" | "recording" | "transcribing";

/**
 * Records up to 60 s. While recording, the browser's speech recognition (where available) shows
 * the words live via `onLive`. When recording stops, Gemini makes the final transcript (`onFinal`);
 * if that fails, the live words are used. Sending is up to the parent (countdown, never instant).
 */
export function VoiceRecorder({
  onLive,
  onFinal,
  onState,
  disabled,
}: {
  onLive: (text: string) => void;
  onFinal: (text: string, note: string | null) => void;
  onState?: (s: VoiceState) => void;
  disabled: boolean;
}) {
  const [state, setStateRaw] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const recog = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef("");
  const supported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const hasLive = !!recognitionCtor();

  const setState = (s: VoiceState) => {
    setStateRaw(s);
    onState?.(s);
  };

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (silence.current) clearTimeout(silence.current);
      recog.current?.stop();
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  function stop() {
    if (silence.current) clearTimeout(silence.current);
    recog.current?.stop();
    if (rec.current?.state === "recording") rec.current.stop();
  }

  async function start() {
    setError(null);
    live.current = "";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
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
          if (!res.ok || !data.transcript) throw new Error(data.error ?? "I couldn't hear anything.");
          onFinal(data.transcript, null);
        } catch (e) {
          if (live.current.trim()) onFinal(live.current.trim(), "We couldn't improve the transcript, so these are the live words, please check them.");
          else setError(e instanceof Error ? e.message : "Transcription failed, please try again or type.");
        } finally {
          setState("idle");
        }
      };

      // Live words (browser speech recognition), where available.
      const Ctor = recognitionCtor();
      if (Ctor) {
        const sr = new Ctor();
        sr.lang = "en-GB";
        sr.continuous = true;
        sr.interimResults = true;
        let finalText = "";
        sr.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) finalText += `${t} `;
            else interim += t;
          }
          live.current = `${finalText}${interim}`.trim();
          onLive(live.current);
          if (silence.current) clearTimeout(silence.current);
          silence.current = setTimeout(stop, SILENCE_MS);
        };
        sr.onerror = () => {};
        sr.onend = () => {};
        recog.current = sr;
        try {
          sr.start();
        } catch {
          recog.current = null;
        }
      }

      rec.current = r;
      r.start();
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access was blocked. Allow it in the browser's address bar, or type instead.");
    }
  }

  if (!supported) return <p className="text-sm text-ink/60">Voice isn&apos;t supported in this browser, please type below.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "recording" ? (
        <button type="button" className="mic mic-on" onClick={stop} aria-label="Stop recording">
          <span className="mic-dot" aria-hidden /> Stop · {MAX_SECONDS - seconds}s
        </button>
      ) : (
        <button type="button" className="mic" onClick={start} disabled={disabled || state === "transcribing"} aria-label="Start speaking">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
          </svg>
          {state === "transcribing" ? "Writing it down…" : "Tap to speak"}
        </button>
      )}
      <span className="text-xs text-ink/60">
        {state === "recording"
          ? hasLive
            ? "Listening, your words appear below. Stops by itself when you pause."
            : "Listening… tap Stop when you've finished."
          : "Up to 60 seconds. You can also type."}
      </span>
      {error && <span role="alert" className="text-xs text-bad w-full">{error}</span>}
    </div>
  );
}
