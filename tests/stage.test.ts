import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/rules";
import { checkSequence, fieldFlags, isPacked } from "@/lib/stage/sequence";
import { PRESETS, presetBooking } from "@/lib/stage/presets";

const TODAY = "2026-10-26";
const ctx = { today: TODAY };

describe("one-screen check stage", () => {
  it("BK-012 packs all 10 checks", () => {
    const steps = checkSequence(runChecks(presetBooking("BK-012", TODAY), ctx).results);
    expect(steps).toHaveLength(10);
    expect(steps.every((s) => isPacked(s.state))).toBe(true);
    expect(steps.map((s) => s.name)[0]).toBe("Customs (HS) code");
  });

  it("each preset shows its planted problem", () => {
    const states = (id: string) => Object.fromEntries(checkSequence(runChecks(presetBooking(id, TODAY), ctx).results).map((s) => [s.ruleId, s.state]));
    expect(states("BK-102")).toMatchObject({ "R-02": "fail", "R-03": "fail" });
    expect(states("BK-105")).toMatchObject({ "R-06": "fail" });
    expect(states("BK-104")["R-05"]).toBe("pass"); // B fits; the express note doesn't block
    expect(states("BK-107")).toMatchObject({ "R-04": "fail", "R-08": "amber", "R-10": "amber" });
  });

  it("colours the booking fields behind each problem", () => {
    const flags = fieldFlags(runChecks(presetBooking("BK-107", TODAY), ctx).results);
    expect(flags).toMatchObject({ cartons: "bad", readyDate: "warn", appointmentBooked: "warn" });
  });

  it("every preset builds and keeps future dates (except the deliberate past one)", () => {
    for (const p of PRESETS) {
      const b = presetBooking(p.id, TODAY);
      expect(b.readyDate.value! >= TODAY).toBe(p.id !== "BK-107");
    }
  });
});

describe("why this carrier", () => {
  it("explains the pick and every trade-off from the numbers", async () => {
    const { carrierStory } = await import("@/lib/stage/carrierStory");
    const { evaluateBooking } = await import("@/lib/booking/evaluate");
    const { emptyState } = await import("@/lib/booking/state");
    const e = await evaluateBooking(presetBooking("BK-012", TODAY), emptyState(), TODAY, async () => null);
    const story = carrierStory(e.carrier, e.dates);
    expect(story[0]).toBe("You asked for cheapest, so we rank the carriers that can take this load by the lowest total cost, then the shortest transit.");
    expect(story[1]).toMatch(/^Carrier A \(Road economy\) costs £540, takes 5 working days and arrives on time 92% of the time, estimated delivery /);
    expect(story).toContain("Carrier B would cost £120 more (£660), arrive 2 days sooner and be 3 points more reliable.");
    expect(story).toContain("Carrier C would cost £480 more (£1,020), arrive 3 days sooner and be 6 points more reliable.");
  });

  it("says why a carrier was ruled out", async () => {
    const { carrierStory } = await import("@/lib/stage/carrierStory");
    const { evaluateBooking } = await import("@/lib/booking/evaluate");
    const { emptyState } = await import("@/lib/booking/state");
    const e = await evaluateBooking(presetBooking("BK-104", TODAY), emptyState(), TODAY, async () => null);
    expect(carrierStory(e.carrier, e.dates).at(-1)).toBe("Carrier C can't take this load: 1,800 kg ÷ 4 pallets = 450 kg per pallet, over Carrier C's 400 kg limit.");
  });
});

describe("deep analysis rows", () => {
  it("carry the fix for a problem and nothing for a pass", async () => {
    const { suggestFixes, withFixes } = await import("@/lib/repair");
    const b = presetBooking("BK-102", TODAY);
    const report = runChecks(b, ctx);
    const steps = checkSequence(withFixes(report, suggestFixes(b, ctx, report), b));
    const units = steps.find((s) => s.ruleId === "R-03")!;
    expect(units.state).toBe("fail");
    expect(units.fix).toContain("1,080");
    expect(units.problems).toBe(1);
    expect(steps.find((s) => s.ruleId === "R-01")!.fix).toBeNull();
  });
});
