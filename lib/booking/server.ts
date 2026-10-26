import type { Booking } from "../types";
import { aiConfigured, classifyItems } from "../ai";
import { cachedFetcher } from "../dates/cache";
import { londonToday } from "../dates/today";
import { evaluateBooking } from "./evaluate";
import { dropStaleAdvice, type BookingState, type Evaluation } from "./state";

// Server-side glue for API routes: AI advice, holidays and "today" (Europe/London).

const holidays = cachedFetcher();

/** Ask the AI about any item it hasn't seen yet (cached by description). Never throws. */
export async function refreshAiAdvice(bookings: Booking[], statesIn: BookingState[]): Promise<BookingState[]> {
  const states = statesIn.map((s, i) => dropStaleAdvice(bookings[i], s));
  if (!aiConfigured()) return states.map((s) => ({ ...s, ai: { available: false, byItemId: s.ai?.byItemId ?? {} } }));
  const items = bookings.flatMap((b, i) =>
    b.items
      .filter((it) => it.description.value && !states[i].ai?.byItemId[it.itemId])
      .map((it) => ({ id: `${i}|${it.itemId}`, description: it.description.value!, hsCode: it.hsCode.value })),
  );
  if (items.length === 0) return states;
  const res = await classifyItems(items);
  return states.map((s, i) => {
    const byItemId = { ...(s.ai?.byItemId ?? {}) };
    for (const [k, v] of Object.entries(res.byId)) {
      const [bi, itemId] = [Number(k.slice(0, k.indexOf("|"))), k.slice(k.indexOf("|") + 1)];
      const it = bookings[i].items.find((x) => x.itemId === itemId);
      if (bi === i) byItemId[itemId] = { ...v, about: { description: it?.description.value ?? null, hsCode: it?.hsCode.value ?? null } };
    }
    const missing = bookings[i].items.some((it) => it.description.value && !byItemId[it.itemId]);
    return { ...s, ai: { available: res.available && !missing, byItemId } };
  });
}

export function evaluate(b: Booking, state: BookingState): Promise<Evaluation> {
  return evaluateBooking(b, state, londonToday(), holidays);
}
