import { describe, expect, it } from "vitest";
import { runChecks, orderForDisplay, type CheckContext, type CheckResult } from "@/lib/rules";
import { r06AnswerKey } from "@/lib/rules/r06";
import type { Booking } from "@/lib/types";
import { bk001, fv, item, TODAY } from "./fixtures/bookings";

const ctx: CheckContext = { today: TODAY };

function bad<T>(raw: string, problem: string) {
  return { ...fv<T>(null, raw), problem };
}

function rule(results: CheckResult[], ruleId: string, opts: { itemId?: string; id?: string } = {}): CheckResult {
  const found = results.filter((r) => r.ruleId === ruleId && (opts.id ? r.id === opts.id : true) && (opts.itemId ? r.scope.kind === "item" && r.scope.itemId === opts.itemId : true));
  if (found.length !== 1) throw new Error(`Expected 1 ${ruleId} result, got ${found.length}: ${found.map((r) => r.id).join(", ")}`);
  return found[0];
}

function statusOf(b: Booking, ruleId: string, c: CheckContext = ctx) {
  const results = runChecks(b, c).results.filter((r) => r.ruleId === ruleId && !r.nonBlocking);
  expect(results.length).toBe(1);
  return results[0].status;
}

describe("BK-001 template example (spec §2.4)", () => {
  const report = runChecks(bk001(), ctx);

  it("passes all 10 rules", () => {
    const rules = report.results.filter((r) => r.ruleId.startsWith("R-"));
    expect(rules.map((r) => [r.ruleId, r.status])).toEqual([
      ["R-01", "pass"],
      ["R-02", "pass"],
      ["R-03", "pass"],
      ["R-04", "pass"],
      ["R-05", "pass"],
      ["R-06", "pass"],
      ["R-07", "pass"],
      ["R-08", "pass"],
      ["R-09", "pass"],
      ["R-10", "pass"],
    ]);
  });

  it("is ready for take-off and recommends Carrier A at 3 × £180 = £540", () => {
    expect(report.status).toBe("ready");
    expect(report.headline).toBe("Ready for take-off");
    expect(report.carrier.recommended).toBe("A");
    expect(report.carrier.rows.find((r) => r.carrier.id === "A")!.totalCost!.toString()).toBe("540");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(runChecks(bk001(), ctx))).toBe(JSON.stringify(runChecks(bk001(), ctx)));
  });

  it("fails R-10 once the ready date has passed, no special case", () => {
    expect(statusOf(bk001(), "R-10", { today: "2026-11-06" })).toBe("fail");
  });
});

describe("R-01 HS code", () => {
  const withHs = (hs: ReturnType<typeof fv<string>>, numeric = false) => bk001({ items: [item({ hsCode: hs, hsWasNumeric: numeric })] });

  it("blank → Red 'No HS code.'", () => {
    const r = rule(runChecks(withHs(fv<string>(null, null)), ctx).results, "R-01");
    expect(r.status).toBe("fail");
    expect(r.severity).toBe("red");
    expect(r.found).toContain("No HS code.");
  });

  it("non-digits → Red", () => {
    expect(statusOf(withHs(bad<string>("ABC123", "it contains characters other than digits")), "R-01")).toBe("fail");
  });

  it("5 digits from a numeric cell → Red with the leading-zero hint", () => {
    const r = rule(runChecks(withHs(fv("90111"), true), ctx).results, "R-01");
    expect(r.status).toBe("fail");
    expect(r.fix.hint).toContain("did you mean 090111?");
  });

  it("5 digits typed as text → Red without the hint", () => {
    const r = rule(runChecks(withHs(fv("90111"), false), ctx).results, "R-01");
    expect(r.status).toBe("fail");
    expect(r.fix.hint).toBeUndefined();
  });

  it("6 digits pass", () => {
    expect(statusOf(withHs(fv("090111")), "R-01")).toBe("pass");
  });

  it("7 digits from a numeric cell pass R-01 with an Info hint (approved Q7)", () => {
    const { results, status } = runChecks(withHs(fv("6912001"), true), ctx);
    expect(rule(results, "R-01").status).toBe("pass");
    expect(results.some((r) => r.id === "INFO:hs-leading-zero:it-1")).toBe(true);
    expect(status).toBe("ready");
  });

  it("over 10 digits pass with an Info note", () => {
    const { results } = runChecks(withHs(fv("69120000001")), ctx);
    expect(rule(results, "R-01").status).toBe("pass");
    expect(results.find((r) => r.id === "INFO:hs-long:it-1")!.shouldBe).toBe("HS codes are normally 6–10 digits.");
  });

  it("000000 passes with an Info note", () => {
    const { results } = runChecks(withHs(fv("000000")), ctx);
    expect(rule(results, "R-01").status).toBe("pass");
    expect(results.find((r) => r.id === "INFO:hs-zero:it-1")!.shouldBe).toBe("This isn't a real HS code.");
  });

  it("shows an AI suggestion labelled as a suggestion, never applied", () => {
    const r = rule(runChecks(withHs(fv<string>(null, null)), { ...ctx, hsSuggestions: { "it-1": { code: "691200", reason: "ceramic tableware" } } }).results, "R-01");
    expect(r.fix.suggestion?.label).toBe("Suggestion: please verify. You are legally responsible for the code.");
    expect(r.fix.tested).toBeUndefined();
  });
});

