"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { newChatSession, addBlankItem, WELCOME, type ChatSession } from "@/lib/chat/session";
import { tellUsChecklist, EXAMPLE_SENTENCE } from "@/lib/chat/checklist";
import type { BookingState, Evaluation } from "@/lib/booking/state";
import { editBookingField, editItemField } from "@/lib/booking/edit";
import { changeChips } from "@/lib/booking/changes";
import { RULEBOOK, RULE_IDS } from "@/lib/reference/rulebook";
import { postJson } from "@/lib/client/store";
import { chatBatchId, loadChat, saveChat, type StoredChat } from "@/lib/client/chatStore";
import { StatusBadge } from "@/app/components/StatusBadge";
import { Chips } from "@/app/components/Chips";
import { FieldsPanel } from "@/app/components/FieldsPanel";
import { CarrierSummary, DatesLine } from "@/app/components/CarrierBits";
import { stateLabel } from "@/app/components/IssueCard";
import { VoiceRecorder, type VoiceState } from "@/app/components/VoiceRecorder";

/** Approved: after the seller stops speaking, send after this many seconds unless they tap to edit. */
const AUTO_SEND_SECONDS = 4;

/** Bot text: newlines and **bold** only (built by code templates, so no other markup). */
function Rich({ text }: { text: string }) {
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

function speak(text: string) {
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/\*\*/g, "").replace(/•/g, "")));
  } catch {
    /* speech not available */
  }
}

const TICK: Record<string, { icon: string; cls: string; sr: string }> = {
  done: { icon: "✓", cls: "bg-good text-white", sr: "done" },
  unknown: { icon: "?", cls: "bg-accent text-ink", sr: "you said you don't know" },
  todo: { icon: "", cls: "border border-ink/25", sr: "still needed" },
};

