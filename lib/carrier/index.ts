import type { DestinationCountry, Priority } from "../reference/allowed";
import { CARRIERS, type Carrier, type CarrierId } from "../reference/carriers";
import { Decimal, dec } from "../num";
import { fmtGBP, fmtKg, fmtNum } from "../format";

// Deterministic carrier recommendation (spec §10). Nothing here knows which carrier is cheapest,
// fastest etc. — everything is derived from the rate card.

export interface CarrierInput {
  destinationCountry: DestinationCountry | null;
  pallets: number | null;
  grossKg: Decimal | null;
  /** Σ unit weight × quantity; null when any item lacks a unit weight or quantity. */
  netKg: Decimal | null;
  priority: Priority | null;
}

export interface CarrierRow {
  carrier: Carrier;
  /** Null when there's no route (destination country missing). */
  pricePerPallet: Decimal | null;
  totalCost: Decimal | null;
  /** evalWeight ÷ pallets, full precision. */
  weightPerPallet: Decimal | null;
  /** null = can't tell (pallets or weight missing). */
  eligible: boolean | null;
  /** Eligibility on stated gross weight alone (to tell whether net weight changed the outcome). */
  eligibleOnGross: boolean | null;
  excludedReason: string | null;
  /** Fewest pallets this carrier could take the load on. */
  minPallets: number | null;
}

export interface BalancedDetail {
  topsis: Record<CarrierId, string>;
  minMax: Record<CarrierId, string>;
  topsisWinner: CarrierId;
  minMaxWinner: CarrierId;
  /** null when only one carrier was eligible. */
  confidence: "High" | "Medium" | null;
  confidenceText: string;
  marginal: string[];
}

export interface Alternative {
  carrierId: CarrierId;
  pallets: number;
  weightPerPallet: Decimal;
  cost: Decimal | null;
  vsCost: Decimal | null;
  text: string;
}

export interface CarrierAnalysis {
  route: DestinationCountry | null;
  priority: Priority | null;
  evalWeight: Decimal | null;
  /** gross = gross ≥ net; net = products outweigh stated gross; gross_only = net unknown (A9). */
  evalBasis: "gross" | "net" | "gross_only" | null;
  rows: CarrierRow[];
  preferred: CarrierId | null;
  recommended: CarrierId | null;
  /** Eligible carriers, best first. */
  ranking: CarrierId[];
  reason: string | null;
  runnerUp: { carrierId: CarrierId; text: string } | null;
  alternative: Alternative | null;
  noneEligible: boolean;
  /** ceil(evalWeight ÷ highest max) when no carrier fits. */
  minPalletsAny: number | null;
  netWeightNote: string | null;
  balanced: BalancedDetail | null;
}

const ONE_THIRD = dec(1).div(3);

export function ceilDiv(a: Decimal, b: Decimal | number): number {
  return a.div(b).ceil().toNumber();
}

/** 450 → "450 kg", 206.666… → "206.7 kg" (1 dp, trailing zero dropped). */
export function fmtKg1(v: Decimal): string {
  return fmtKg(v.toDecimalPlaces(1));
}

function rowCost(r: CarrierRow): Decimal | null {
  return r.totalCost ?? r.pricePerPallet;
}

type Comparator = (a: CarrierRow, b: CarrierRow) => number;

const byCost: Comparator = (a, b) => {
  const ca = rowCost(a);
  const cb = rowCost(b);
  if (!ca || !cb) return 0;
  return ca.cmp(cb);
};
const byTransit: Comparator = (a, b) => a.carrier.transitDays - b.carrier.transitDays;
const byOnTimeDesc: Comparator = (a, b) => b.carrier.onTimePct - a.carrier.onTimePct;
const byName: Comparator = (a, b) => (a.carrier.name < b.carrier.name ? -1 : a.carrier.name > b.carrier.name ? 1 : 0);

