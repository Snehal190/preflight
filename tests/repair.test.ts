import { describe, expect, it } from "vitest";
import { applyPatches, suggestFixes, withFixes } from "@/lib/repair";
import { typoPattern } from "@/lib/repair/typo";
import { runChecks, type CheckContext } from "@/lib/rules";
import type { Booking } from "@/lib/types";
import { bk001, fv, item, TODAY } from "./fixtures/bookings";

const ctx: CheckContext = { today: TODAY };

function problems(b: Booking): Set<string> {
  return new Set(
    runChecks(b, ctx)
      .results.filter((r) => r.severity !== "info" && !r.nonBlocking && (r.status === "fail" || r.status === "missing_data" || r.status === "needs_answer"))
      .map((r) => r.id),
  );
}

describe("typo patterns", () => {
  it.each([
    ["1800", "1080", "Looks like two digits were swapped."],
    ["900", "90", "Looks like an extra zero was typed."],
    ["9", "90", "Looks like a zero was left out."],
    ["5.00", "50.0", "Looks like the decimal point moved."],
    ["1081", "1080", "Looks like one digit was mistyped."],
    ["10800", "1080", "Looks like an extra zero was typed."],
    ["10870", "1080", "Looks like an extra digit was typed."],
    ["108", "1080", "Looks like a zero was left out."],
    ["1050", "1080", "Looks like one digit was mistyped."],
    ["100", "90", null],
  ])("%s → %s: %s", (from, to, expected) => {
    expect(typoPattern(from, to)).toBe(expected);
  });
});

describe("quantity 1,800 vs 12 × 90 (spec §19)", () => {
  // Gross 1,000 kg so the higher quantity doesn't also trip R-07.
  const b = bk001({ grossWeightKg: fv("1000"), items: [item({ quantity: fv(1800) })] });
  const outcome = suggestFixes(b, ctx);

  it("suggests 1,080, names the digit swap, and is tested to clear R-02 and R-03", () => {
    const top = outcome.byResult["R-03:item:it-1"][0];
    expect(top.patches).toEqual([{ target: "item", itemId: "it-1", sku: "MUG-01", field: "quantity", from: "1800", to: "1080" }]);
    expect(top.typo).toBe("Looks like two digits were swapped.");
    expect(top.clears).toEqual(["R-02", "R-03"]);
    expect(top.badge).toBe("Tested: clears R-02 and R-03, no new issues.");
    expect(top.evidence).toBe("R-02 also passes exactly if MUG-01 quantity = 1,080, so 1,080 is very likely correct.");
    expect(top.summary).toBe("Change MUG-01 quantity from 1,800 to 1,080");
  });

  it("ranks the quantity fix first for R-02 too, above changing the declared value", () => {
    const r02 = outcome.byResult["R-02:booking"];
    expect(r02[0].patches[0].field).toBe("quantity");
    expect(r02.some((f) => f.patches.length === 1 && f.patches[0].field === "declaredValue")).toBe(true);
    expect(r02.length).toBeLessThanOrEqual(3);
  });

  it("applying it clears everything and marks the field as fixed", () => {
    const fixed = applyPatches(b, outcome.byResult["R-03:item:it-1"][0].patches);
    expect(fixed.items[0].quantity).toMatchObject({ value: 1080, source: "fixed" });
    expect(runChecks(fixed, ctx).status).toBe("ready");
    expect(b.items[0].quantity.value).toBe(1800); // original untouched
  });
});

