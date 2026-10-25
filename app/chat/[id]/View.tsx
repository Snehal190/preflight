"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { newChatSession, addBlankItem, WELCOME, type ChatSession } from "@/lib/chat/session";
import type { BookingState, Evaluation } from "@/lib/booking/state";
import { editBookingField, editItemField } from "@/lib/booking/edit";
import { changeChips } from "@/lib/booking/changes";
import { postJson } from "@/lib/client/store";
import { chatBatchId, loadChat, saveChat, type StoredChat } from "@/lib/client/chatStore";
import { StatusBadge } from "@/app/components/StatusBadge";
import { Chips } from "@/app/components/Chips";
import { FieldsPanel } from "@/app/components/FieldsPanel";
import { CarrierSummary, DatesLine } from "@/app/components/CarrierBits";
import { stateLabel } from "@/app/components/IssueCard";
import { VoiceRecorder } from "@/app/components/VoiceRecorder";

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

export default function View() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [chat, setChat] = useState<StoredChat | null>(null);
  const [text, setText] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Load or create the session, and evaluate it once so the live panel has statuses.
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
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.session.messages.length]);

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
    const message = text.trim();
    if (!message || busy || !chat) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ session: ChatSession; evaluation: Evaluation }>("/api/chat", { session: chat.session, text: message, transcript: fromVoice });
      const chips = chipsFor(chat, r.session, r.evaluation);
      commit({ session: r.session, evaluation: r.evaluation, lastChips: chips }, `Chat: "${message.slice(0, 60)}"`);
      setText("");
      setFromVoice(false);
      if (readAloud) speak(r.session.messages[r.session.messages.length - 1].text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  /** Form edits (and the fallback when the assistant is down) run the same checks. */
  async function formChange(nextSession: ChatSession, cause: string) {
    if (!chat) return;
    setBusy(true);
    setError(null);
    try {
      nextSession.flags.readbackShown = false;
      nextSession.flags.readbackConfirmed = false;
      const r = await postJson<{ state: BookingState; evaluation: Evaluation }>("/api/evaluate", { booking: nextSession.booking, state: nextSession.state });
      const s2 = { ...nextSession, state: r.state };
      commit({ session: s2, evaluation: r.evaluation, lastChips: chipsFor(chat, s2, r.evaluation) }, cause);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const key = encodeURIComponent(session.booking.key);
  const checkHref = `/batch/${chatBatchId(id)}/${key}`;
  const ruleRows = e ? (["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08", "R-09", "R-10"] as const).map((rid) => {
    const rs = e.results.filter((r) => r.ruleId === rid && !r.nonBlocking);
    const order = ["missing_data", "fail", "needs_answer", "pass", "not_applicable"];
    const worst = [...rs].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
    return { rid, worst };
  }) : [];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <section className="space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-4xl sm:text-5xl">Talk or type</h1>
          <button type="button" className="btn btn-ghost text-sm" onClick={() => router.push("/chat")}>Start a new booking</button>
        </div>

        {session.aiUnavailable && (
          <p role="alert" className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
            The assistant is unavailable right now — you can fill in the booking form instead. Nothing is lost.
          </p>
        )}

        <ol className="space-y-3" aria-live="polite">
          {session.messages.map((m) => (
            <li key={m.id} className={`rounded-xl p-3 text-sm max-w-[44rem] ${m.role === "assistant" ? "bg-sage/20" : "bg-accent/30 ml-auto"}`}>
              <p className="text-xs font-semibold mb-1">{m.role === "assistant" ? "PreFlight" : m.transcript ? "You (voice)" : "You"}</p>
              <Rich text={m.text} />
            </li>
          ))}
        </ol>
        <div ref={bottom} />

        <form onSubmit={send} className="space-y-2 sticky bottom-0 bg-paper py-3 border-t border-ink/10">
          {fromVoice && <p className="text-xs font-semibold">Transcript — check it and fix anything misheard, then press Send.</p>}
          <textarea
            className="w-full rounded-lg border border-ink/30 p-2 text-sm"
            rows={3}
            maxLength={2000}
            placeholder="e.g. 1,080 ceramic mugs from Manchester to Frankfurt on 3 pallets…"
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey) {
                ev.preventDefault();
                send();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn" disabled={busy || !text.trim()}>{busy ? "Thinking…" : "Send"}</button>
            <VoiceRecorder
              disabled={busy}
              onTranscript={(t) => {
                setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t));
                setFromVoice(true);
              }}
            />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={readAloud} onChange={(ev) => setReadAloud(ev.target.checked)} /> Read replies aloud
            </label>
          </div>
          {error && <p role="alert" className="text-sm text-bad font-semibold">{error}</p>}
        </form>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-4 self-start">
        <div className="rounded-xl border border-ink/15 p-4 space-y-3">
          <h2 className="text-2xl">Your booking</h2>
          {e ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={e.status} />
                <span className="text-sm font-semibold">{e.headline}</span>
              </div>
              <Chips chips={chat.lastChips} />
              <ul className="grid grid-cols-2 gap-1 text-xs">
                {ruleRows.map(({ rid, worst }) => (
                  <li key={rid} className="flex items-center gap-1">
                    <span className="font-semibold">{rid}</span>
                    {worst ? <span className={`rounded px-1 ${stateLabel(worst).cls}`}>{stateLabel(worst).text}</span> : <span>—</span>}
                  </li>
                ))}
              </ul>
              <CarrierSummary c={e.carrier} provisional={e.status !== "ready"} />
              <DatesLine dates={e.dates} />
              <Link href={checkHref} className="btn btn-dark text-sm">Open the check page →</Link>
            </>
          ) : (
            <p className="text-sm">Loading…</p>
          )}
        </div>

        <details className="rounded-xl border border-ink/15 p-4" open={session.aiUnavailable}>
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
      </aside>
    </div>
  );
}