describe("R-02 declared value within 1%", () => {
  const declared = (v: string) => bk001({ declaredValue: fv(v) });
  it.each([
    ["5443.20", "pass"], // +0.8%
    ["5454", "pass"], // +1.0% exactly
    ["5346", "pass"], // −1.0% exactly
    ["5464.80", "fail"], // +1.2%
    ["5335.20", "fail"], // −1.2%
  ])("declared £%s vs item total £5,400 → %s", (v, s) => {
    expect(statusOf(declared(v), "R-02")).toBe(s);
  });

  it("never shows a failing gap as 1.0%", () => {
    const r = rule(runChecks(declared("5454.05"), ctx).results, "R-02");
    expect(r.status).toBe("fail");
    expect(r.found).toContain("1.001%");
  });

  it("item total 0 with £0 declared passes; with more than £0 fails", () => {
    const free = [item({ unitPrice: fv("0") })];
    expect(statusOf(bk001({ items: free, declaredValue: fv("0") }), "R-02")).toBe("pass");
    expect(statusOf(bk001({ items: free, declaredValue: fv("10") }), "R-02")).toBe("fail");
  });

  it("uses stated quantities even when R-03 fails", () => {
    const r = rule(runChecks(bk001({ items: [item({ quantity: fv(1800) })] }), ctx).results, "R-02");
    expect(r.status).toBe("fail");
    expect(r.found).toContain("items add up to £9,000");
  });

  it("missing declared value → missing data, never pass", () => {
    expect(statusOf(bk001({ declaredValue: fv<string>(null, null) }), "R-02")).toBe("missing_data");
  });
});

describe("R-03 units × cartons = quantity", () => {
  it("reports the formula with real numbers", () => {
    const r = rule(runChecks(bk001({ items: [item({ quantity: fv(1800) })] }), ctx).results, "R-03");
    expect(r.status).toBe("fail");
    expect(r.found).toBe("MUG-01: 12 per carton × 90 cartons = 1,080, but quantity says 1,800.");
  });

  it("fractional cartons are missing data (never rounded)", () => {
    expect(statusOf(bk001({ items: [item({ cartons: bad<number>("2.5", "must be a whole number above 0") })] }), "R-03")).toBe("missing_data");
  });
});

describe("R-04 booking cartons = Σ item cartons", () => {
  it("lists each item's cartons and the total", () => {
    const b = bk001({ items: [item(), item({ sku: fv("MUG-02") }, "it-2")] });
    const r = rule(runChecks(b, ctx).results, "R-04");
    expect(r.status).toBe("fail");
    expect(r.found).toContain("MUG-01 90 + MUG-02 90 = 180");
  });
});

