"use client";

import type { Booking } from "../types";
import type { BookingState, Evaluation } from "../booking/state";
import type { ParseWarning } from "../parse";
import { changeChips } from "../booking/changes";
import { historyEntry } from "../history";

// Browser-side store for local testing, until the Neon database (step 9) holds bookings and
// version history. Every read/write is guarded: storage can be unavailable or full.

export interface Version {
  n: number;
  at: string;
  booking: Booking;
  state: BookingState;
  /** Change chips from the previous version. */
  chips: string[];
  /** What caused it: "Upload", "Applied fix", "Edited pallets", "Acknowledged R-08 (Sam)", … */
  cause: string;
}

export interface StoredBooking {
  key: string;
  label: string;
  booking: Booking;
  state: BookingState;
  evaluation: Evaluation;
  versions: Version[];
}

export interface StoredBatch {
  id: string;
  createdAt: string;
  files: string[];
  warnings: ParseWarning[];
  bookings: StoredBooking[];
}

const PREFIX = "preflight:batch:";

export function saveBatch(b: StoredBatch): boolean {
  try {
    localStorage.setItem(PREFIX + b.id, JSON.stringify(b));
    return true;
  } catch {
    return false;
  }
}

export function loadBatch(id: string): StoredBatch | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as StoredBatch) : null;
  } catch {
    return null;
  }
}

export function updateBooking(batchId: string, key: string, fn: (b: StoredBooking) => StoredBooking): StoredBatch | null {
  const batch = loadBatch(batchId);
  if (!batch) return null;
  const next = { ...batch, bookings: batch.bookings.map((b) => (b.key === key ? fn(b) : b)) };
  return saveBatch(next) ? next : null;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({ error: "The server had a problem. Please try again." }))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

/**
 * Adds the batch's bookings to the shared history (all of them, or just `keys`). Never blocks or
 * breaks the page: history is a record, not part of the check.
 */
export function recordHistory(batch: StoredBatch, lastChange: string, keys?: string[]): void {
  const at = new Date().toISOString();
  const source = batch.id.startsWith("chat-") ? "chat" : "upload";
  const entries = batch.bookings
    .filter((b) => !keys || keys.includes(b.key))
    .map((b) => historyEntry({ batchId: batch.id, source, files: batch.files, booking: b.booking, evaluation: b.evaluation, at, lastChange }));
  if (!entries.length) return;
  void postJson("/api/history", { entries }).catch(() => undefined);
}

/**
 * Re-runs every check on the server for a changed booking, then saves it as a new version with
 * change chips (spec §12.8). Used by the booking page and the upload results page.
 */
export async function saveChange(
  batchId: string,
  entry: StoredBooking,
  booking: Booking,
  state: BookingState,
  cause: string,
): Promise<{ batch: StoredBatch; chips: string[]; evaluation: Evaluation }> {
  const res = await postJson<{ state: BookingState; evaluation: Evaluation }>("/api/evaluate", { booking, state });
  const chips = changeChips(entry.booking, entry.evaluation, booking, res.evaluation);
  const batch = updateBooking(batchId, entry.key, (b) => ({
    ...b,
    booking,
    state: res.state,
    evaluation: res.evaluation,
    versions: [...b.versions, { n: b.versions.length + 1, at: new Date().toISOString(), booking, state: res.state, chips, cause }],
  }));
  if (!batch) throw new Error("Couldn't save in this browser (storage full or blocked).");
  recordHistory(batch, cause, [entry.key]);
  return { batch, chips, evaluation: res.evaluation };
}
