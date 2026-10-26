"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { VoiceRecorder, type VoiceState } from "@/app/components/VoiceRecorder";

/** Approved: after the seller stops speaking, send after this many seconds unless they tap to edit. */
const AUTO_SEND_SECONDS = 4;

/** Bot text: newlines and **bold** only (built by code templates, so no other markup). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <Fragment key={j}>{part}</Fragment>))}
        </Fragment>
      ))}
    </>
  );
}

export interface ChangeMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * "Anything to change?" after an upload: the seller types or speaks a change, we apply it with the
 * same rules as the chat and say what changed and what the checks now find.
 */
export function ChangeBox({
  title,
  hint,
  placeholder,
  messages,
  busy,
  onSend,
}: {
  title: string;
  hint: string;
  placeholder: string;
  messages: ChangeMessage[];
  busy: boolean;
  onSend: (text: string, transcript: boolean) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setCountdown(null);
    setText("");
    setVoiceNote(null);
    const transcript = fromVoice;
    setFromVoice(false);
    await onSend(t, transcript);
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  // Auto-send countdown after speaking (cancelled by any edit or tap on the box).
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      void send();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line p-5 sm:p-6">
        <p className="eyebrow">Anything to change?</p>
        <h2 className="mt-1 text-[24px] sm:text-[28px]">{title}</h2>
        <p className="mt-1 text-ink-2">{hint}</p>
      </div>
      {messages.length > 0 && (
        <ol className="max-h-[420px] space-y-3 overflow-y-auto bg-mist p-5" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "bg-ink text-paper" : "border border-line bg-paper"}`}>
                <Rich text={m.text} />
              </div>
            </li>
          ))}
          {busy && (
            <li className="flex">
              <div className="rounded-2xl border border-line bg-paper px-4 py-3 text-sm text-ink-3">Making the change and re-checking…</div>
            </li>
          )}
          <div ref={bottom} />
        </ol>
      )}
      <form
        className="space-y-3 p-5"
        onSubmit={(ev) => {
          ev.preventDefault();
          void send();
        }}
      >
        <VoiceRecorder
          disabled={busy}
          onState={setVoice}
          onLive={(t) => {
            setCountdown(null);
            setText(t);
            setFromVoice(true);
          }}
          onFinal={(t, note) => {
            setText(t);
            setFromVoice(true);
            setVoiceNote(note);
            setCountdown(AUTO_SEND_SECONDS);
          }}
        />
        <label className="sr-only" htmlFor="change-msg">Your change</label>
        <textarea
          id="change-msg"
          className={`w-full rounded-xl border p-3 text-sm ${voice === "recording" ? "border-bad/60 bg-bad/5" : "border-ink/25"}`}
          rows={2}
          maxLength={2000}
          placeholder={placeholder}
          value={text}
          readOnly={voice === "recording"}
          onFocus={() => setCountdown(null)}
          onChange={(ev) => {
            setCountdown(null);
            setText(ev.target.value);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey) {
              ev.preventDefault();
              void send();
            }
          }}
        />
        {voiceNote && <p className="text-xs font-semibold text-warn">{voiceNote}</p>}
        {countdown !== null ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">
            <span className="font-semibold">Sending in {countdown}… check the words above.</span>
            <button type="button" className="btn btn-ghost py-1 text-xs" onClick={() => setCountdown(null)}>
              Tap to edit
            </button>
            <button type="submit" className="btn py-1 text-xs">Send now</button>
          </div>
        ) : (
          <button type="submit" className="btn" disabled={busy || !text.trim() || voice !== "idle"}>
            {busy ? "Re-checking…" : "Make the change"}
          </button>
        )}
      </form>
    </div>
  );
}
