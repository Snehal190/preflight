import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseUpload, bookingLabel, type ParseOutcome } from "@/lib/parse";
import { runChecks } from "@/lib/rules";
import { suggestFixes } from "@/lib/repair";

// The manual test pack (samples/test-pack) must produce exactly the issues it was built to plant.
// Runs without AI (keywords + HS hints only), like the app with no Gemini key.

const TODAY = "2026-10-26";
const file = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../samples/test-pack/${name}`, import.meta.url))));

let outcome: ParseOutcome;
async function parsed() {
  outcome ??= await parseUpload([
    { name: "Bookings.xlsx", bytes: file("Bookings.xlsx") },
    { name: "Items.xlsx", bytes: file("Items.xlsx") },
  ]);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome;
}

/** Every issue on a booking, as "ruleId:status" (Info by id), ignoring the no-AI banner. */
async function issues(label: string) {
  const o = await parsed();
  const b = o.bookings.find((x) => bookingLabel(x) === label);
  if (!b) throw new Error(`no booking ${label}: ${o.bookings.map(bookingLabel).join(", ")}`);
  const report = runChecks(b, { today: TODAY });
  const list = report.results
    .filter((r) => r.status !== "pass" && r.status !== "not_applicable" && r.id !== "INFO:dg-keywords-only")
    .map((r) => (r.ruleId === "INFO" || r.ruleId === "DATA" ? r.id.replace(/:it.*$|:Items!.*$/, "") : `${r.ruleId}:${r.status}${r.nonBlocking ? ":non-blocking" : ""}`))
    .sort();
  return { b, report, list };
}

const EXPECTED: Record<string, { status: "blocked" | "check" | "ready"; issues: string[] }> = {
  "T-01": { status: "ready", issues: [] },
  "T-02": { status: "blocked", issues: ["R-02:fail", "R-03:fail"] },
  "T-03": { status: "blocked", issues: ["R-04:fail"] },
  "T-04": { status: "blocked", issues: ["R-01:fail", "R-01:fail", "R-09:fail"] },
  "T-05": { status: "ready", issues: ["R-05:fail:non-blocking"] },
  "T-06": { status: "blocked", issues: ["R-05:fail"] },
  "T-07": { status: "blocked", issues: ["R-06:fail", "R-06:needs_answer"] },
  "T-08": { status: "check", issues: ["R-07:fail"] },
  "T-09": { status: "check", issues: ["R-08:fail", "R-10:fail"] },
  "T-10": { status: "blocked", issues: ["DATA:currency", "DATA:priority", "R-05:missing_data"] },
  "T-11": { status: "ready", issues: [] },
  "T-12": { status: "ready", issues: ["INFO:city-country", "INFO:dup-sku:MUG-01", "INFO:zero-price"] },
  "T-13 (row 16)": { status: "blocked", issues: ["DATA:duplicate-id"] },
  "t-13 (row 17)": { status: "blocked", issues: ["DATA:duplicate-id"] },
  "T-14": { status: "blocked", issues: ["R-10:missing_data"] },
  "T-15": { status: "blocked", issues: ["R-04:missing_data"] },
};

describe("test pack: file-level findings", () => {
  it("parses both files, skips both example rows, and reports the banner items", async () => {
    const o = await parsed();
    expect(o.bookings.map(bookingLabel).sort()).toEqual(Object.keys(EXPECTED).sort());
    const msgs = o.warnings.map((w) => w.message);
    expect(msgs).toContain("Skipped the template's example row (row 3).");
    expect(msgs).toContain("Skipped the template's example item row (row 3).");
    expect(msgs).toContain('Ignored extra column in the Bookings sheet: "Notes".');
    expect(msgs).toContain("Items sheet row 24 refers to T-99, which isn't in the Bookings sheet.");
    expect(msgs.some((m) => m.startsWith("T-13 appears 2 times"))).toBe(true);
  });
});

describe("test pack: every planted issue, and nothing else", () => {
  for (const [label, exp] of Object.entries(EXPECTED)) {
    it(`${label} → ${exp.status}: ${exp.issues.join(", ") || "no issues"}`, async () => {
      const { report, list } = await issues(label);
      expect(list).toEqual([...exp.issues].sort());
      expect(report.status).toBe(exp.status);
    });
  }
});

describe("test pack: key details", () => {
  it("T-01 Balanced → Carrier B £440", async () => {
    const { report } = await issues("T-01");
    expect(report.carrier.recommended).toBe("B");
    expect(report.carrier.rows.find((r) => r.carrier.id === "B")!.totalCost!.toString()).toBe("440");
  });

  it("T-02 suggests quantity 1,080 and names the digit swap", async () => {
    const { b, report } = await issues("T-02");
    const top = suggestFixes(b, { today: TODAY }, report).byResult[report.results.find((r) => r.ruleId === "R-03")!.id][0];
    expect(top.summary).toBe("Change MUG-01 quantity from 1,800 to 1,080");
    expect(top.typo).toBe("Looks like two digits were swapped.");
  });

  it("T-04 flags the lost leading zero on 90121", async () => {
    const { report } = await issues("T-04");
    expect(report.results.find((r) => r.ruleId === "R-01" && r.fix.hint)!.fix.hint).toContain("did you mean 090121?");
  });

  it("T-05 shows the 5-pallet alternative for Carrier C", async () => {
    const { report } = await issues("T-05");
    expect(report.carrier.recommended).toBe("B");
    expect(report.carrier.alternative!.text).toContain("5 × £340 = £1,700 vs 4 × £220 = £880");
  });

  it("T-06 needs at least 4 pallets", async () => {
    const { report } = await issues("T-06");
    expect(report.results.find((r) => r.ruleId === "R-05")!.fix.text).toContain("Repack onto at least 4 pallets");
  });

  it("T-07: power bank Red, charger asks, torch passes", async () => {
    const { report } = await issues("T-07");
    const r06 = report.results.filter((r) => r.ruleId === "R-06").map((r) => [r.scope.kind === "item" ? r.scope.sku : "", r.status]);
    expect(r06).toEqual([["PB-01", "fail"], ["CH-01", "needs_answer"], ["TR-01", "pass"]]);
  });

  it("T-10 explains each missing value", async () => {
    const { report } = await issues("T-10");
    expect(report.results.find((r) => r.ruleId === "R-05")!.found).toContain("whole number above 0");
    expect(report.results.find((r) => r.id === "DATA:currency")!.found).toContain('"EUR"');
  });

  it("T-15 says the formula has no saved value", async () => {
    const { report } = await issues("T-15");
    expect(report.results.find((r) => r.ruleId === "R-04")!.found).toContain("formula with no saved value");
  });
});
