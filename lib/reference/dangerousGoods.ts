// R-06 layer 1 (keywords) and layer 3 (HS hints). Spec §6 R-06; tiers approved in ASSUMPTIONS.md Q8/Q9.
//
// Matching works on a normalised form of the text: lowercase, every non-alphanumeric character
// replaced by a space, spaces collapsed. "Li-ion", "li ion" and "LI_ION" all become "li ion".
// A term matches as a whole phrase, optionally with a plural "s"/"es" on its last word.

export type DgCategory = "lithium" | "aerosol" | "flammable_liquid";

export const DG_CATEGORY_LABEL: Record<DgCategory, string> = {
  lithium: "a lithium battery",
  aerosol: "an aerosol",
  flammable_liquid: "a flammable liquid",
};

/** red = a match is a Red failure. ask = a match needs the seller's answer. */
export type DgTier = "red" | "ask";

interface TermDef {
  term: string;
  category: DgCategory;
  tier: DgTier;
  /** Accessory words ("case", "sleeve", "glass", …) cancel a hit on this term: a phone case isn't a phone. */
  accessoryDowngrade?: boolean;
}

const red = (category: DgCategory, terms: string[], accessoryDowngrade = false): TermDef[] =>
  terms.map((term) => ({ term, category, tier: "red", accessoryDowngrade }));
const ask = (category: DgCategory, terms: string[]): TermDef[] =>
  terms.map((term) => ({ term, category, tier: "ask", accessoryDowngrade: true }));

// Product owner's rules checklist (docs/RULES-CHECKLIST.md items 27-31): devices that run on a
// lithium battery, spirits and rechargeable items are Red; their accessories are not dangerous.

export const DG_TERMS: readonly TermDef[] = [
  ...red("lithium", [
    "lithium",
    "li-ion",
    "li ion",
    "lipo",
    "li-po",
    "mah",
    "power bank",
    "powerbank",
    "rechargeable",
    "battery pack",
    "vape",
    "e-cigarette",
    "e-cig",
  ]),
  ...red(
    "lithium",
    [
      "phone",
      "smartphone",
      "mobile phone",
      "laptop",
      "tablet",
      "smartwatch",
      "fitness tracker",
      "earbuds",
      "wireless headphones",
      "drone",
      "camera",
      "e-bike",
      "ebike",
      "e-scooter",
      "electric scooter",
      "hoverboard",
    ],
    true,
  ),
  ...red("aerosol", [
    "aerosol",
    "spray can",
    "hairspray",
    "hair spray",
    "spray deodorant",
    "body spray",
    "dry shampoo",
    "spray paint",
    "compressed air",
    "air duster",
    "insect spray",
    "whipped cream charger",
    "whipped cream canister",
    "cream charger",
    "cream canister",
  ]),
  ...red("flammable_liquid", [
    "perfume",
    "parfum",
    "eau de toilette",
    "eau de parfum",
    "cologne",
    "aftershave",
    "nail polish",
    "nail varnish",
    "nail polish remover",
    "acetone",
    "hand sanitiser",
    "hand sanitizer",
    "isopropyl",
    "rubbing alcohol",
    "methylated spirit",
    "white spirit",
    "paint thinner",
    "turpentine",
    "lighter fluid",
    "lighter gas",
    "butane",
    "fuel",
    "petrol",
    "kerosene",
    "solvent-based",
    "varnish",
    "lacquer",
    "reed diffuser",
  ]),
  ...red("flammable_liquid", ["vodka", "whisky", "whiskey", "liqueur", "gin", "rum", "brandy", "tequila", "spirits"], true),
  ...ask("flammable_liquid", ["essential oil"]),
];

/** Negations cancel a match in their category (spec §6 R-06). */
export const DG_NEGATIONS: Record<DgCategory, readonly string[]> = {
  lithium: [
    "battery-free",
    "no battery",
    "no batteries",
    "batteries not included",
    "without battery",
    "without batteries",
    "alkaline",
    "nimh",
    "ni-mh",
    "no electronics",
  ],
  aerosol: ["non-aerosol", "pump spray", "trigger spray"],
  flammable_liquid: ["alcohol-free", "water-based"],
};

/** Negations that cancel only one term ("non-rechargeable lithium cell" is still lithium). */
export const DG_TERM_NEGATIONS: Record<string, readonly string[]> = {
  rechargeable: ["non-rechargeable", "not rechargeable"],
  tablet: ["vitamin", "vitamins", "pill", "pills", "supplement", "supplements", "dishwasher", "effervescent", "chewable", "mg", "medicine", "tablet case", "tablet stand"],
};

