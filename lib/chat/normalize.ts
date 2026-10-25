import Fuse from "fuse.js";
import {
  DESTINATION_CITIES,
  DESTINATION_COUNTRIES,
  DESTINATION_TYPES,
  ITEM_ORIGIN_COUNTRIES,
  ORIGIN_CITIES,
  PRIORITIES,
  YES_NO,
} from "../reference/allowed";
import { Decimal } from "../num";
import { fmtNum } from "../format";

// Turns what the seller wrote ("Frankfrut", "Holland", "5k", "300 lb") into allowed values, in code
// (spec §12.4). Every interpretation is reported so the reply can show it. Nothing is guessed: a
// value we can't place confidently comes back as an error and the bot asks again.

export type ListKind = "originCity" | "destinationCity" | "destinationCountry" | "destinationType" | "priority" | "yesNo" | "countryOfOrigin";

const LISTS: Record<ListKind, readonly string[]> = {
  originCity: ORIGIN_CITIES,
  destinationCity: DESTINATION_CITIES,
  destinationCountry: DESTINATION_COUNTRIES,
  destinationType: DESTINATION_TYPES,
  priority: PRIORITIES,
  yesNo: YES_NO,
  countryOfOrigin: ITEM_ORIGIN_COUNTRIES,
};

/** Everyday words → allowed values (spec §12.4). Keys are lowercase. */
const SYNONYMS: Record<ListKind, Record<string, string>> = {
  originCity: {},
  destinationCity: {},
  destinationCountry: {
    holland: "Netherlands",
    "the netherlands": "Netherlands",
    nl: "Netherlands",
    deutschland: "Germany",
  },
  destinationType: {
    amazon: "Warehouse",
    "amazon warehouse": "Warehouse",
    "fulfilment centre": "Warehouse",
    "fulfillment center": "Warehouse",
    "fulfilment center": "Warehouse",
    "3pl": "Warehouse",
    dc: "Warehouse",
    "distribution centre": "Warehouse",
    shop: "Business address",
    office: "Business address",
    store: "Business address",
    "client's premises": "Business address",
    "clients premises": "Business address",
    "customer's premises": "Business address",
    business: "Business address",
  },
  priority: {
    cheap: "Cheapest",
    cheapest: "Cheapest",
    "lowest cost": "Cheapest",
    "lowest price": "Cheapest",
    fast: "Fastest",
    quick: "Fastest",
    quickest: "Fastest",
    fastest: "Fastest",
    asap: "Fastest",
    reliable: "Most reliable",
    "most reliable": "Most reliable",
    "on time": "Most reliable",
    balanced: "Balanced",
    balance: "Balanced",
  },
  yesNo: { y: "Yes", yes: "Yes", yep: "Yes", yeah: "Yes", booked: "Yes", n: "No", no: "No", nope: "No", "not yet": "No", "not booked": "No" },
  countryOfOrigin: {
    uk: "United Kingdom",
    "u.k.": "United Kingdom",
    england: "United Kingdom",
    britain: "United Kingdom",
    "great britain": "United Kingdom",
    "made here": "United Kingdom",
    "made in the uk": "United Kingdom",
    scotland: "United Kingdom",
    wales: "United Kingdom",
    "northern ireland": "United Kingdom",
    prc: "China",
  },
};

/** Optimal-string-alignment distance (adjacent transpositions count as one edit). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export type Match = { ok: true; value: string; how: "exact" | "synonym" | "fuzzy"; said: string } | { ok: false; said: string };

const fuses = new Map<ListKind, Fuse<string>>();

function clean(s: string): string {
  return s.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

export function matchAllowed(kind: ListKind, said: string): Match {
  const s = clean(said);
  const list = LISTS[kind];
  const exact = list.find((v) => v.toLowerCase() === s);
  if (exact) return { ok: true, value: exact, how: "exact", said };
  const syn = SYNONYMS[kind][s];
  if (syn) return { ok: true, value: syn, how: "synonym", said };
  // Fuzzy: Fuse proposes, a strict edit-distance check decides ("Frankfrut" yes, "Munich" never).
  let fuse = fuses.get(kind);
  if (!fuse) {
    fuse = new Fuse([...list], { includeScore: true, threshold: 0.4 });
    fuses.set(kind, fuse);
  }
  const limit = (len: number) => (len <= 5 ? 1 : 2);
  const close = fuse
    .search(s)
    .map((r) => ({ v: r.item, d: editDistance(s, r.item.toLowerCase()) }))
    .filter((c) => c.d <= limit(c.v.length));
  if (close.length === 0) return { ok: false, said };
  const best = Math.min(...close.map((c) => c.d));
  const winners = close.filter((c) => c.d === best);
  if (winners.length !== 1) return { ok: false, said };
  return { ok: true, value: winners[0].v, how: "fuzzy", said };
}

export const LIST_FOR_PROMPT = LISTS;

// --- Numbers, units and currency.

export type AmountKind = "int" | "money" | "weight";

const SMALL: Record<string, number> = {
  zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, dozen: 12,
};

/** "two" → 2, "twenty four" / "twenty-four" → 24, "a dozen" → 12. Up to 99; anything else → null. */
export function wordsToNumber(s: string): number | null {
  const words = s.toLowerCase().replace(/-/g, " ").trim().split(/\s+/).filter((w) => w !== "and");
  if (words.length === 2 && (words[0] === "a" || words[0] === "an") && words[1] === "dozen") return 12;
  if (words.length === 1 && words[0] in SMALL) return SMALL[words[0]];
  if (words.length === 2 && SMALL[words[0]] >= 20 && SMALL[words[0]] % 10 === 0 && SMALL[words[1]] >= 1 && SMALL[words[1]] <= 9) return SMALL[words[0]] + SMALL[words[1]];
  return null;
}

