import { describe, expect, it } from "vitest";
import {
  DG_NEGATIONS,
  DG_TERMS,
  effectiveTier,
  hsHint,
  scanKeywords,
  type DgTier,
} from "@/lib/reference/dangerousGoods";

/** Strongest effective tier found in the text: "red", "ask" or null (clean). */
function verdict(text: string): DgTier | null {
  const tiers = scanKeywords(text).map(effectiveTier);
  if (tiers.includes("red")) return "red";
  if (tiers.includes("ask")) return "ask";
  return null;
}

describe("R-06 keyword list: every term matches as a whole word", () => {
  for (const def of DG_TERMS) {
    it(`"${def.term}" → ${def.tier}`, () => {
      const sample = def.term === "mah" ? "Spare cell 5000 mAh" : `Box of ${def.term} items`;
      const hits = scanKeywords(sample);
      expect(hits.some((h) => h.term === def.term && h.category === def.category && h.tier === def.tier)).toBe(true);
    });
  }
});

describe("R-06 negations cancel a match in their category", () => {
  const triggers = { lithium: "lithium", aerosol: "aerosol", flammable_liquid: "varnish" } as const;
  for (const [category, negs] of Object.entries(DG_NEGATIONS)) {
    for (const neg of negs) {
      it(`"${neg}" cancels ${category}`, () => {
        const text = `${triggers[category as keyof typeof triggers]} product, ${neg}`;
        const hits = scanKeywords(text).filter((h) => h.category === category);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every((h) => h.negatedBy !== undefined)).toBe(true);
      });
    }
  }
});

describe("R-06 spec examples (§19)", () => {
  it.each([
    ["Portable power bank 10000mAh", "red"],
    ["Eau de parfum 50 ml", "red"],
    ["Hairspray 250 ml", "red"],
    ["Torch, batteries not included", null],
    ["AA alkaline batteries", null],
    ["Pump spray bottle, empty", null],
    ["Portable charger", null],
  ] as const)("%s → %s", (text, expected) => {
    expect(verdict(text)).toBe(expected);
  });
});

describe("R-06 matching details", () => {
  it("matches hyphen/space variants and plurals", () => {
    expect(verdict("LI-ION cells")).toBe("red");
    expect(verdict("li ion cells")).toBe("red");
    expect(verdict("Power banks x10")).toBe("red");
    expect(verdict("Lithium batteries")).toBe("red");
  });

  it("matches a number followed by mAh (approved Q9)", () => {
    expect(verdict("Cell 10000mAh")).toBe("red");
    expect(verdict("Cell 2600 mAh")).toBe("red");
  });

  it("does not match inside other words", () => {
    expect(verdict("Headphones stand")).toBe(null); // "phone" is not a whole word here
    expect(verdict("Ginger biscuits")).toBe(null);
    expect(verdict("Rummage box")).toBe(null);
    expect(verdict("Fueling station sign")).toBe(null);
  });

  it("AA / AAA / alkaline alone are not lithium", () => {
    expect(verdict("AAA batteries")).toBe(null);
    expect(verdict("Alkaline cells")).toBe(null);
  });

  it("devices with lithium batteries and spirits are Red (rules checklist 27, 29)", () => {
    expect(verdict("Smartphone 128GB")).toBe("red");
    expect(verdict("Kids rechargeable remote control car")).toBe("red");
    expect(verdict("Bluetooth wireless earbuds with charging case")).toBe("red");
    expect(verdict("London dry gin 70cl")).toBe("red");
    expect(verdict("Non-rechargeable lithium coin cell")).toBe("red");
  });

  it("accessories and look-alikes are not dangerous goods (rules checklist 30)", () => {
    expect(verdict("Silicone phone case (no electronics)")).toBeNull();
    expect(verdict("Neoprene laptop sleeve, 13 inch")).toBeNull();
    expect(verdict("Whisky glass")).toBeNull();
    expect(verdict("Vitamin tablets")).toBeNull();
    expect(verdict("AA alkaline batteries, pack of 4")).toBeNull();
    expect(verdict("Ginger biscuits")).toBeNull();
    expect(verdict("Whisky 70cl")).toBe("red");
  });

  it("'empty' turns aerosol/flammable hits into a question", () => {
    expect(verdict("Perfume bottle, empty")).toBe("ask");
    expect(verdict("Perfume bottle")).toBe("red");
  });

  it("a negation in one category doesn't cancel another", () => {
    expect(verdict("Water-based spray paint")).toBe("red");
  });
});

describe("R-06 HS hints", () => {
  it.each([
    ["850760", "lithium"],
    ["850650", "lithium"],
    ["330300", "flammable_liquid"],
    ["330720", "aerosol"],
    ["320810", "flammable_liquid"],
    ["220830", "flammable_liquid"],
    ["360610", "flammable_liquid"],
  ])("%s → %s", (hs, cat) => {
    expect(hsHint(hs)?.category).toBe(cat);
  });

  it("no hint for ordinary codes or blanks", () => {
    expect(hsHint("691200")).toBe(null);
    expect(hsHint(null)).toBe(null);
  });
});
