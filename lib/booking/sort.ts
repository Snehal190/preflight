import type { Evaluation } from "./state";

// Results table order (approved Q22): Blocked → Check → Ready; then Red, Missing, Needs answer,
// Amber (most first); then booking ID.

const STATUS_RANK = { blocked: 0, check: 1, ready: 2 } as const;

export function compareWorstFirst(a: { id: string; evaluation: Evaluation }, b: { id: string; evaluation: Evaluation }): number {
  const ea = a.evaluation;
  const eb = b.evaluation;
  return (
    STATUS_RANK[ea.status] - STATUS_RANK[eb.status] ||
    eb.counts.red - ea.counts.red ||
    eb.counts.missing - ea.counts.missing ||
    eb.counts.needsAnswer - ea.counts.needsAnswer ||
    eb.counts.amber - ea.counts.amber ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
