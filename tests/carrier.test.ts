import { describe, expect, it } from "vitest";
import { analyseCarriers, rankCarriers, type CarrierInput, type CarrierRow } from "@/lib/carrier";
import { DESTINATION_COUNTRIES, PRIORITIES } from "@/lib/reference/allowed";
import { dec } from "@/lib/num";
import type { Carrier } from "@/lib/reference/carriers";

const base: CarrierInput = { destinationCountry: "Germany", pallets: 3, grossKg: dec(620), netKg: dec(540), priority: "Cheapest" };
const run = (o: Partial<CarrierInput>) => analyseCarriers({ ...base, ...o });

describe("BK-001", () => {
  it("→ Carrier A Road economy, 3 × £180 = £540", () => {
    const a = run({});
    expect(a.recommended).toBe("A");
    const row = a.rows.find((r) => r.carrier.id === "A")!;
    expect(row.totalCost!.toString()).toBe("540");
    expect(a.reason).toBe("Carrier A is the cheapest eligible option at £540 (3 × £180).");
    expect(a.runnerUp!.text).toBe("Runner-up: Carrier B Road standard — £660 (3 × £220); £120 more, 2 days faster, 3 points more reliable.");
  });
});

describe("each priority on each route (all carriers eligible)", () => {
  const expected = { Cheapest: "A", Fastest: "C", "Most reliable": "C", Balanced: "B" } as const;
  for (const route of DESTINATION_COUNTRIES) {
    for (const priority of PRIORITIES) {
      it(`${route} / ${priority} → ${expected[priority]}`, () => {
        const a = run({ destinationCountry: route, priority });
        expect(a.recommended).toBe(expected[priority]);
        expect(a.preferred).toBe(expected[priority]);
        expect(a.ranking).toHaveLength(3);
      });
    }
  }
});

describe("Balanced (TOPSIS) with the min-max cross-check", () => {
  for (const route of DESTINATION_COUNTRIES) {
    it(`${route}: TOPSIS picks B, min-max picks C → Medium confidence`, () => {
      const a = run({ destinationCountry: route, priority: "Balanced" });
      expect(a.balanced!.topsisWinner).toBe("B");
      expect(a.balanced!.minMaxWinner).toBe("C");
      expect(a.balanced!.confidence).toBe("Medium");
      expect(a.balanced!.confidenceText).toBe("Medium — scoring methods disagree; we chose the better value.");
    });
  }

  it("Germany scores match the hand calculation", () => {
    const a = run({ priority: "Balanced" });
    // A: d+ = 0.1628, d- = 0.1203 → 0.1203 / 0.2831 = 0.425.
    expect(a.balanced!.topsis).toEqual({ A: "0.425", B: "0.694", C: "0.575" });
    expect(a.balanced!.minMax).toEqual({ A: "0.333", B: "0.639", C: "0.667" });
  });

  it("explains the marginal value of each price step from the numbers", () => {
    expect(run({ priority: "Balanced" }).balanced!.marginal).toEqual([
      "Carrier B costs £40 more per pallet than Carrier A but is 2 days faster and 3 points more reliable.",
      "Carrier C costs a further £120 per pallet (vs Carrier B) for 1 day faster and 3 points more reliable.",
    ]);
  });

  it("scores are computed among eligible carriers; a single eligible carrier wins and says so", () => {
    // 1,400 kg ÷ 2 = 700 kg per pallet → only B (750).
    const a = run({ priority: "Balanced", pallets: 2, grossKg: dec(1400) });
    expect(a.recommended).toBe("B");
    expect(a.balanced!.confidence).toBeNull();
    expect(a.reason).toBe("Carrier B is the only carrier that can take this load.");
  });
});

