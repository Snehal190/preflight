// How far the box is closed: one flap folds down each time enough checks are packed, and the
// box is taped shut only when all ten are packed (spec: close as the rules come in).

export const FLAP_THRESHOLDS = [3, 5, 8, 10] as const;

/** Number of flaps closed (0–4) for this many packed checks. */
export function flapsClosed(packed: number): number {
  return FLAP_THRESHOLDS.filter((t) => packed >= t).length;
}

export function isSealed(packed: number, total = 10): boolean {
  return packed >= total;
}