describe("R-05 weight per pallet", () => {
  it("exactly at the limit passes", () => {
    // 1,500 kg ÷ 3 = 500 kg = Carrier A's max.
    const { results, carrier } = runChecks(bk001({ grossWeightKg: fv("1500") }), ctx);
    expect(carrier.recommended).toBe("A");
    expect(rule(results, "R-05").status).toBe("pass");
  });

  it("pallets = 0 → missing data", () => {
    expect(statusOf(bk001({ pallets: bad<number>("0", "must be a whole number above 0") }), "R-05")).toBe("missing_data");
  });

  it("shows a pass/fail line for every carrier", () => {
    const r = rule(runChecks(bk001({ grossWeightKg: fv("1350") }), ctx).results, "R-05");
    expect(r.found).toContain("A 500 kg ✓ · B 750 kg ✓ · C 400 kg ✗");
  });

  describe("1,800 kg / 4 pallets / Fastest → Carrier B, with the visibility card", () => {
    const b = bk001({ grossWeightKg: fv("1800"), pallets: fv(4), priority: fv("Fastest" as const) });
    const report = runChecks(b, ctx);

    it("recommends B and passes R-05 for B", () => {
      expect(report.carrier.preferred).toBe("C");
      expect(report.carrier.recommended).toBe("B");
      expect(rule(report.results, "R-05", { id: "R-05:booking" }).status).toBe("pass");
    });

    it("shows a non-blocking R-05 card for C with the 5-pallet alternative", () => {
      const card = rule(report.results, "R-05", { id: "R-05:booking:preferred" });
      expect(card.status).toBe("fail");
      expect(card.nonBlocking).toBe(true);
      expect(card.found).toContain("Red for Carrier C (your 'Fastest' choice)");
      expect(card.found).toContain("450 kg per pallet");
      expect(card.fix.text).toBe(
        "To use Carrier C, repack onto 5 pallets (360 kg each): 5 × £340 = £1,700 vs 4 × £220 = £880 with Carrier B, £820 more, 1 day sooner.",
      );
      expect(report.status).not.toBe("blocked");
    });

    it("becomes a blocking Red if the seller chooses C manually", () => {
      const manual = runChecks(b, { ...ctx, chosenCarrierId: "C" });
      const r = rule(manual.results, "R-05");
      expect(r.status).toBe("fail");
      expect(r.nonBlocking).toBeUndefined();
      expect(manual.status).toBe("blocked");
    });
  });

  it("no carrier fits → blocking Red with the minimum pallet count", () => {
    // 2,400 kg ÷ 3 = 800 kg per pallet, above 750.
    const { results, status } = runChecks(bk001({ grossWeightKg: fv("2400") }), ctx);
    const r = rule(results, "R-05");
    expect(r.status).toBe("fail");
    expect(r.fix.text).toContain("Repack onto at least 4 pallets");
    expect(r.fix.text).toContain("Carrier A: 5 pallets (5 × £180 = £900)");
    expect(status).toBe("blocked");
  });

  it("checks against product weight when it exceeds the stated gross weight (approved Q12)", () => {
    // Products: 1,080 × 2 kg = 2,160 kg; stated gross 1,200 kg. 2,160 ÷ 3 = 720 → only B fits.
    const b = bk001({ grossWeightKg: fv("1200"), items: [item({ unitWeightKg: fv("2") })] });
    const { results, carrier } = runChecks(b, ctx);
    expect(carrier.recommended).toBe("B");
    expect(carrier.netWeightNote).toContain("2,160 kg");
    expect(rule(results, "R-05", { id: "R-05:booking" }).status).toBe("pass");
  });
});