function chain(...cs: Comparator[]): Comparator {
  return (a, b) => {
    for (const c of cs) {
      const r = c(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

const RANKERS: Record<Exclude<Priority, "Balanced">, Comparator[]> = {
  Cheapest: [byCost, byTransit, byOnTimeDesc, byName],
  Fastest: [byTransit, byOnTimeDesc, byCost, byName],
  "Most reliable": [byOnTimeDesc, byCost, byTransit, byName],
};

interface Criteria {
  id: CarrierId;
  cost: Decimal;
  transit: Decimal;
  onTime: Decimal;
}

function criteriaOf(rows: CarrierRow[]): Criteria[] {
  return rows.map((r) => ({
    id: r.carrier.id,
    cost: rowCost(r) ?? dec(0),
    transit: dec(r.carrier.transitDays),
    onTime: dec(r.carrier.onTimePct),
  }));
}

/** TOPSIS, equal weights, vector normalisation. Cost and transit lower-is-better; on-time higher. */
export function topsisScores(rows: CarrierRow[]): Map<CarrierId, Decimal> {
  const cs = criteriaOf(rows);
  const keys = ["cost", "transit", "onTime"] as const;
  const benefit = { cost: false, transit: false, onTime: true };
  const norm: Record<string, Decimal> = {};
  for (const k of keys) {
    norm[k] = cs.reduce((acc, c) => acc.plus(c[k].pow(2)), dec(0)).sqrt();
  }
  const weighted = cs.map((c) => {
    const v: Record<string, Decimal> = {};
    for (const k of keys) v[k] = norm[k].isZero() ? dec(0) : c[k].div(norm[k]).times(ONE_THIRD);
    return { id: c.id, v };
  });
  const ideal: Record<string, Decimal> = {};
  const anti: Record<string, Decimal> = {};
  for (const k of keys) {
    const vals = weighted.map((w) => w.v[k]);
    const mx = Decimal.max(...vals);
    const mn = Decimal.min(...vals);
    ideal[k] = benefit[k] ? mx : mn;
    anti[k] = benefit[k] ? mn : mx;
  }
  const out = new Map<CarrierId, Decimal>();
  for (const w of weighted) {
    let dPlus = dec(0);
    let dMinus = dec(0);
    for (const k of keys) {
      dPlus = dPlus.plus(w.v[k].minus(ideal[k]).pow(2));
      dMinus = dMinus.plus(w.v[k].minus(anti[k]).pow(2));
    }
    dPlus = dPlus.sqrt();
    dMinus = dMinus.sqrt();
    const denom = dPlus.plus(dMinus);
    out.set(w.id, denom.isZero() ? dec(0) : dMinus.div(denom));
  }
  return out;
}

/** Min-max weighted scoring (used only as a confidence cross-check). */
export function minMaxScores(rows: CarrierRow[]): Map<CarrierId, Decimal> {
  const cs = criteriaOf(rows);
  const keys = ["cost", "transit", "onTime"] as const;
  const benefit = { cost: false, transit: false, onTime: true };
  const out = new Map<CarrierId, Decimal>(cs.map((c) => [c.id, dec(0)]));
  for (const k of keys) {
    const vals = cs.map((c) => c[k]);
    const mx = Decimal.max(...vals);
    const mn = Decimal.min(...vals);
    const range = mx.minus(mn);
    for (const c of cs) {
      if (range.isZero()) continue;
      const s = benefit[k] ? c[k].minus(mn).div(range) : mx.minus(c[k]).div(range);
      out.set(c.id, out.get(c.id)!.plus(s.times(ONE_THIRD)));
    }
  }
  return out;
}

function rankByScore(rows: CarrierRow[], scores: Map<CarrierId, Decimal>): CarrierRow[] {
  return [...rows].sort(
    chain((a, b) => scores.get(b.carrier.id)!.cmp(scores.get(a.carrier.id)!), byCost, byName),
  );
}

export function rankCarriers(rows: CarrierRow[], priority: Priority): CarrierRow[] {
  if (rows.length === 0) return [];
  if (priority === "Balanced") return rankByScore(rows, topsisScores(rows));
  return [...rows].sort(chain(...RANKERS[priority]));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${Math.abs(n) === 1 ? one : many}`;
}

function daysPhrase(fasterBy: number): string {
  if (fasterBy > 0) return `${plural(fasterBy, "day")} faster`;
  if (fasterBy < 0) return `${plural(-fasterBy, "day")} slower`;
  return "no faster";
}

function pointsPhrase(moreReliableBy: number): string {
  if (moreReliableBy > 0) return `${plural(moreReliableBy, "point")} more reliable`;
  if (moreReliableBy < 0) return `${plural(-moreReliableBy, "point")} less reliable`;
  return "equally reliable";
}

/** "B costs £40 more per pallet than A but is 2 days faster and 3 points more reliable." */
export function marginalExplanation(rows: CarrierRow[]): string[] {
  const sorted = [...rows].filter((r) => r.pricePerPallet).sort(chain((a, b) => a.pricePerPallet!.cmp(b.pricePerPallet!), byName));
  const lines: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const diff = cur.pricePerPallet!.minus(prev.pricePerPallet!);
    const gain = `${daysPhrase(prev.carrier.transitDays - cur.carrier.transitDays)} and ${pointsPhrase(cur.carrier.onTimePct - prev.carrier.onTimePct)}`;
    const name = cur.carrier.name;
    if (diff.isZero()) {
      lines.push(`${name} costs the same per pallet as ${prev.carrier.name} and is ${gain}.`);
    } else if (i === 1) {
      lines.push(`${name} costs ${fmtGBP(diff)} more per pallet than ${prev.carrier.name} but is ${gain}.`);
    } else {
      lines.push(`${name} costs a further ${fmtGBP(diff)} per pallet (vs ${prev.carrier.name}) for ${gain}.`);
    }
  }
  return lines;
}

function costText(r: CarrierRow, pallets: number | null): string {
  if (r.totalCost && pallets) return `${fmtGBP(r.totalCost)} (${pallets} × ${fmtGBP(r.pricePerPallet!)})`;
  if (r.pricePerPallet) return `${fmtGBP(r.pricePerPallet)} per pallet`;
  return "no price (destination country missing)";
}

function reasonFor(priority: Priority, winner: CarrierRow, ranked: CarrierRow[], pallets: number | null, scores?: Map<CarrierId, Decimal>): string {
  const c = winner.carrier;
  const only = ranked.length === 1;
  if (only) return `${c.name} is the only carrier that can take this load.`;
  const second = ranked[1];
  let base: string;
  let primaryTie: boolean;
  switch (priority) {
    case "Cheapest":
      base = `${c.name} is the cheapest eligible option at ${costText(winner, pallets)}.`;
      primaryTie = byCost(winner, second) === 0;
      break;
    case "Fastest":
      base = `${c.name} is the fastest eligible option: ${plural(c.transitDays, "working day")} in transit.`;
      primaryTie = byTransit(winner, second) === 0;
      break;
    case "Most reliable":
      base = `${c.name} has the best on-time record among eligible carriers: ${c.onTimePct}%.`;
      primaryTie = byOnTimeDesc(winner, second) === 0;
      break;
    case "Balanced":
      base = `${c.name} gives the best balance of cost, speed and reliability (score ${scores!.get(c.id)!.toFixed(3)} of 1).`;
      primaryTie = scores!.get(c.id)!.eq(scores!.get(second.carrier.id)!);
      break;
  }
  if (primaryTie) base += ` It ties with ${second.carrier.name} on that measure and wins on the next tie-break.`;
  return base;
}

function runnerUpText(winner: CarrierRow, second: CarrierRow, pallets: number | null): string {
  const parts: string[] = [];
  const wc = rowCost(winner);
  const sc = rowCost(second);
  if (wc && sc) {
    const d = sc.minus(wc);
    const unit = winner.totalCost ? "" : " per pallet";
    parts.push(d.isZero() ? "same cost" : d.isPositive() ? `${fmtGBP(d)} more${unit}` : `${fmtGBP(d.abs())} less${unit}`);
  }
  parts.push(daysPhrase(winner.carrier.transitDays - second.carrier.transitDays));
  parts.push(pointsPhrase(second.carrier.onTimePct - winner.carrier.onTimePct));
  return `Runner-up: ${second.carrier.name} ${second.carrier.service}, ${costText(second, pallets)}; ${parts.join(", ")}.`;
}

export function analyseCarriers(input: CarrierInput): CarrierAnalysis {
  const { destinationCountry: route, pallets, grossKg, netKg, priority } = input;

  let evalWeight: Decimal | null = null;
  let evalBasis: CarrierAnalysis["evalBasis"] = null;
  if (grossKg) {
    if (netKg === null) {
      evalWeight = grossKg;
      evalBasis = "gross_only";
    } else if (netKg.gt(grossKg)) {
      evalWeight = netKg;
      evalBasis = "net";
    } else {
      evalWeight = grossKg;
      evalBasis = "gross";
    }
  }

  const rows: CarrierRow[] = CARRIERS.map((carrier) => {
    const pricePerPallet = route ? dec(carrier.pricePerPallet[route]) : null;
    const totalCost = pricePerPallet && pallets ? pricePerPallet.times(pallets) : null;
    const weightPerPallet = evalWeight && pallets ? evalWeight.div(pallets) : null;
    const eligible = weightPerPallet ? weightPerPallet.lte(carrier.maxKgPerPallet) : null;
    const eligibleOnGross = grossKg && pallets ? grossKg.div(pallets).lte(carrier.maxKgPerPallet) : null;
    const minPallets = evalWeight ? Math.max(1, ceilDiv(evalWeight, carrier.maxKgPerPallet)) : null;
    const excludedReason =
      eligible === false
        ? `${fmtKg(evalWeight!)} ÷ ${pallets} pallets = ${fmtKg1(weightPerPallet!)} per pallet, over ${carrier.name}'s ${fmtKg(carrier.maxKgPerPallet)} limit.`
        : null;
    return { carrier, pricePerPallet, totalCost, weightPerPallet, eligible, eligibleOnGross, excludedReason, minPallets };
  });

  const eligibleRows = rows.filter((r) => r.eligible === true);
  const knowEligibility = rows.every((r) => r.eligible !== null);
  const noneEligible = knowEligibility && eligibleRows.length === 0;
  const highestMax = Math.max(...CARRIERS.map((c) => c.maxKgPerPallet));
  const minPalletsAny = noneEligible && evalWeight ? ceilDiv(evalWeight, highestMax) : null;

  let netWeightNote: string | null = null;
  if (evalBasis === "net" && rows.some((r) => r.eligible !== r.eligibleOnGross)) {
    netWeightNote = `Your products alone weigh ${fmtKg(netKg!)}, more than the stated gross weight of ${fmtKg(grossKg!)}, so we checked each carrier's limit against ${fmtKg(netKg!)}. This changed which carriers can take the load.`;
  }

  const base: CarrierAnalysis = {
    route,
    priority,
    evalWeight,
    evalBasis,
    rows,
    preferred: null,
    recommended: null,
    ranking: [],
    reason: null,
    runnerUp: null,
    alternative: null,
    noneEligible,
    minPalletsAny,
    netWeightNote,
    balanced: null,
  };
  if (!priority) return base;

  // Ranking needs a cost; without a route there's no price, so cost-based priorities can't rank.
  const needsCost = route !== null;
  if (!needsCost) return base;

  const preferredRanked = rankCarriers(rows, priority);
  base.preferred = preferredRanked[0].carrier.id;

  // Every booking gets a recommendation (rules checklist 68), even before it can be confirmed.
  if (!knowEligibility) {
    base.recommended = preferredRanked[0].carrier.id;
    base.ranking = preferredRanked.map((r) => r.carrier.id);
    base.reason = `Once we know the pallets and weight, ${preferredRanked[0].carrier.name} looks best for "${priority}" on this route. We'll confirm it can take the load.`;
    return base;
  }
  if (eligibleRows.length === 0) {
    if (!evalWeight) return base;
    // No carrier fits as packed: rank them as if repacked onto the pallets each one would need.
    const repacked = rows.map((r) => ({ ...r, totalCost: r.pricePerPallet && r.minPallets ? r.pricePerPallet.times(r.minPallets) : null, eligible: true }));
    const best = rankCarriers(repacked, priority)[0];
    base.recommended = best.carrier.id;
    base.ranking = rankCarriers(repacked, priority).map((r) => r.carrier.id);
    base.reason = `Once repacked onto ${best.minPallets} pallets (${fmtKg1(evalWeight.div(best.minPallets!))} each), use ${best.carrier.name}: ${best.minPallets} × ${fmtGBP(best.pricePerPallet!)} = ${fmtGBP(best.totalCost!)}, the best "${priority}" option.`;
    return base;
  }

  const ranked = rankCarriers(eligibleRows, priority);
  const winner = ranked[0];
  base.recommended = winner.carrier.id;
  base.ranking = ranked.map((r) => r.carrier.id);

  let scores: Map<CarrierId, Decimal> | undefined;
  if (priority === "Balanced") {
    scores = topsisScores(eligibleRows);
    const mm = minMaxScores(eligibleRows);
    const mmWinner = rankByScore(eligibleRows, mm)[0].carrier.id;
    const single = eligibleRows.length === 1;
    const confidence = single ? null : mmWinner === winner.carrier.id ? "High" : "Medium";
    const toRecord = (m: Map<CarrierId, Decimal>) =>
      Object.fromEntries([...m.entries()].map(([k, v]) => [k, v.toFixed(3)])) as Record<CarrierId, string>;
    base.balanced = {
      topsis: toRecord(scores),
      minMax: toRecord(mm),
      topsisWinner: winner.carrier.id,
      minMaxWinner: mmWinner,
      confidence,
      confidenceText:
        confidence === null
          ? "Only one carrier can take this load, so it wins."
          : confidence === "High"
            ? "High: both scoring methods pick the same carrier."
            : "Medium: scoring methods disagree; we chose the better value.",
      marginal: marginalExplanation(eligibleRows),
    };
  }

  base.reason = reasonFor(priority, winner, ranked, pallets, scores);
  if (ranked.length > 1) {
    base.runnerUp = { carrierId: ranked[1].carrier.id, text: runnerUpText(winner, ranked[1], pallets) };
  }

  const pref = rows.find((r) => r.carrier.id === base.preferred)!;
  if (base.preferred !== base.recommended && pref.eligible === false && evalWeight && pallets) {
    const needed = ceilDiv(evalWeight, pref.carrier.maxKgPerPallet);
    const wpp = evalWeight.div(needed);
    const cost = pref.pricePerPallet ? pref.pricePerPallet.times(needed) : null;
    const vsCost = winner.totalCost;
    let text = `To use ${pref.carrier.name}, repack onto ${needed} pallets (${fmtKg1(wpp)} each)`;
    if (cost && vsCost) {
      const diff = cost.minus(vsCost);
      const sooner = winner.carrier.transitDays - pref.carrier.transitDays;
      const diffText = diff.isZero() ? "the same cost" : diff.isPositive() ? `${fmtGBP(diff)} more` : `${fmtGBP(diff.abs())} less`;
      const when = sooner > 0 ? `${plural(sooner, "day")} sooner` : sooner < 0 ? `${plural(-sooner, "day")} later` : "same transit time";
      text += `: ${needed} × ${fmtGBP(pref.pricePerPallet!)} = ${fmtGBP(cost)} vs ${pallets} × ${fmtGBP(winner.pricePerPallet!)} = ${fmtGBP(vsCost)} with ${winner.carrier.name}, ${diffText}, ${when}.`;
    } else {
      text += ".";
    }
    base.alternative = { carrierId: pref.carrier.id, pallets: needed, weightPerPallet: wpp, cost, vsCost, text };
  }
  return base;
}

/** "A 500 kg ✓ · B 750 kg ✓ · C 400 kg ✗" — R-05's per-carrier line. */
export function carrierWeightLine(a: CarrierAnalysis): string {
  return a.rows
    .map((r) => `${r.carrier.id} ${fmtNum(r.carrier.maxKgPerPallet)} kg ${r.eligible === null ? "?" : r.eligible ? "✓" : "✗"}`)
    .join(" · ");
}
