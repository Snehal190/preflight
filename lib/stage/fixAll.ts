import type { Booking } from "../types";
import { runChecks, type CheckContext } from "../rules";
import { applyPatches, suggestFixes } from "../repair";

// "Fix all": apply the best tested numeric fix, re-check everything, repeat. Only fixes the repair
// engine has proven (never HS codes, dangerous goods, weights, dates, appointments or origins).

export function fixAll(b: Booking, ctx: CheckContext, maxRounds = 6): { booking: Booking; applied: string[] } {
  let current = b;
  const applied: string[] = [];
  for (let i = 0; i < maxRounds; i++) {
    const report = runChecks(current, ctx);
    const outcome = suggestFixes(current, ctx, report);
    if (outcome.blockedReason) break;
    const first = Object.values(outcome.byResult).find((fixes) => fixes.length > 0)?.[0];
    if (!first) break;
    current = applyPatches(current, first.patches);
    applied.push(first.summary);
  }
  return { booking: current, applied };
}
