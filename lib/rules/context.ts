import type { CarrierId } from "../reference/carriers";
import type { DgCategory } from "../reference/dangerousGoods";

// Everything a check needs besides the booking itself. Injected so the same input always gives
// the same output (and so tests can fix "today").

export interface DgAiResult {
  category: DgCategory | "none" | "unsure";
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface CheckContext {
  /** Today in Europe/London, YYYY-MM-DD. */
  today: string;
  /** The seller's manual carrier choice, if any (spec §10.10). */
  chosenCarrierId?: CarrierId | null;
  /** R-06 layer 2. `available: false` → keywords + HS hints only, with a banner. */
  dgAi?: { available: boolean; byItemId: Record<string, DgAiResult | undefined> };
  /** Seller answers to Needs-your-answer questions, keyed by CheckResult.question.answerKey. */
  answers?: Record<string, "yes" | "no">;
  /** AI HS suggestions for blank codes (advice only). */
  hsSuggestions?: Record<string, { code: string; reason: string } | undefined>;
  /** IDs of Amber results the seller acknowledged ("I understand this risk"). */
  acknowledged?: readonly string[];
  /** AI advisory: does the HS code fit the description? Info only. */
  hsAdvice?: Record<string, { fits: boolean; reason: string } | undefined>;
}
