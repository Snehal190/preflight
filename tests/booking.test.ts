import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateBooking } from "@/lib/booking/evaluate";
import { emptyState, type Evaluation } from "@/lib/booking/state";
import { editBookingField, editItemField } from "@/lib/booking/edit";
import { changeChips } from "@/lib/booking/changes";
import { takeoffSummary, whatHappensNext } from "@/lib/booking/takeoff";
import { compareWorstFirst } from "@/lib/booking/sort";
import { applyPatches } from "@/lib/repair";
import { NagerResponseSchema, type HolidayFetcher } from "@/lib/dates/holidays";
import { bk001, fv, item, TODAY } from "./fixtures/bookings";

const holidays: HolidayFetcher = async (year, cc) =>
  NagerResponseSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/holidays/${year}-${cc}.json`, import.meta.url)), "utf8")));
const evaluate = (b = bk001(), s = emptyState()) => evaluateBooking(b, s, TODAY, holidays);

describe("full evaluation", () => {
  it("BK-001: ready, Carrier A £540, collection Thu 05 Nov, delivery Thu 12 Nov", async () => {
    const e = await evaluate();
    expect(e.status).toBe("ready");
    expect(e.carrier.chosen).toBe("A");
    expect(e.carrier.rows[0].totalCost).toBe("540");
    expect(e.dates).toMatchObject({ collection: "2026-11-05", delivery: "2026-11-12", carrierId: "A" });
    expect(JSON.parse(JSON.stringify(e))).toEqual(e); // serializable for the browser
  });

  it("R-08's fix names the estimated delivery date", async () => {
    const e = await evaluate(bk001({ appointmentBooked: fv("No" as const) }));
    expect(e.results.find((r) => r.ruleId === "R-08")!.fix.text).toBe(
      "Book a delivery slot with the receiving warehouse for around Thu 12 Nov 2026, then mark appointment = Yes.",
    );
  });

  it("a manual carrier choice changes the dates and re-checks R-05", async () => {
    const e = await evaluate(bk001(), { ...emptyState(), chosenCarrierId: "C" });
    expect(e.carrier.chosen).toBe("C");
    expect(e.carrier.chosenIsManual).toBe(true);
    expect(e.dates?.delivery).toBe("2026-11-09"); // Thu 05 + 2 working days
    expect(e.results.find((r) => r.id === "R-05:booking")!.status).toBe("pass"); // 206.7 kg ≤ 400
  });

  it("orders cards and attaches tested fixes", async () => {
    const e = await evaluate(bk001({ grossWeightKg: fv("1000"), items: [item({ quantity: fv(1800) })] }));
    expect(e.results[0].status).toBe("fail");
    expect(e.results.find((r) => r.id === "R-03:item:it-1")!.fix.tested![0].summary).toBe("Change MUG-01 quantity from 1,800 to 1,080");
  });
});

describe("seller edits", () => {
  it("go through the same parsers and become 'stated'", () => {
    const b = editBookingField(bk001(), "pallets", "4");
    expect(b.pallets).toMatchObject({ value: 4, source: "stated", raw: "4" });
    const bad = editBookingField(bk001(), "pallets", "2.5");
    expect(bad.pallets.value).toBeNull();
    expect(bad.pallets.problem).toContain("whole number above 0");
    expect(editBookingField(bk001(), "readyDate", "6/11/2026").readyDate.value).toBe("2026-11-06");
    expect(editItemField(bk001(), "it-1", "hsCode", "0901.11").items[0].hsCode.value).toBe("090111");
  });
});

describe("change chips (spec §12.8)", () => {
  it("adding a pallet: field, cost and carrier chips", async () => {
    const before = bk001();
    const after = editBookingField(before, "pallets", "4");
    const chips = changeChips(before, await evaluate(before), after, await evaluate(after));
    expect(chips).toEqual(["Pallets 3 → 4", "Cost £540 → £720", "Carrier unchanged"]);
  });

  it("applying a fix shows the rule status changes", async () => {
    const before = bk001({ grossWeightKg: fv("1000"), items: [item({ quantity: fv(1800) })] });
    const eb = await evaluate(before);
    const after = applyPatches(before, eb.results.find((r) => r.id === "R-03:item:it-1")!.fix.tested![0].patches);
    const chips = changeChips(before, eb, after, await evaluate(after));
    expect(chips).toContain("MUG-01 quantity 1,800 → 1,080");
    expect(chips).toContain("Declared value matches the products: Red → Pass");
    expect(chips).toContain("Units, boxes and quantity add up (MUG-01): Red → Pass");
    expect(chips).toContain("Carrier unchanged");
  });
});

describe("take-off page text", () => {
  it("summarises BK-001 in the spec's format", async () => {
    const b = bk001();
    expect(takeoffSummary(b, await evaluate(b))).toBe(
      "90 cartons of Ceramic coffee mug, 350 ml on 3 pallets, Leeds → Frankfurt (warehouse), Carrier A Road economy, £540, collection Thu 05 Nov 2026, estimated delivery Thu 12 Nov 2026.",
    );
  });

  it("builds the timeline from real values; the slot step appears only for an acknowledged appointment", async () => {
    const b = bk001();
    const steps = whatHappensNext(b, await evaluate(b));
    expect(steps).toEqual([
      "Print the commercial invoice and attach it to the shipment.",
      "Collection by Carrier A from Leeds on Thu 05 Nov 2026.",
      "UK export customs clearance (uses the HS codes, values and origins on the invoice).",
      "In transit, 5 working days.",
      "Import customs in Germany.",
      "Delivery to Frankfurt warehouse, estimated Thu 12 Nov 2026.",
    ]);
    const noSlot = bk001({ appointmentBooked: fv("No" as const) });
    expect(whatHappensNext(noSlot, await evaluate(noSlot))[0]).toBe("Book the delivery slot with the receiving warehouse for around Thu 12 Nov 2026.");
  });
});

describe("results table order (approved Q22)", () => {
  it("Blocked → Check → Ready, then most Red first, then ID", async () => {
    const ready = await evaluate();
    const check = await evaluate(bk001({ appointmentBooked: fv("No" as const) }));
    const blocked1 = await evaluate(bk001({ cartons: fv(100) }));
    const blocked2 = await evaluate(bk001({ cartons: fv(100), items: [item({ hsCode: fv<string>(null, null) })] }));
    const rows: { id: string; evaluation: Evaluation }[] = [
      { id: "R", evaluation: ready },
      { id: "C", evaluation: check },
      { id: "B1", evaluation: blocked1 },
      { id: "B2", evaluation: blocked2 },
    ];
    expect(rows.sort(compareWorstFirst).map((r) => r.id)).toEqual(["B2", "B1", "C", "R"]);
  });
});