export default function View() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [chat, setChat] = useState<StoredChat | null>(null);
  const [text, setText] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [tab, setTab] = useState<"guide" | "booking">("guide");
  const bottom = useRef<HTMLDivElement>(null);
  const textRef = useRef("");
  const chatRef = useRef<StoredChat | null>(null);
  textRef.current = text;
  chatRef.current = chat;

  useEffect(() => {
    const stored = loadChat(id);
    if (stored) {
      setChat(stored);
      return;
    }
    const session = newChatSession(id);
    session.messages.push({ id: "m0", role: "assistant", text: WELCOME, transcript: false, at: new Date().toISOString() });
    const fresh: StoredChat = { session, evaluation: null, lastChips: [] };
    setChat(fresh);
    postJson<{ state: BookingState; evaluation: Evaluation }>("/api/evaluate", { booking: session.booking, state: session.state })
      .then((r) => {
        const next = { session: { ...session, state: r.state }, evaluation: r.evaluation, lastChips: [] };
        saveChat(next, "Started chat");
        setChat(next);
      })
      .catch(() => saveChat(fresh, "Started chat"));
  }, [id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat?.session.messages.length]);

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

  if (!chat) return null;
  const { session, evaluation: e } = chat;

  function commit(next: StoredChat, cause: string) {
    if (!saveChat(next, cause)) setError("Couldn't save in this browser (storage full or blocked).");
    setChat(next);
  }

  function chipsFor(prev: StoredChat, nextSession: ChatSession, nextEval: Evaluation): string[] {
    return prev.evaluation ? changeChips(prev.session.booking, prev.evaluation, nextSession.booking, nextEval) : [];
  }

  async function send(ev?: React.FormEvent) {
    ev?.preventDefault();
    setCountdown(null);
    const current = chatRef.current;
    const message = textRef.current.trim();
    if (!message || busy || !current) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ session: ChatSession; evaluation: Evaluation }>("/api/chat", { session: current.session, text: message, transcript: fromVoice });
      commit({ session: r.session, evaluation: r.evaluation, lastChips: chipsFor(current, r.session, r.evaluation) }, `Chat: "${message.slice(0, 60)}"`);
      setText("");
      setFromVoice(false);
      setVoiceNote(null);
      if (readAloud) speak(r.session.messages[r.session.messages.length - 1].text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function formChange(nextSession: ChatSession, cause: string) {
    const current = chatRef.current;
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      nextSession.flags.readbackShown = false;
      nextSession.flags.readbackConfirmed = false;
      const r = await postJson<{ state: BookingState; evaluation: Evaluation }>("/api/evaluate", { booking: nextSession.booking, state: nextSession.state });
      const s2 = { ...nextSession, state: r.state };
      commit({ session: s2, evaluation: r.evaluation, lastChips: chipsFor(current, s2, r.evaluation) }, cause);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const checklist = tellUsChecklist(session.booking, session.flags);
  const total = checklist.flatMap((g) => g.items).filter((i) => !i.optional);
  const doneCount = total.filter((i) => i.state !== "todo").length;
  const checkHref = `/batch/${chatBatchId(id)}/${encodeURIComponent(session.booking.key)}`;
  const ruleRows = e
    ? RULE_IDS.map((rid) => {
        const rs = e.results.filter((r) => r.ruleId === rid && !r.nonBlocking);
        const order = ["missing_data", "fail", "needs_answer", "pass", "not_applicable"];
        const worst = [...rs].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
        return { rid, worst };
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="eyebrow">New booking · voice or text</p>
          <h1 className="text-[34px]">Speak or type your shipment</h1>
          <p className="text-ink/70">Tell us about your shipment. The “What to tell us” checklist (beside the chat, or below it on a phone) shows what to mention.</p>
        </div>
        <button type="button" className="btn btn-ghost text-sm" onClick={() => router.push("/chat")}>
          + Start a new booking
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="card flex flex-col h-[calc(100dvh-12rem)] min-h-[32rem] overflow-hidden">
          {session.aiUnavailable && (
            <p role="alert" className="m-4 rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
              The assistant is unavailable right now — you can fill in the booking form instead (right-hand panel, “Your booking”). Nothing is lost.
            </p>
          )}

          <ol className="flex-1 space-y-4 p-4 sm:p-6 overflow-y-auto grid-bg" aria-live="polite">
            {session.messages.map((m) => (
              <li key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${m.role === "assistant" ? "bg-paper border border-ink/10 rounded-tl-sm" : "bg-ink text-white rounded-tr-sm"}`}>
                  <p className={`text-[0.7rem] font-bold uppercase tracking-wider mb-1 ${m.role === "assistant" ? "text-accent" : "text-white/70"}`}>
                    {m.role === "assistant" ? "PreFlight" : m.transcript ? "You · spoken" : "You"}
                  </p>
                  <Rich text={m.text} />
                </div>
              </li>
            ))}
            {busy && (
              <li className="flex justify-start">
                <div className="rounded-2xl bg-paper border border-ink/10 px-4 py-3 text-sm text-ink/60">Checking what you said…</div>
              </li>
            )}
            <div ref={bottom} />
          </ol>

          <form onSubmit={send} className="border-t border-ink/10 bg-paper p-4 space-y-3">
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
            <label className="sr-only" htmlFor="msg">Your message</label>
            <textarea
              id="msg"
              className={`w-full rounded-xl border p-3 text-sm ${voice === "recording" ? "border-bad/60 bg-bad/5" : "border-ink/25"}`}
              rows={3}
              maxLength={2000}
              placeholder="Speak, or type here — e.g. 1,080 ceramic mugs from Manchester to Frankfurt on 3 pallets…"
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
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-accent-soft border border-accent/30 px-3 py-2 text-sm" role="status">
                <span className="font-semibold">Sending in {countdown}… check the words above.</span>
                <button type="button" className="btn btn-ghost text-xs py-1" onClick={() => setCountdown(null)}>
                  Tap to edit
                </button>
                <button type="submit" className="btn text-xs py-1">Send now</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className="btn" disabled={busy || !text.trim() || voice !== "idle"}>
                  {busy ? "Checking…" : "Send"}
                </button>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={readAloud} onChange={(ev) => setReadAloud(ev.target.checked)} /> Read replies aloud
                </label>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-bad font-semibold">{error}</p>}
          </form>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-20 self-start lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          <div className="flex rounded-full border border-ink/15 p-1 text-sm font-semibold" role="tablist">
            {(["guide", "booking"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${tab === t ? "bg-ink text-white" : "hover:bg-ink/5"}`}
              >
                {t === "guide" ? `What to tell us · ${doneCount}/${total.length}` : "Your booking"}
              </button>
            ))}
          </div>

          {tab === "guide" ? (
            <div className="card p-5 space-y-4">
              <div className="h-2 rounded-full bg-ink/10 overflow-hidden" aria-hidden>
                <div className="h-full bg-accent transition-all duration-300" style={{ width: `${(doneCount / total.length) * 100}%` }} />
              </div>
              {checklist.map((g) => (
                <div key={g.title} className="space-y-1.5">
                  <h3 className="eyebrow">{g.title}</h3>
                  <ul className="space-y-1.5">
                    {g.items.map((it) => {
                      const t = TICK[it.state];
                      return (
                        <li key={it.label} className="flex gap-2 text-sm">
                          <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold ${t.cls}`} aria-label={t.sr}>
                            {t.icon}
                          </span>
                          <span className={it.state === "done" ? "text-ink/50 line-through decoration-ink/30" : ""}>
                            <span className="font-semibold">{it.label}</span>
                            {it.optional && <span className="text-ink/50"> (optional)</span>}
                            <span className="block text-xs text-ink/60 no-underline">{it.example}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              <div className="rounded-xl bg-mist p-3 text-xs text-ink/75">
                <p className="font-bold uppercase tracking-wider text-[0.65rem] mb-1">You could say</p>
                {EXAMPLE_SENTENCE}
              </div>
              <p className="text-xs text-ink/60">Don&apos;t know something? Just say so — we&apos;ll help or flag it.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="card p-5 space-y-3">
                {e ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={e.status} />
                      <span className="text-sm font-semibold">{e.headline}</span>
                    </div>
                    <Chips chips={chat.lastChips} />
                    <ul className="space-y-1 text-sm">
                      {ruleRows.map(({ rid, worst }) => (
                        <li key={rid} className="flex items-center justify-between gap-2">
                          <span>{RULEBOOK[rid].plainName}</span>
                          {worst ? <span className={`badge ${stateLabel(worst).cls}`}>{stateLabel(worst).text}</span> : <span className="text-ink/40">—</span>}
                        </li>
                      ))}
                    </ul>
                    <CarrierSummary c={e.carrier} provisional={e.status !== "ready"} />
                    <DatesLine dates={e.dates} />
                    <Link href={checkHref} className="btn btn-dark text-sm w-full">Open the full check →</Link>
                  </>
                ) : (
                  <p className="text-sm">Loading…</p>
                )}
              </div>
              <details className="card p-5" open={session.aiUnavailable}>
                <summary className="cursor-pointer font-semibold">Booking form (every field, with its source)</summary>
                <div className="mt-3 space-y-3">
                  <FieldsPanel
                    booking={session.booking}
                    busy={busy}
                    onEditBooking={(field, t, label) => formChange({ ...structuredClone(session), booking: editBookingField(session.booking, field, t) }, `Edited ${label}`)}
                    onEditItem={(itemId, field, t, label) => formChange({ ...structuredClone(session), booking: editItemField(session.booking, itemId, field, t) }, `Edited ${label}`)}
                  />
                  <button type="button" className="btn btn-ghost text-sm" disabled={busy} onClick={() => formChange(addBlankItem(session), "Added a product")}>
                    + Add a product
                  </button>
                </div>
              </details>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