describe("other repairs", () => {
  it("an extra zero on item cartons clears R-03 and R-04 in one edit", () => {
    const b = bk001({ items: [item({ cartons: fv(900) })] });
    const top = suggestFixes(b, ctx).byResult["R-04:booking"][0];
    expect(top.patches).toMatchObject([{ field: "cartons", target: "item", to: "90" }]);
    expect(top.typo).toBe("Looks like an extra zero was typed.");
    expect(top.clears).toEqual(["R-03", "R-04"]);
  });

  it("booking cartons stated wrong → change the total", () => {
    const b = bk001({ cartons: fv(100) });
    const top = suggestFixes(b, ctx).byResult["R-04:booking"][0];
    expect(top.summary).toBe("Change booking cartons from 100 to 90");
    expect(top.typo).toBeNull();
  });

  it("no carrier fits → repack onto the minimum pallet count", () => {
    const b = bk001({ grossWeightKg: fv("2400") });
    const top = suggestFixes(b, ctx).byResult["R-05:booking"][0];
    expect(top.summary).toBe("Change pallets from 3 to 4");
    // 2,400 ÷ 4 = 600 kg fits B but not A (the 'Cheapest' pick); the fix says so rather than hiding it.
    expect(top.evidence).toContain("Note: Red for Carrier A (your 'Cheapest' choice)");
  });

  it("duplicate-ID bookings never get an Apply", () => {
    const b = bk001({ integrity: { duplicateIdRows: [3, 5] }, cartons: fv(100) });
    const outcome = suggestFixes(b, ctx);
    expect(outcome.blockedReason).not.toBeNull();
    const r04 = withFixes(runChecks(b, ctx), outcome, b).find((r) => r.id === "R-04:booking")!;
    expect(r04.fix.tested).toBeUndefined();
    expect(r04.fix.noApplyReason).toContain("shares its ID");
  });

  it("says honestly when no tested fix exists", () => {
    const b = bk001({ cartons: fv(100) });
    const results = withFixes(runChecks(b, ctx), { byResult: {}, blockedReason: null }, b);
    expect(results.find((r) => r.id === "R-04:booking")!.fix.noApplyReason).toBe("We can't tell which number is wrong — please check the booking's cartons and each item's cartons.");
  });

  it("never offers Apply for HS codes, R-06, R-07, R-08, R-09 or R-10", () => {
    const b = bk001({
      grossWeightKg: fv("500"),
      appointmentBooked: fv("No" as const),
      readyDate: fv("2026-01-01"),
      items: [item({ hsCode: fv<string>(null, null), description: fv("Hairspray"), countryOfOrigin: fv<never>(null, null) })],
    });
    const report = runChecks(b, ctx);
    const results = withFixes(report, suggestFixes(b, ctx, report), b);
    for (const r of results.filter((x) => ["R-01", "R-06", "R-07", "R-08", "R-09", "R-10"].includes(x.ruleId))) {
      expect(r.fix.tested).toBeUndefined();
    }
  });
});

describe("no suggestion ever introduces a new failure", () => {
  // Deterministic pseudo-random bookings with numeric mistakes planted.
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

  for (let n = 0; n < 40; n++) {
    const upc = pick([6, 10, 12, 24]);
    const cartons = pick([10, 45, 90, 120]);
    const qty = upc * cartons;
    const mistakes = {
      quantity: pick([qty, qty * 10, qty + 1, Number(String(qty).split("").reverse().join("")) || qty]),
      cartons: pick([cartons, cartons * 10, cartons + 1]),
      bookingCartons: pick([cartons, cartons + 5, cartons * 10]),
      declared: pick([String(qty * 5), String(qty * 50), String(qty * 5 + 7)]),
      gross: pick(["620", "2000", "5000", "100"]),
      pallets: pick([1, 3, 8]),
    };
    it(`case ${n}`, () => {
      const b = bk001({
        cartons: fv(mistakes.bookingCartons),
        declaredValue: fv(mistakes.declared),
        grossWeightKg: fv(mistakes.gross),
        pallets: fv(mistakes.pallets),
        items: [item({ quantity: fv(mistakes.quantity), unitsPerCarton: fv(upc), cartons: fv(mistakes.cartons), unitWeightKg: fv("0.2") })],
      });
      const before = problems(b);
      const outcome = suggestFixes(b, ctx);
      for (const fixes of Object.values(outcome.byResult)) {
        for (const f of fixes) {
          const after = problems(applyPatches(b, f.patches));
          for (const id of after) expect(before.has(id), `${f.summary} created ${id}`).toBe(true);
          expect(after.size).toBeLessThan(before.size);
        }
      }
    });
  }
});
