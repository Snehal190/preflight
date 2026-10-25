"use client";

import type { ChatSession } from "../chat/session";
import type { Evaluation } from "../booking/state";
import { loadBatch, saveBatch, type StoredBatch } from "./store";

// Chat sessions in the browser until the database step. Each chat is mirrored into a one-booking
// "batch" so the same Check / Carrier / Take-off pages serve both paths.

const PREFIX = "preflight:chat:";

export interface StoredChat {
  session: ChatSession;
  evaluation: Evaluation | null;
  lastChips: string[];
}

export function loadChat(id: string): StoredChat | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as StoredChat) : null;
  } catch {
    return null;
  }
}

export function chatBatchId(id: string): string {
  return `chat-${id}`;
}

export function saveChat(c: StoredChat, cause: string): boolean {
  try {
    localStorage.setItem(PREFIX + c.session.id, JSON.stringify(c));
  } catch {
    return false;
  }
  if (!c.evaluation) return true;
  const id = chatBatchId(c.session.id);
  const prev = loadBatch(id);
  const b = c.session.booking;
  const versions = prev?.bookings[0]?.versions ?? [];
  const batch: StoredBatch = {
    id,
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    files: [],
    warnings: [],
    bookings: [
      {
        key: b.key,
        label: b.bookingId.value ?? "Chat booking",
        booking: b,
        state: c.session.state,
        evaluation: c.evaluation,
        versions: [...versions, { n: versions.length + 1, at: new Date().toISOString(), booking: b, state: c.session.state, chips: c.lastChips, cause }],
      },
    ],
  };
  return saveBatch(batch);
}