/** Accessory words: present → a device/drink hit is cancelled ("Silicone phone case", "gin glass"). */
export const DG_ACCESSORY_WORDS: readonly string[] = [
  "case",
  "cover",
  "sleeve",
  "bag",
  "stand",
  "holder",
  "mount",
  "strap",
  "band",
  "screen protector",
  "tripod",
  "lens cap",
  "glass",
  "glasses",
  "mug",
  "tumbler",
];

/** "Empty" turns any aerosol / flammable-liquid hit into a question ("Perfume bottle, empty"). */
export const DG_EMPTY_WORD = "empty";

export function normaliseForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const phraseCache = new Map<string, RegExp>();
function phraseRegex(phrase: string): RegExp {
  let re = phraseCache.get(phrase);
  if (!re) {
    re = new RegExp(`(?:^| )${escapeRegex(normaliseForMatch(phrase))}(?:s|es)?(?= |$)`);
    phraseCache.set(phrase, re);
  }
  return re;
}

export function containsPhrase(normalisedText: string, phrase: string): boolean {
  return phraseRegex(phrase).test(normalisedText);
}

/** "phone case", "laptop carry bag", "gin glass": the accessory word follows the device or drink,
 *  at most one word apart. "Earbuds with charging case" is not an accessory: the earbuds are the item. */
function isAccessoryOf(norm: string, term: string, accessory: string): boolean {
  const t = escapeRegex(normaliseForMatch(term));
  const a = escapeRegex(normaliseForMatch(accessory));
  return new RegExp(`(?:^| )${t}(?:s|es)? (?!with |and |plus |charging )(?:[a-z0-9]+ )?${a}(?:s|es)?(?= |$)`).test(norm);
}

const MAH_PATTERN = /(?:^| )\d+ ?mah(?= |$)/;

export interface KeywordHit {
  category: DgCategory;
  /** The term as listed (e.g. "power bank", or "10000mAh" pattern shown as "mAh"). */
  term: string;
  tier: DgTier;
  /** Set when a negation phrase cancels this hit. */
  negatedBy?: string;
  /** Set when an accessory word cancels this hit ("phone" in "phone case"). */
  accessoryOf?: string;
  /** Set when "empty" turns this hit into a question. */
  downgradedBy?: string;
}

/** Effective tier of a hit after negations, accessories and "empty"; null = cancelled. */
export function effectiveTier(hit: KeywordHit): DgTier | null {
  if (hit.negatedBy || hit.accessoryOf) return null;
  if (hit.downgradedBy) return "ask";
  return hit.tier;
}

/** Layer 1: deterministic keyword scan of a description (and/or SKU). */
export function scanKeywords(text: string): KeywordHit[] {
  const norm = normaliseForMatch(text);
  if (!norm) return [];
  const hits: KeywordHit[] = [];
  for (const def of DG_TERMS) {
    const matched = def.term === "mah" ? MAH_PATTERN.test(norm) || containsPhrase(norm, "mah") : containsPhrase(norm, def.term);
    if (!matched) continue;
    const hit: KeywordHit = { category: def.category, term: def.term, tier: def.tier };
    const negation = [...DG_NEGATIONS[def.category], ...(DG_TERM_NEGATIONS[def.term] ?? [])].find((n) => containsPhrase(norm, n));
    if (negation) hit.negatedBy = negation;
    if (def.accessoryDowngrade) {
      const acc = DG_ACCESSORY_WORDS.find((w) => isAccessoryOf(norm, def.term, w));
      if (acc) hit.accessoryOf = acc;
    }
    if (!hit.accessoryOf && def.category !== "lithium" && containsPhrase(norm, DG_EMPTY_WORD)) {
      hit.downgradedBy = DG_EMPTY_WORD;
    }
    hits.push(hit);
  }
  return hits;
}

/** Layer 3: HS code prefixes that hint at dangerous goods (checklist item 31). Only 8507.60 and
 *  8506.50 are lithium: other batteries (alkaline 8506.10, lead-acid 8507.10) are not. */
export const DG_HS_HINTS: readonly { prefix: string; category: DgCategory; label: string }[] = [
  { prefix: "850760", category: "lithium", label: "lithium-ion batteries" },
  { prefix: "850650", category: "lithium", label: "lithium batteries" },
  { prefix: "3303", category: "flammable_liquid", label: "perfumes and toilet waters" },
  { prefix: "3307", category: "aerosol", label: "deodorants and other sprays" },
  { prefix: "3208", category: "flammable_liquid", label: "solvent-based paints and varnishes" },
  { prefix: "2208", category: "flammable_liquid", label: "spirits" },
  { prefix: "3606", category: "flammable_liquid", label: "lighter fuel" },
];

export function hsHint(hsDigits: string | null): (typeof DG_HS_HINTS)[number] | null {
  if (!hsDigits) return null;
  return DG_HS_HINTS.find((h) => hsDigits.startsWith(h.prefix)) ?? null;
}
