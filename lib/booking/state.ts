import { z } from "zod";
import { CARRIER_IDS, type CarrierId } from "../reference/carriers";
import type { BookingStatus } from "../rules";
import type { CheckResult } from "../rules/types";
import type { AssumptionId } from "../reference/assumptions";

// Everything about a booking besides its fields: the seller's answers, acknowledgements and carrier
// choice, plus AI advice gathered so far. Serializable so it can travel between browser and server.

const DgAiSchema = z.object({
  category: z.enum(["lithium", "aerosol", "flammable_liquid", "none", "unsure"]),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});

export const BookingStateSchema = z.object({
  answers: z.record(z.string(), z.enum(["yes", "no"])),
  /** Amber acknowledgements: who (typed name) and when (approved Q20). */
  acknowledged: z.array(z.object({ id: z.string(), name: z.string().min(1).max(100), at: z.string() })),
  chosenCarrierId: z.enum(CARRIER_IDS as [CarrierId, ...CarrierId[]]).nullable(),
  ai: z
    .object({
      available: z.boolean(),
      byItemId: z.record(z.string(), z.object({ dg: DgAiSchema, hs: z.object({ fits: z.boolean(), reason: z.string() }).nullable() })),
    })
    .nullable(),
  hsSuggestions: z.record(z.string(), z.object({ code: z.string(), reason: z.string() })),
});
export type BookingState = z.infer<typeof BookingStateSchema>;

export function emptyState(): BookingState {
  return { answers: {}, acknowledged: [], chosenCarrierId: null, ai: null, hsSuggestions: {} };
}

/** JSON-safe carrier view (decimals as strings). */
export interface CarrierRowView {
  id: CarrierId;
  name: string;
  service: string;
  pricePerPallet: string | null;
  totalCost: string | null;
  transitDays: number;
  onTimePct: number;
  maxKgPerPallet: number;
  weightPerPallet: string | null;
  eligible: boolean | null;
  excludedReason: string | null;
  minPallets: number | null;
}

export interface CarrierView {
  route: string | null;
  priority: string | null;
  evalWeight: string | null;
  evalBasis: string | null;
  rows: CarrierRowView[];
  preferred: CarrierId | null;
  recommended: CarrierId | null;
  /** Manual choice if valid, else the recommendation. */
  chosen: CarrierId | null;
  chosenIsManual: boolean;
  ranking: CarrierId[];
  reason: string | null;
  runnerUp: string | null;
  alternative: string | null;
  noneEligible: boolean;
  minPalletsAny: number | null;
  netWeightNote: string | null;
  balanced: {
    topsis: Record<string, string>;
    minMax: Record<string, string>;
    topsisWinner: string;
    minMaxWinner: string;
    confidence: "High" | "Medium" | null;
    confidenceText: string;
    marginal: string[];
  } | null;
}

export interface DatesView {
  collection: string;
  delivery: string;
  notes: string[];
  assumptions: AssumptionId[];
  carrierId: CarrierId;
}

export interface Evaluation {
  results: CheckResult[];
  status: BookingStatus;
  counts: { red: number; amber: number; info: number; missing: number; needsAnswer: number; mustFix: number; toCheck: number };
  headline: string;
  carrier: CarrierView;
  dates: DatesView | null;
  today: string;
}