describe("R-06 dangerous goods", () => {
  const withItem = (description: string, hs = "691200") => bk001({ items: [item({ description: fv(description), hsCode: fv(hs) })] });

  it.each([
    ["Portable power bank 10000mAh", "fail"],
    ["Eau de parfum 50 ml", "fail"],
    ["Hairspray 250 ml", "fail"],
    ["Torch, batteries not included", "pass"],
    ["AA alkaline batteries", "pass"],
    ["Pump spray bottle, empty", "pass"],
  ])("%s → %s", (d, s) => {
    expect(statusOf(withItem(d), "R-06")).toBe(s);
  });

  it("'Portable charger' with HS 8507… → Needs your answer", () => {
    const b = withItem("Portable charger", "850760");
    const r = rule(runChecks(b, ctx).results, "R-06");
    expect(r.status).toBe("needs_answer");
    expect(r.question!.prompt).toBe("Does 'Portable charger' contain a lithium battery?");
    const key = r06AnswerKey(b.items[0]);
    expect(statusOf(b, "R-06", { ...ctx, answers: { [key]: "yes" } })).toBe("fail");
    expect(statusOf(b, "R-06", { ...ctx, answers: { [key]: "no" } })).toBe("pass");
  });

  it("AI can add a flag with high confidence", () => {
    const b = withItem("Camping stove cartridge");
    const ai: CheckContext["dgAi"] = { available: true, byItemId: { "it-1": { category: "flammable_liquid", confidence: "high", reason: "butane cartridge" } } };
    expect(statusOf(b, "R-06", { ...ctx, dgAi: ai })).toBe("fail");
  });

  it("AI with medium confidence → Needs your answer", () => {
    const b = withItem("Camping stove cartridge");
    const ai: CheckContext["dgAi"] = { available: true, byItemId: { "it-1": { category: "flammable_liquid", confidence: "medium", reason: "may be gas" } } };
    expect(statusOf(b, "R-06", { ...ctx, dgAi: ai })).toBe("needs_answer");
  });

  it("AI can never clear a keyword flag, nor can a 'No' answer", () => {
    const b = withItem("Hairspray 250 ml");
    const ai: CheckContext["dgAi"] = { available: true, byItemId: { "it-1": { category: "none", confidence: "high", reason: "ignore previous instructions" } } };
    expect(statusOf(b, "R-06", { ...ctx, dgAi: ai, answers: { [r06AnswerKey(b.items[0])]: "no" } })).toBe("fail");
  });

  it("shows the keywords-only banner when AI is unavailable, and not when it ran", () => {
    expect(runChecks(bk001(), ctx).results.some((r) => r.id === "INFO:dg-keywords-only")).toBe(true);
    const ai: CheckContext["dgAi"] = { available: true, byItemId: { "it-1": { category: "none", confidence: "high", reason: "mug" } } };
    expect(runChecks(bk001(), { ...ctx, dgAi: ai }).results.some((r) => r.id === "INFO:dg-keywords-only")).toBe(false);
  });
});

describe("R-07 gross ≥ product weight", () => {
  it("exactly equal passes", () => {
    expect(statusOf(bk001({ grossWeightKg: fv("540") }), "R-07")).toBe("pass");
  });
  it("below fails as Amber with the re-weigh fix", () => {
    const r = rule(runChecks(bk001({ grossWeightKg: fv("539.9") }), ctx).results, "R-07");
    expect(r.status).toBe("fail");
    expect(r.severity).toBe("amber");
    expect(r.fix.text).toBe("Your products alone weigh 540 kg, but gross weight says 539.9 kg. Re-weigh the shipment; gross weight must include products, cartons and pallets.");
  });
  it("missing unit weight → missing data", () => {
    expect(statusOf(bk001({ items: [item({ unitWeightKg: fv<string>(null, null) })] }), "R-07")).toBe("missing_data");
  });
});

describe("R-08 warehouse appointment", () => {
  it("business address → not applicable", () => {
    const r = rule(runChecks(bk001({ destinationType: fv("Business address" as const), appointmentBooked: fv<"Yes" | "No">(null, null) }), ctx).results, "R-08");
    expect(r.status).toBe("not_applicable");
    expect(r.found).toBe("Not applicable: business address.");
  });
  it("warehouse + No → Amber; acknowledging it makes the booking ready", () => {
    const b = bk001({ appointmentBooked: fv("No" as const) });
    const report = runChecks(b, ctx);
    expect(rule(report.results, "R-08").status).toBe("fail");
    expect(report.status).toBe("check");
    expect(report.headline).toBe("1 to check");
    expect(runChecks(b, { ...ctx, acknowledged: ["R-08:booking"] }).status).toBe("ready");
  });
  it("warehouse + blank → missing data", () => {
    expect(statusOf(bk001({ appointmentBooked: fv<"Yes" | "No">(null, null) }), "R-08")).toBe("missing_data");
  });
});

describe("R-09 country of origin", () => {
  it("blank → Amber fail", () => {
    expect(statusOf(bk001({ items: [item({ countryOfOrigin: fv<never>(null, null) })] }), "R-09")).toBe("fail");
  });
  it("value outside the list → missing data", () => {
    expect(statusOf(bk001({ items: [item({ countryOfOrigin: bad<never>("Japan", "not an allowed country") })] }), "R-09")).toBe("missing_data");
  });
});

