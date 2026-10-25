"use client";

import { useCallback, useEffect, useState } from "react";
import type { Booking } from "../types";
import type { BookingState, Evaluation } from "../booking/state";
import type { Patch } from "../rules/types";
import type { CarrierId } from "../reference/carriers";
import { applyPatches } from "../repair";
import { editBookingField, editItemField } from "../booking/edit";
import { changeChips } from "../booking/changes";
import { loadBatch, postJson, updateBooking, type StoredBatch, type StoredBooking } from "./store";

// All of a booking's actions. Each one re-runs every check on the server, then saves a new
// version with change chips (spec §12.8). Business logic stays in lib/.

export function useBooking(batchId: string, key: string) {
  const [batch, setBatch] = useState<StoredBatch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChips, setLastChips] = useState<string[]>([]);

  useEffect(() => {
    setBatch(loadBatch(batchId));
    setLoaded(true);
  }, [batchId]);

  const entry: StoredBooking | null = batch?.bookings.find((b) => b.key === key) ?? null;

  const commit = useCallback(
    async (booking: Booking, state: BookingState, cause: string) => {
      if (!entry) return;
      setBusy(true);
      setError(null);
      try {
        const res = await postJson<{ state: BookingState; evaluation: Evaluation }>("/api/evaluate", { booking, state });
        const chips = changeChips(entry.booking, entry.evaluation, booking, res.evaluation);
        const next = updateBooking(batchId, key, (b) => ({
          ...b,
          booking,
          state: res.state,
          evaluation: res.evaluation,
          versions: [...b.versions, { n: b.versions.length + 1, at: new Date().toISOString(), booking, state: res.state, chips, cause }],
        }));
        if (!next) throw new Error("Couldn't save in this browser (storage full or blocked).");
        setBatch(next);
        setLastChips(chips);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
    },
    [batchId, key, entry],
  );

  const dropAdvice = (state: BookingState, itemId: string): BookingState => {
    if (!state.ai) return state;
    const byItemId = { ...state.ai.byItemId };
    delete byItemId[itemId];
    const hsSuggestions = { ...state.hsSuggestions };
    delete hsSuggestions[itemId];
    return { ...state, ai: { ...state.ai, byItemId }, hsSuggestions };
  };

  return {
    loaded,
    batch,
    entry,
    busy,
    error,
    lastChips,
    editBookingField: (field: string, text: string, label: string) => entry && commit(editBookingField(entry.booking, field, text), entry.state, `Edited ${label}`),
    editItemField: (itemId: string, field: string, text: string, label: string) => {
      if (!entry) return;
      const state = field === "description" || field === "hsCode" ? dropAdvice(entry.state, itemId) : entry.state;
      return commit(editItemField(entry.booking, itemId, field, text), state, `Edited ${label}`);
    },
    applyFix: (patches: Patch[], summary: string) => entry && commit(applyPatches(entry.booking, patches), entry.state, `Applied fix: ${summary}`),
    answer: (answerKey: string, value: "yes" | "no", prompt: string) =>
      entry && commit(entry.booking, { ...entry.state, answers: { ...entry.state.answers, [answerKey]: value } }, `Answered "${prompt}": ${value === "yes" ? "Yes" : "No"}`),
    acknowledge: (resultId: string, name: string) =>
      entry &&
      commit(
        entry.booking,
        { ...entry.state, acknowledged: [...entry.state.acknowledged.filter((a) => a.id !== resultId), { id: resultId, name, at: new Date().toISOString() }] },
        `Acknowledged ${resultId.split(":")[0]} (${name})`,
      ),
    unacknowledge: (resultId: string) =>
      entry && commit(entry.booking, { ...entry.state, acknowledged: entry.state.acknowledged.filter((a) => a.id !== resultId) }, `Withdrew acknowledgement of ${resultId.split(":")[0]}`),
    useHsSuggestion: (itemId: string, code: string, reason: string) =>
      entry && commit(entry.booking, { ...entry.state, hsSuggestions: { ...entry.state.hsSuggestions, [itemId]: { code, reason } } }, "Got an AI HS-code suggestion"),
    chooseCarrier: (id: CarrierId | null) =>
      entry && commit(entry.booking, { ...entry.state, chosenCarrierId: id }, id ? `Chose Carrier ${id}` : "Went back to the recommended carrier"),
    undoTo: (n: number) => {
      const v = entry?.versions.find((x) => x.n === n);
      if (v) return commit(v.booking, v.state, `Undo to version ${n}`);
    },
  };
}
