import { describe, expect, it } from "vitest";
import { countryOfCity, DESTINATION_CITIES } from "@/lib/reference/allowed";
import { CARRIERS } from "@/lib/reference/carriers";
import { RULEBOOK, RULE_IDS } from "@/lib/reference/rulebook";
import { BookingSchema } from "@/lib/types";
import { fmtDateLong, fmtGBP, fmtNum } from "@/lib/format";
import { isRealDate, londonToday } from "@/lib/dates/today";
import { bk001 } from "./fixtures/bookings";

describe("reference data", () => {
  it("has exactly the 10 rules with the rulebook severities", () => {
    expect(RULE_IDS).toEqual(["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08", "R-09", "R-10"]);
    const red = RULE_IDS.filter((id) => RULEBOOK[id].severity === "red");
    expect(red).toEqual(["R-01", "R-02", "R-03", "R-04", "R-05", "R-06"]);
  });

  it("carries the rate card exactly", () => {
    expect(CARRIERS.map((c) => [c.id, c.service, c.pricePerPallet, c.transitDays, c.onTimePct, c.maxKgPerPallet])).toEqual([
      ["A", "Road economy", { Germany: "180", France: "170", Netherlands: "160" }, 5, 92, 500],
      ["B", "Road standard", { Germany: "220", France: "210", Netherlands: "200" }, 3, 95, 750],
      ["C", "Road express", { Germany: "340", France: "330", Netherlands: "320" }, 2, 98, 400],
    ]);
  });

  it("maps every destination city to exactly one country", () => {
    expect(DESTINATION_CITIES.map((c) => [c, countryOfCity(c)])).toEqual([
      ["Berlin", "Germany"],
      ["Frankfurt", "Germany"],
      ["Hamburg", "Germany"],
      ["Paris", "France"],
      ["Lyon", "France"],
      ["Amsterdam", "Netherlands"],
      ["Rotterdam", "Netherlands"],
    ]);
  });

  it("validates the BK-001 fixture against the Zod schema", () => {
    expect(BookingSchema.safeParse(bk001()).success).toBe(true);
  });
});

describe("formatting", () => {
  it("formats money and numbers", () => {
    expect(fmtGBP("540")).toBe("£540");
    expect(fmtGBP("1700")).toBe("£1,700");
    expect(fmtGBP("5.5")).toBe("£5.50");
    expect(fmtNum(1080)).toBe("1,080");
    expect(fmtNum("206.666666", 1)).toBe("206.7");
  });

  it("formats dates as weekday + DD Mon YYYY", () => {
    expect(fmtDateLong("2026-11-05")).toBe("Thu 05 Nov 2026");
    expect(fmtDateLong("2026-11-12")).toBe("Thu 12 Nov 2026");
  });
});

describe("dates", () => {
  it("rejects impossible dates instead of rolling over", () => {
    expect(isRealDate(2026, 2, 31)).toBe(false);
    expect(isRealDate(2028, 2, 29)).toBe(true);
    expect(isRealDate(2026, 2, 29)).toBe(false);
  });

  it("computes today in Europe/London across the BST/GMT boundary", () => {
    // 23:30 UTC on 30 Jun = 00:30 BST on 1 Jul.
    expect(londonToday(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    // 23:30 UTC on 30 Dec = 23:30 GMT, still 30 Dec.
    expect(londonToday(new Date("2026-12-30T23:30:00Z"))).toBe("2026-12-30");
  });
});
