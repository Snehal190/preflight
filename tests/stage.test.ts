import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/rules";
import { checkSequence, fieldFlags, isPacked } from "@/lib/stage/sequence";
import { PRESETS, presetBooking } from "@/lib/stage/presets";
import { fixAll } from "@/lib/stage/fixAll";

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

  it("'Fix all' applies only tested numeric fixes", () => {
    const { booking, applied } = fixAll(presetBooking("BK-102", TODAY), ctx);
    expect(applied).toEqual(["Change MUG-01 quantity from 1,800 to 1,080"]);
    expect(runChecks(booking, ctx).status).toBe("ready");
    const dg = fixAll(presetBooking("BK-105", TODAY), ctx);
    expect(dg.applied).toEqual([]); // dangerous goods need the seller's own action
  });

  it("every preset builds and keeps future dates (except the deliberate past one)", () => {
    for (const p of PRESETS) {
      const b = presetBooking(p.id, TODAY);
      expect(b.readyDate.value! >= TODAY).toBe(p.id !== "BK-107");
    }
  });
});
