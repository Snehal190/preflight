"use client";

import type { Booking } from "../types";
import type { BookingState, Evaluation } from "../booking/state";
import type { ParseWarning } from "../parse";

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