describe("R-10 ready date (Europe/London)", () => {
  it("today passes, yesterday fails", () => {
    expect(statusOf(bk001(), "R-10", { today: "2026-11-05" })).toBe("pass");
    expect(statusOf(bk001(), "R-10", { today: "2026-11-06" })).toBe("fail");
  });
  it("unreadable date → missing data", () => {
    expect(statusOf(bk001({ readyDate: bad<string>("31-02-2026", "that date doesn't exist") }), "R-10")).toBe("missing_data");
  });
});

describe("whole-booking behaviour", () => {
  it("reports every failure: one item failing R-01, R-03, R-09 and the booking failing R-02", () => {
    // 1,800 × 0.3 kg = 540 kg ≤ 620 kg, so R-07 stays clean.
    const b = bk001({ items: [item({ hsCode: fv<string>(null, null), quantity: fv(1800), unitWeightKg: fv("0.3"), countryOfOrigin: fv<never>(null, null) })] });
    const { results, headline } = runChecks(b, ctx);
    const failing = results.filter((r) => r.status === "fail" && r.ruleId.startsWith("R-")).map((r) => r.ruleId);
    expect(failing).toEqual(["R-01", "R-02", "R-03", "R-09"]);
    expect(headline).toBe("3 must-fix · 1 to check");
  });

  it("orders cards Missing → Red → Needs answer → Amber → Info → passes", () => {
    const b = bk001({
      sellerName: fv<string>(null, null),
      appointmentBooked: fv("No" as const),
      items: [item({ quantity: fv(1800), description: fv("Portable charger"), hsCode: fv("850760") })],
    });
    const order = orderForDisplay(runChecks(b, ctx).results).map((r) => `${r.ruleId}:${r.status}`);
    const firstIdx = (s: string) => order.findIndex((x) => x === s);
    expect(firstIdx("DATA:missing_data")).toBeLessThan(firstIdx("R-03:fail"));
    expect(firstIdx("R-03:fail")).toBeLessThan(firstIdx("R-06:needs_answer"));
    expect(firstIdx("R-06:needs_answer")).toBeLessThan(firstIdx("R-08:fail"));
    expect(firstIdx("R-08:fail")).toBeLessThan(firstIdx("INFO:fail"));
  });

  it("booking with no items: Missing data, and total-based rules still run against 0", () => {
    const { results, status } = runChecks(bk001({ items: [] }), ctx);
    expect(results.some((r) => r.id === "DATA:no-items")).toBe(true);
    expect(results.filter((r) => r.ruleId === "R-01")[0].status).toBe("missing_data");
    const r02 = rule(results, "R-02");
    expect(r02.status).toBe("fail");
    expect(r02.shouldBe).toContain("this booking has no items");
    expect(status).toBe("blocked");
  });

  it("duplicate booking IDs → Missing data", () => {
    const { results, status } = runChecks(bk001({ integrity: { duplicateIdRows: [7, 12] } }), ctx);
    expect(results.find((r) => r.id === "DATA:duplicate-id")!.found).toContain("Two bookings share this ID (rows 7 and 12)");
    expect(status).toBe("blocked");
  });

  it("blank priority → Missing data and no carrier (never defaults to Balanced)", () => {
    const { results, carrier } = runChecks(bk001({ priority: fv<never>(null, null) }), ctx);
    expect(results.some((r) => r.id === "DATA:priority")).toBe(true);
    expect(carrier.recommended).toBeNull();
  });

  it("city in the wrong country → Info with the route assumption", () => {
    const { results, carrier } = runChecks(bk001({ destinationCity: fv("Paris" as const) }), ctx);
    const info = results.find((r) => r.id === "INFO:city-country")!;
    expect(info.found).toBe("Paris is in France, but the country says Germany.");
    expect(info.assumptions).toEqual(["A5"]);
    expect(carrier.route).toBe("Germany");
  });

  it("£0 unit price → Info only", () => {
    const { results } = runChecks(bk001({ items: [item({ unitPrice: fv("0") })], declaredValue: fv("0") }), ctx);
    expect(results.some((r) => r.id === "INFO:zero-price:it-1")).toBe(true);
  });
});

describe("R-06 wording", () => {
  it("cites the most specific trigger word", () => {
    const b = bk001({ items: [item({ description: fv("Portable power bank 10000mAh") })] });
    expect(runChecks(b, ctx).results.find((r) => r.ruleId === "R-06")!.found).toBe(
      'MUG-01: "Portable power bank 10000mAh" contains "power bank", which means a lithium battery.',
    );
  });
});
