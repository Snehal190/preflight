import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseUpload, bookingLabel, type ParseOutcome } from "@/lib/parse";
import { runChecks } from "@/lib/rules";

// The judges' own dangerous-goods workbook (Test3_Dangerous_Goods_R06.xlsx), in their exact format:
// title row, "Quantity (units)", split city/country columns, the grey example row. Only R-06 is
// planted; every other rule passes. Runs without AI (keywords + HS hints), so it's the floor.

const TODAY = "2026-10-26";
const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/judges/Test3_Dangerous_Goods_R06.xlsx", import.meta.url))));

let outcome: ParseOutcome;
async function parsed() {
  outcome ??= await parseUpload([{ name: "Test3_Dangerous_Goods_R06.xlsx", bytes }]);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome;
}

const DG_RED = ["BK-301", "BK-302", "BK-303", "BK-304", "BK-305", "BK-306", "BK-307", "BK-308", "BK-309", "BK-310", "BK-311", "BK-312", "BK-313", "BK-340"];
const SAFE = ["BK-320", "BK-321", "BK-322", "BK-323", "BK-324", "BK-325", "BK-326", "BK-327", "BK-328", "BK-329"];
/** Vague description, but the HS code points to dangerous goods: please confirm (rules checklist 31). */
const HS_ONLY = ["BK-330", "BK-331", "BK-332", "BK-333"];

describe("judges' Test3 workbook (R-06)", () => {
  it("reads the file cleanly: both example rows skipped, no missing columns, 28 bookings", async () => {
    const o = await parsed();
    expect(o.bookings).toHaveLength(28);
    expect(o.warnings.map((w) => w.code).sort()).toEqual(["example-skipped", "example-skipped"]);
    for (const b of o.bookings) for (const it of b.items) expect(it.quantity.value).not.toBeNull();
  });

  it("every booking gets exactly the planted result, and nothing else", async () => {
    const o = await parsed();
    const got: Record<string, string> = {};
    for (const b of o.bookings) {
      const rep = runChecks(b, { today: TODAY });
      const issues = rep.results
        .filter((r) => r.status !== "pass" && r.status !== "not_applicable" && r.id !== "INFO:dg-keywords-only")
        .map((r) => `${r.ruleId}:${r.status}`);
      got[bookingLabel(b)] = `${rep.status} ${issues.join(",")}`.trim();
    }
    const want: Record<string, string> = {};
    for (const id of DG_RED) want[id] = "blocked R-06:fail";
    for (const id of SAFE) want[id] = "ready";
    for (const id of HS_ONLY) want[id] = "blocked R-06:needs_answer";
    expect(got).toEqual(want);
  });

  it("explains each flag in plain words, naming what triggered it", async () => {
    const o = await parsed();
    const r06 = (id: string) => runChecks(o.bookings.find((b) => bookingLabel(b) === id)!, { today: TODAY }).results.find((r) => r.ruleId === "R-06")!;
    expect(r06("BK-301").found).toBe(
      `PB-20K "Portable power bank 20000mAh" contains a lithium battery (the description says "power bank"). Road carriers can't take lithium batteries, aerosols or flammable liquids on a normal pallet.`,
    );
    expect(r06("BK-301").fix.text).toBe("Take PB-20K off this booking, or send it separately with a dangerous-goods carrier.");
    expect(r06("BK-330").found).toContain("its HS code 850760 is the customs code for lithium-ion batteries");
  });
});