/** True when the text names a currency other than GBP (spec §12.4: never convert). */
export function mentionsOtherCurrency(text: string): boolean {
  return NON_GBP.test(text);
}
export type Amount = { ok: true; value: string; note: string | null } | { ok: false; why: string };

const NON_GBP = /(€|\$|eur\b|euros?\b|usd\b|dollars?\b|¥|yen\b|rupees?\b|inr\b|cny\b|rmb\b)/i;

/** "5k" → 5000; "1,080" → 1080; "£5.00" → 5.00; "300 lb" → 136.077711 kg (shown in the note). */
export function parseAmount(rawValue: string, unit: string | null, kind: AmountKind): Amount {
  const text = `${rawValue} ${unit ?? ""}`.trim();
  if (kind === "money" && NON_GBP.test(text)) return { ok: false, why: "Please give the value in GBP." };
  const word = wordsToNumber(rawValue);
  const s = word !== null ? String(word) : rawValue.toLowerCase().replace(/£|gbp|pounds? sterling/g, "").replace(/,/g, "").trim();
  // Packing words are counts, not units: "24 to a box", "per carton", "pallets".
  let u = (unit ?? "").toLowerCase().trim().replace(/^(per|to an?|an?|in an?|in each|each)\s+/, "");
  // A GBP marker in the unit ("£", "GBP", "pounds") isn't a unit for money.
  if (kind === "money" && /^(£|gbp|pounds?|sterling|each|per unit)?$/.test(u)) u = "";
  const m = /^(-?\d+(?:\.\d+)?)\s*([a-z]*)\.?$/.exec(s);
  if (!m) return { ok: false, why: `I couldn't read "${rawValue}" as a number.` };
  let n = new Decimal(m[1]);
  const suffix = m[2];
  if (suffix && !u) u = suffix;
  let note: string | null = null;
  if (u === "k" || u === "thousand") {
    n = n.times(1000);
    note = `${rawValue} = ${fmtNum(n)}`;
    u = "";
  }
  if (kind === "weight") {
    const kg = ["", "kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"];
    if (["lb", "lbs", "pound", "pounds"].includes(u)) {
      const out = n.times("0.45359237");
      note = `${fmtNum(n)} lb × 0.45359237 = ${fmtNum(out.toDecimalPlaces(2))} kg`;
      n = out;
    } else if (["t", "tonne", "tonnes", "metric ton", "metric tons"].includes(u)) {
      const out = n.times(1000);
      note = `${fmtNum(n)} tonnes = ${fmtNum(out)} kg`;
      n = out;
    } else if (["g", "gram", "grams"].includes(u)) {
      const out = n.div(1000);
      note = `${fmtNum(n)} g = ${fmtNum(out)} kg`;
      n = out;
    } else if (["ton", "tons"].includes(u)) {
      return { ok: false, why: `"${text}" could be UK, US or metric tons — please give the weight in kg (or tonnes).` };
    } else if (!kg.includes(u)) {
      return { ok: false, why: `I don't know the unit "${u}" — please give the weight in kg.` };
    }
    if (n.lte(0)) return { ok: false, why: "The weight must be more than 0." };
    return { ok: true, value: n.toFixed(), note };
  }
  const COUNT_WORDS = ["", "unit", "units", "pc", "pcs", "piece", "pieces", "box", "boxes", "carton", "cartons", "case", "cases", "pallet", "pallets", "item", "items"];
  if (u && !COUNT_WORDS.includes(u)) {
    return { ok: false, why: `I don't know the unit "${u}".` };
  }
  if (kind === "money") {
    if (n.lt(0)) return { ok: false, why: "The value can't be negative." };
    return { ok: true, value: n.toFixed(), note };
  }
  if (!n.isInteger() || n.lte(0)) return { ok: false, why: `That needs to be a whole number above 0 (you said ${rawValue}).` };
  return { ok: true, value: n.toFixed(0), note };
}