describe("weight eligibility", () => {
  it("1,800 kg / 4 pallets / Fastest → B, with the 5-pallet alternative for C", () => {
    const a = run({ priority: "Fastest", pallets: 4, grossKg: dec(1800) });
    expect(a.preferred).toBe("C");
    expect(a.recommended).toBe("B");
    const c = a.rows.find((r) => r.carrier.id === "C")!;
    expect(c.eligible).toBe(false);
    expect(c.excludedReason).toBe("1,800 kg ÷ 4 pallets = 450 kg per pallet, over Carrier C's 400 kg limit.");
    expect(a.alternative!.pallets).toBe(5);
    expect(a.alternative!.text).toBe("To use Carrier C, repack onto 5 pallets (360 kg each): 5 × £340 = £1,700 vs 4 × £220 = £880 with Carrier B — £820 more, 1 day sooner.");
  });

  it("800 kg per pallet → no carrier, minimum pallets shown", () => {
    const a = run({ pallets: 3, grossKg: dec(2400) });
    expect(a.noneEligible).toBe(true);
    expect(a.recommended).toBeNull();
    expect(a.minPalletsAny).toBe(4);
    expect(a.rows.map((r) => [r.carrier.id, r.minPallets])).toEqual([["A", 5], ["B", 4], ["C", 6]]);
  });

  it("an understated gross weight can't make a carrier look fine: net weight excludes it", () => {
    // Stated gross 1,000 kg (333 kg/pallet, all fit) but products weigh 1,350 kg (450 kg/pallet).
    const a = run({ priority: "Fastest", grossKg: dec(1000), netKg: dec(1350) });
    const c = a.rows.find((r) => r.carrier.id === "C")!;
    expect(c.eligibleOnGross).toBe(true);
    expect(c.eligible).toBe(false);
    expect(a.recommended).toBe("B");
    expect(a.evalBasis).toBe("net");
    expect(a.netWeightNote).toContain("so we checked each carrier's limit against 1,350 kg");
  });

  it("unknown net weight → gross only (A9)", () => {
    expect(run({ netKg: null }).evalBasis).toBe("gross_only");
  });

  it("missing pallets: per-pallet prices only, no total, no recommendation", () => {
    const a = run({ pallets: null });
    expect(a.rows.every((r) => r.totalCost === null && r.pricePerPallet !== null)).toBe(true);
    expect(a.preferred).toBe("A");
    expect(a.recommended).toBeNull();
  });

  it("missing priority → no recommendation (never defaults)", () => {
    expect(run({ priority: null }).recommended).toBeNull();
  });
});

describe("generic ranking and tie-breaks", () => {
  const mk = (id: "A" | "B" | "C", name: string, price: number, transit: number, onTime: number): CarrierRow => {
    const carrier: Carrier = { id, name, service: "x", pricePerPallet: { Germany: String(price), France: "0", Netherlands: "0" }, transitDays: transit, onTimePct: onTime, maxKgPerPallet: 1000 };
    return { carrier, pricePerPallet: dec(price), totalCost: dec(price), weightPerPallet: dec(1), eligible: true, eligibleOnGross: true, excludedReason: null, minPallets: 1 };
  };

  it("Cheapest ties on cost break on transit, then on-time, then name", () => {
    const rows = [mk("A", "Zed", 100, 4, 90), mk("B", "Alpha", 100, 3, 90), mk("C", "Beta", 100, 3, 95)];
    expect(rankCarriers(rows, "Cheapest").map((r) => r.carrier.name)).toEqual(["Beta", "Alpha", "Zed"]);
  });

  it("Fastest ties on transit break on on-time, then cost", () => {
    const rows = [mk("A", "A", 100, 2, 95), mk("B", "B", 90, 2, 95), mk("C", "C", 80, 2, 90)];
    expect(rankCarriers(rows, "Fastest").map((r) => r.carrier.id)).toEqual(["B", "A", "C"]);
  });

  it("Most reliable ties on on-time break on cost, then transit", () => {
    const rows = [mk("A", "A", 100, 2, 95), mk("B", "B", 100, 1, 95), mk("C", "C", 90, 5, 95)];
    expect(rankCarriers(rows, "Most reliable").map((r) => r.carrier.id)).toEqual(["C", "B", "A"]);
  });

  it("Balanced with identical carriers ties on score, then cost, then name", () => {
    const rows = [mk("A", "Bravo", 100, 2, 95), mk("B", "Alpha", 100, 2, 95)];
    expect(rankCarriers(rows, "Balanced").map((r) => r.carrier.name)).toEqual(["Alpha", "Bravo"]);
  });
});
