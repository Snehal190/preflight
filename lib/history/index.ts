import { z } from "zod";
import type { Booking } from "../types";
import type { Evaluation } from "../booking/state";

// Shipment history: one row per booking, shared by everyone using this PreFlight server (an upload
// on any browser shows up for everyone). Rows are summaries; the full booking stays where it was made.

export const HistorySource = z.enum(["upload", "chat"]);

export const HistoryEntrySchema = z.object({
  /** `${batchId}/${bookingKey}`: one row per booking, updated as it changes. */
  id: z.string().min(1).max(300),
  batchId: z.string().min(1).max(200),
  key: z.string().min(1).max(200),
  source: HistorySource,
  /** File names for an upload. */
  files: z.array(z.string().max(200)).max(4),
  bookingId: z.string().max(100),
  seller: z.string().max(200),
  route: z.string().max(200),
  items: z.number().int().min(0).max(10_000),
  status: z.enum(["blocked", "check", "ready"]),
  headline: z.string().max(300),
  carrier: z.string().max(100),
  cost: z.string().max(40),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  /** What last changed it: "Uploaded", "Booked by voice or chat", "Typed: …", "Applied fix: …". */
  lastChange: z.string().max(200),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

/** The history row for one booking as it is now. */
export function historyEntry(
  args: { batchId: string; source: z.infer<typeof HistorySource>; files: string[]; booking: Booking; evaluation: Evaluation; at: string; lastChange: string },
): HistoryEntry {
  const { booking: b, evaluation: e } = args;
  const chosen = e.carrier.rows.find((r) => r.id === e.carrier.chosen);
  const route = `${b.originCity.value ?? "?"} → ${b.destinationCity.value ?? "?"}${b.destinationCountry.value ? `, ${b.destinationCountry.value}` : ""}`;
  return {
    id: `${args.batchId}/${b.key}`,
    batchId: args.batchId,
    key: b.key,
    source: args.source,
    files: args.files.slice(0, 4).map((f) => f.slice(0, 200)),
    bookingId: (b.bookingId.value ?? "").slice(0, 100),
    seller: (b.sellerName.value ?? "").slice(0, 200),
    route: route.slice(0, 200),
    items: b.items.length,
    status: e.status,
    headline: e.headline.slice(0, 300),
    carrier: chosen ? `${chosen.name}, ${chosen.service}`.slice(0, 100) : "",
    cost: chosen?.totalCost ?? "",
    createdAt: args.at,
    updatedAt: args.at,
    lastChange: args.lastChange.slice(0, 200),
  };
}

/** Adds new rows and updates existing ones (keeping when and how each booking first arrived). Newest first. */
export function mergeHistory(existing: HistoryEntry[], incoming: HistoryEntry[], max = 5000): HistoryEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const n of incoming) {
    const old = byId.get(n.id);
    byId.set(n.id, old ? { ...n, createdAt: old.createdAt, source: old.source, files: old.files.length ? old.files : n.files } : n);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, max);
}
