"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { loadBatch, postJson, saveChange, type StoredBatch, type StoredBooking } from "@/lib/client/store";
import { compareWorstFirst } from "@/lib/booking/sort";
import { fmtGBP } from "@/lib/format";
import type { CheckResult } from "@/lib/rules/types";
import type { ChatSession } from "@/lib/chat/session";
import { StatusBadge } from "@/app/components/StatusBadge";
import { stateLabel } from "@/app/components/IssueCard";
import { ChangeBox, type ChangeMessage } from "@/app/components/ChangeBox";

/** Most serious first: must fix, missing info, questions, please check, advice. */
const ORDER = (r: CheckResult) => (r.status === "fail" && r.severity === "red" && !r.nonBlocking ? 0 : r.status === "missing_data" ? 1 : r.status === "needs_answer" ? 2 : r.status === "fail" && r.severity === "amber" ? 3 : 4);
const SHOWN = 3;

/** "BK-301" said as "bk 301" or "BK301" still finds BK-301. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function bookingsNamed(text: string, bookings: StoredBooking[]): StoredBooking[] {
  const words = text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const joined = words.map(squash);
  // Also try pairs ("bk 301").
  for (let i = 0; i < words.length - 1; i++) joined.push(squash(words[i] + words[i + 1]));
  return bookings.filter((b) => {
    const id = b.booking.bookingId.value;
    return id ? joined.includes(squash(id)) : false;
  });
}

function Problems({ b, href }: { b: StoredBooking; href: string }) {
  const issues = b.evaluation.results.filter((r) => r.status !== "pass" && r.status !== "not_applicable").sort((x, y) => ORDER(x) - ORDER(y));
  if (!issues.length) return <p className="text-sm font-semibold text-good">✓ Everything checks out. Open it to choose your carrier.</p>;
  return (
    <ul className="space-y-2.5">
      {issues.slice(0, SHOWN).map((r) => {
        const l = stateLabel(r);
        return (
          <li key={r.id} className="text-sm">
            <span className={`badge mr-2 ${l.cls}`}>{l.text}</span>
            <strong>{r.title}.</strong> <span className="text-ink-2">{r.found}</span>
            {r.fix.text && (
              <span className="mt-0.5 block">
                <b>Fix:</b> {r.question && r.status === "needs_answer" ? `${r.question.prompt} ${r.fix.text}` : r.fix.text}
              </span>
            )}
          </li>
        );
      })}
      {issues.length > SHOWN && (
        <li className="text-sm">
          <Link className="font-semibold underline" href={href}>
            and {issues.length - SHOWN} more, see the full check →
          </Link>
        </li>
      )}
    </ul>
  );
}

export default function View() {
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<StoredBatch | null | undefined>(undefined);
  const [messages, setMessages] = useState<ChangeMessage[]>([]);
  const [sessions, setSessions] = useState<Record<string, ChatSession>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBatch(loadBatch(batchId));
  }, [batchId]);

  if (batch === undefined) return null;
  if (batch === null) return <p>We couldn&apos;t find these results in this browser. <Link className="underline" href="/upload">Upload again</Link>.</p>;

  const rows = [...batch.bookings].sort((a, b) => compareWorstFirst({ id: a.label, evaluation: a.evaluation }, { id: b.label, evaluation: b.evaluation }));
  const count = (s: string) => batch.bookings.filter((b) => b.evaluation.status === s).length;
  const href = (key: string) => `/batch/${batchId}/${encodeURIComponent(key)}`;
  const say = (text: string) => setMessages((m) => [...m, { role: "assistant", text }]);

  async function sendChange(text: string, transcript: boolean) {
    if (!batch) return;
    setMessages((m) => [...m, { role: "user", text }]);
    const named = batch.bookings.length === 1 ? batch.bookings : bookingsNamed(text, batch.bookings);
    if (named.length === 0) return say(`Which booking is that for? Please say its ID, for example **${rows[0]?.label ?? "BK-001"}**.`);
    if (named.length > 1) return say(`That mentions ${named.map((b) => b.label).join(" and ")}. Please change one booking at a time.`);
    const entry = named[0];
    setBusy(true);
    try {
      const res = await postJson<{ session: ChatSession; reply: string }>("/api/booking-chat", { booking: entry.booking, state: entry.state, session: sessions[entry.key] ?? null, text, transcript });
      setSessions((s) => ({ ...s, [entry.key]: res.session }));
      const changed = JSON.stringify(res.session.booking) !== JSON.stringify(entry.booking) || JSON.stringify(res.session.state) !== JSON.stringify(entry.state);
      let tail = "";
      if (changed) {
        const saved = await saveChange(batchId, entry, res.session.booking, res.session.state, `${transcript ? "Said" : "Typed"}: "${text.length > 60 ? `${text.slice(0, 57)}…` : text}"`);
        setBatch(saved.batch);
        if (saved.chips.length) tail = `\n\n**What changed for ${entry.label}:**\n${saved.chips.map((c) => `• ${c}`).join("\n")}`;
      }
      say(`**${entry.label}:** ${res.reply}${tail}`);
    } catch (err) {
      say(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10 pb-16">
      <div className="space-y-3 pt-4">
        <p className="eyebrow">Upload results</p>
        <h1 className="text-[34px] sm:text-[44px]">Your bookings</h1>
        <p className="text-ink-2">
          {batch.files.join(", ")} · {batch.bookings.length} booking{batch.bookings.length === 1 ? "" : "s"}
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border border-line bg-paper px-3 py-1.5"><b>{count("ready")}</b> ready for take-off</span>
          <span className="rounded-full border border-line bg-paper px-3 py-1.5"><b>{count("check")}</b> to check</span>
          <span className="rounded-full border border-line bg-paper px-3 py-1.5"><b>{count("blocked")}</b> blocked until fixed</span>
        </div>
      </div>

      {batch.warnings.length > 0 && (
        <div role="status" className="card space-y-1 border-warn/40 p-5">
          <p className="font-semibold">About this file</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {batch.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      <ChangeBox
        title="Tell us what's different"
        hint={
          batch.bookings.length === 1
            ? "Speak or type any change. We change only what you say and re-check everything."
            : "Speak or type a change and say which booking it's for. We change only what you say and re-check everything."
        }
        placeholder={batch.bookings.length === 1 ? "e.g. The quantity is 200, not 240." : `e.g. ${rows[0]?.label ?? "BK-301"}: the quantity is 200, not 240.`}
        messages={messages}
        busy={busy}
        onSend={sendChange}
      />

      <ol className="space-y-4">
        {rows.map((b) => {
          const { key, label, booking: bk, evaluation: e } = b;
          const row = bk.bookingId.location?.kind === "cell" ? bk.bookingId.location.row : null;
          const chosen = e.carrier.rows.find((r) => r.id === e.carrier.chosen);
          return (
            <li key={key} className="card grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <Link className="text-lg font-bold underline" href={href(key)}>
                  {label}
                </Link>
                {row && !label.includes("(row") && <span className="text-sm text-ink-3"> · row {row}</span>}
                <p className="text-sm text-ink-2">
                  {bk.sellerName.value ?? "-"} · {bk.originCity.value ?? "?"} → {bk.destinationCity.value ?? "?"}
                  {bk.destinationCountry.value ? `, ${bk.destinationCountry.value}` : ""}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={e.status} />
                  <span className="text-xs text-ink-3">{e.headline}</span>
                </div>
                <p className="text-xs text-ink-3">
                  {chosen ? `${e.status === "ready" ? "Carrier" : "Once fixed"}: ${chosen.name}${chosen.totalCost ? ` · ${fmtGBP(chosen.totalCost)}` : ""}` : e.carrier.noneEligible ? "No carrier can take it as packed" : ""}
                </p>
              </div>
              <div className="space-y-3">
                <Problems b={b} href={href(key)} />
                <Link href={href(key)} className="btn btn-ghost text-sm">
                  Open the full check →
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
