import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeDeliveryDates, holidaySetsFor, type HolidaySets } from "@/lib/dates/delivery";
import { holidaysFor, NagerResponseSchema, type HolidayFetcher } from "@/lib/dates/holidays";
import { fmtDateLong } from "@/lib/format";

// Real Nager.Date responses for 2026–2028, saved as fixtures.
const fixture = (year: number, cc: string) =>
  NagerResponseSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/holidays/${year}-${cc}.json`, import.meta.url)), "utf8")));
const fixtureFetcher: HolidayFetcher = async (year, cc) => fixture(year, cc);
const failingFetcher: HolidayFetcher = async () => null;

async function dates(o: { ready: string; today?: string; transit: number; country?: "Germany" | "France" | "Netherlands"; city?: "Berlin" | "Frankfurt" | "Hamburg" | "Paris" | "Amsterdam"; fetcher?: HolidayFetcher }) {
  const country = o.country ?? "Germany";
  const holidays: HolidaySets = await holidaySetsFor(o.fetcher ?? fixtureFetcher, country, o.city ?? "Frankfurt", o.ready);
  return computeDeliveryDates({ readyDate: o.ready, today: o.today ?? "2026-01-01", transitDays: o.transit, holidays, destinationLabel: country });
}

describe("delivery dates (ASSUMPTION A2: working days)", () => {
  it("BK-001: Thu 05 Nov 2026 + 5 working days (Carrier A) → Thu 12 Nov 2026", async () => {
    const d = await dates({ ready: "2026-11-05", transit: 5 });
    expect(fmtDateLong(d.collection)).toBe("Thu 05 Nov 2026");
    expect(fmtDateLong(d.delivery)).toBe("Thu 12 Nov 2026");
    expect(d.assumptions).toEqual(["A2"]);
    expect(d.notes).toEqual([]);
  });

  it("a weekend ready date moves collection to Monday, and says so", async () => {
    const d = await dates({ ready: "2026-11-07", transit: 3 });
    expect(d.collection).toBe("2026-11-09");
    expect(d.notes[0]).toBe("Collection moved from Sat 07 Nov 2026 to Mon 09 Nov 2026: weekend.");
    expect(d.delivery).toBe("2026-11-12");
  });

  it("an England bank holiday moves collection", async () => {
    const d = await dates({ ready: "2026-08-31", transit: 3 });
    expect(d.collection).toBe("2026-09-01");
    expect(d.notes[0]).toContain("Summer Bank Holiday (UK)");
  });

  it("skips holidays in England or the destination during transit", async () => {
    // Wed 23 Dec + 3: Thu 24 ✓, Fri 25 Christmas, weekend, Mon 28 England substitute day, Tue 29 ✓, Wed 30 ✓.
    const d = await dates({ ready: "2026-12-23", transit: 3 });
    expect(d.delivery).toBe("2026-12-30");
    expect(d.notes[0]).toContain("Fri 25 Dec 2026, Christmas Day (UK)");
    expect(d.notes[0]).toContain("Mon 28 Dec 2026, St. Stephen's Day (UK)");
  });

  it("uses the destination city's German state", async () => {
    // Mon 08 Mar 2027 is International Women's Day in Berlin (DE-BE) only.
    expect((await dates({ ready: "2027-03-05", transit: 3, city: "Berlin" })).delivery).toBe("2027-03-11");
    expect((await dates({ ready: "2027-03-05", transit: 3, city: "Frankfurt" })).delivery).toBe("2027-03-10");
  });

  it("a past ready date: collection on the next working day from today (rules checklist 87, replaces Q18)", async () => {
    const tue = await dates({ ready: "2026-10-20", today: "2026-10-27", transit: 3 });
    expect(tue.collection).toBe("2026-10-28");
    expect(tue.notes[0]).toContain("has passed");
    const sun = await dates({ ready: "2026-10-20", today: "2026-10-25", transit: 3 });
    expect(sun.collection).toBe("2026-10-26");
  });

  it("holiday service down → weekends only, with ASSUMPTION A8", async () => {
    const d = await dates({ ready: "2026-12-23", transit: 3, fetcher: failingFetcher });
    expect(d.delivery).toBe("2026-12-28"); // Thu 24, Fri 25, Mon 28 all counted
    expect(d.assumptions).toEqual(["A2", "A8"]);
  });

  it("one country down is enough to fall back", async () => {
    const partial: HolidayFetcher = async (y, cc) => (cc === "DE" ? null : fixture(y, cc));
    expect((await dates({ ready: "2026-11-05", transit: 5, fetcher: partial })).assumptions).toContain("A8");
  });
});

describe("holiday filtering", () => {
  it("England only: Scottish and Northern Irish days don't count", () => {
    const eng = holidaysFor(fixture(2026, "GB"), "GB-ENG");
    expect(eng.has("2026-04-06")).toBe(true); // Easter Monday
    expect(eng.has("2026-08-31")).toBe(true);
    expect(eng.has("2026-08-03")).toBe(false); // Scotland only
    expect(eng.has("2026-03-17")).toBe(false); // Northern Ireland only
  });

  it("only real days off: NL Good Friday and Liberation Day 2026 aren't public holidays", () => {
    const nl = holidaysFor(fixture(2026, "NL"), null);
    expect(nl.has("2026-04-03")).toBe(false);
    expect(nl.has("2026-05-05")).toBe(false);
    expect(nl.has("2026-04-27")).toBe(true); // King's Day
  });

  it("regional German holidays only for their state", () => {
    expect(holidaysFor(fixture(2026, "DE"), "DE-HH").has("2026-10-31")).toBe(true);
    expect(holidaysFor(fixture(2026, "DE"), "DE-HE").has("2026-10-31")).toBe(false);
  });
});
