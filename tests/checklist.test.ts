// Product owner's rules checklist (docs/RULES-CHECKLIST.md): one probe per numbered item.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runChecks, type CheckContext, type CheckResult } from "@/lib/rules";
import { analyseCarriers } from "@/lib/carrier";
import { parseUpload } from "@/lib/parse";
import { parseDate, parseHsCode } from "@/lib/parse/values";
import { suggestFixes } from "@/lib/repair";
import { londonToday } from "@/lib/dates/today";
import { computeDeliveryDates } from "@/lib/dates/delivery";
import { checkSequence } from "@/lib/stage/sequence";
import { dec } from "@/lib/num";
import { handleTurn, missingQuestions, type TurnDeps } from "@/lib/chat/engine";
import { newChatSession, type ChatSession } from "@/lib/chat/session";
import { matchAllowed, parseAmount } from "@/lib/chat/normalize";
import { resolveDate } from "@/lib/chat/dates";
import type { ExtractOperation } from "@/lib/ai";
import type { Booking } from "@/lib/types";
import { bk001, fv, item, TODAY } from "./fixtures/bookings";
import { BOOKING_HEADERS, ITEM_HEADERS, EXAMPLE_BOOKING, EXAMPLE_ITEM, bookingRow, bookingsSheet, itemRow, itemsSheet, workbook, type Row } from "./fixtures/workbook";

// AUDIT PROBES against docs/RULES-CHECKLIST.md. Each test asserts the product owner's requirement;
// a failing test = the code does not meet that item. Test names start with the item number.

const ctx: CheckContext = { today: TODAY };
const res = (b: Booking, c: CheckContext = ctx) => runChecks(b, c).results;
const one = (rs: CheckResult[], ruleId: string) => rs.filter((r) => r.ruleId === ruleId && !r.nonBlocking);
const st = (b: Booking, ruleId: string, c: CheckContext = ctx) => one(res(b, c), ruleId).map((r) => r.status);
const hsItem = (value: string | null, raw?: string | null, numeric = false) => item({ hsCode: fv(value, raw ?? undefined), hsWasNumeric: numeric });
const withHs = (cell: { kind: "text"; value: string } | { kind: "number"; value: number }) => {
  const p = parseHsCode(cell);
  return bk001({ items: [item({ hsCode: { ...fv(p.value, p.raw), ...(p.problem ? { problem: p.problem } : {}) }, hsWasNumeric: p.wasNumeric })] });
};
const dg = (desc: string, hs = "691200") => {
  const b = bk001({ items: [item({ sku: fv("SKU-1"), description: fv(desc), hsCode: fv(hs) })] });
  return one(res(b), "R-06")[0];
};
async function book(bookings: Row[], items: Row[], bh = BOOKING_HEADERS, ih = ITEM_HEADERS) {
  const bytes = await workbook({ ...bookingsSheet(bookings), headers: bh }, { ...itemsSheet(items), headers: ih });
  const o = await parseUpload([{ name: "x.xlsx", bytes }]);
  if (!o.ok) throw new Error(o.error);
  return o;
}

describe("A. R-01", () => {
  it("#1 blank HS → Red fail", () => {
    const r = one(res(bk001({ items: [hsItem(null, null)] })), "R-01")[0];
    expect([r.status, r.severity]).toEqual(["fail", "red"]);
  });
  it("#2 numeric 691200.0 → 691200", () => {
    expect(parseHsCode({ kind: "number", value: 691200.0 }).value).toBe("691200");
  });
  it("#2b text '691200.0' (CSV / text cell) → 691200", () => {
    expect(parseHsCode({ kind: "text", value: "691200.0" }).value).toBe("691200");
  });
  it("#3 6912.00 and '6912 00' count as 6 digits", () => {
    expect(parseHsCode({ kind: "text", value: "6912.00" }).value).toBe("691200");
    expect(parseHsCode({ kind: "text", value: "6912 00" }).value).toBe("691200");
    expect(parseHsCode({ kind: "text", value: "6912-00" }).value).toBe("691200");
  });
  it("#4 letters → fail with invalid message", () => {
    const r = one(res(withHs({ kind: "text", value: "69A200" })), "R-01")[0];
    expect(r.status).toBe("fail");
    expect(r.found.toLowerCase()).toMatch(/valid/);
  });
  it("#5 90111 numeric → Red + hint 090111", () => {
    const r = one(res(withHs({ kind: "number", value: 90111 })), "R-01")[0];
    expect(r.status).toBe("fail");
    expect(r.fix.hint).toContain("090111");
  });
  it("#5b 90111 as text (CSV) → hint 090111", () => {
    const r = one(res(withHs({ kind: "text", value: "90111" })), "R-01")[0];
    expect(r.fix.hint ?? "").toContain("090111");
  });
  it("#6 8/10 digits pass; 12 digits pass + Info", () => {
    expect(st(bk001({ items: [hsItem("69120000")] }), "R-01")).toEqual(["pass"]);
    expect(st(bk001({ items: [hsItem("6912000000")] }), "R-01")).toEqual(["pass"]);
    const rs = res(bk001({ items: [hsItem("691200000000")] }));
    expect(one(rs, "R-01")[0].status).toBe("pass");
    expect(rs.some((r) => r.id.startsWith("INFO:hs-long"))).toBe(true);
  });
  it("#7 000000 → pass + Info not a real code", () => {
    const rs = res(bk001({ items: [hsItem("000000")] }));
    expect(one(rs, "R-01")[0].status).toBe("pass");
    expect(rs.some((r) => r.id.startsWith("INFO:hs-zero"))).toBe(true);
  });
  it("#8 message names item row and SKU", () => {
    const r = one(res(bk001({ items: [hsItem("1234")] })), "R-01")[0];
    expect(r.found).toContain("MUG-01");
    expect(r.found).toMatch(/row \d+/);
  });
});

describe("A. R-02", () => {
  it("#9/#10 exactly 1% passes (5454 vs 5400), over fails", () => {
    expect(st(bk001({ declaredValue: fv("5454") }), "R-02")).toEqual(["pass"]);
    expect(st(bk001({ declaredValue: fv("5346") }), "R-02")).toEqual(["pass"]);
    expect(st(bk001({ declaredValue: fv("5454.01") }), "R-02")).toEqual(["fail"]);
  });
  it("#9 denominator is the item sum (declared 5455 vs sum 5400: 1.0185% of sum → fail; 1.0000% of declared would differ)", () => {
    // 5346 vs 5400: gap 54 = 1% of sum (pass) but 1.0101% of declared.
    expect(st(bk001({ declaredValue: fv("5346") }), "R-02")).toEqual(["pass"]);
  });
  it("#11 sum 0 + declared 0 → pass + Info; declared > 0 → fail", () => {
    const z = (d: string) => bk001({ declaredValue: fv(d), items: [item({ unitPrice: fv("0") })] });
    const rs = res(z("0"));
    expect(one(rs, "R-02")[0].status).toBe("pass");
    expect(rs.some((r) => r.severity === "info" && r.status === "fail" && /£0|0/.test(r.found))).toBe(true);
    expect(st(z("10"), "R-02")).toEqual(["fail"]);
    // no items at all, declared 0
    const ni = res(bk001({ declaredValue: fv("0"), items: [] }));
    expect(one(ni, "R-02")[0].status).toBe("pass");
  });
  it("#11b no items, declared 0 → an Info note on R-02", () => {
    const ni = res(bk001({ declaredValue: fv("0"), items: [] }));
    expect(ni.some((r) => r.severity === "info" && /declared|item total|£0/i.test(r.found))).toBe(true);
  });
  it("#12 uses stated quantity even when R-03 fails", () => {
    const b = bk001({ declaredValue: fv("9000"), items: [item({ quantity: fv(1800) })] });
    expect(st(b, "R-03")).toEqual(["fail"]);
    expect(st(b, "R-02")).toEqual(["pass"]);
  });
  it("#13 no rounding inside (3 × £0.333 = 0.999; declared 1.00 → within 1%)", () => {
    const b = bk001({ declaredValue: fv("1.0099"), items: [item({ quantity: fv(3), unitPrice: fv("0.333"), unitsPerCarton: fv(3), cartons: fv(1) })], cartons: fv(1) });
    // 1% of 0.999 = 0.00999; gap 0.0109 → fail (rounding to pennies would make it 1.01 vs 1.00 = pass)
    expect(st(b, "R-02")).toEqual(["fail"]);
  });
  it("#14 no items → sum 0", () => {
    const r = one(res(bk001({ items: [] })), "R-02")[0];
    expect(r.status).toBe("fail");
    expect(r.found).toContain("£0");
  });
});

describe("A. R-03/R-04", () => {
  it("#15 exact match", () => {
    expect(st(bk001({ items: [item({ quantity: fv(1081) })] }), "R-03")).toEqual(["fail"]);
  });
  it("#16 fractional/zero/negative flagged (via upload)", async () => {
    const o = await book([bookingRow({ "Booking ID": "B1" })], [itemRow({ "Booking ID": "B1", Quantity: 2.5, "Units per carton": 0, Cartons: -3 })]);
    const r = one(runChecks(o.bookings[0], ctx).results, "R-03")[0];
    expect(r.status).not.toBe("pass");
    expect(r.found).toMatch(/whole number/);
  });
  it("#17 names item and implied quantity", () => {
    const r = one(res(bk001({ items: [item({ quantity: fv(1800) })] })), "R-03")[0];
    expect(r.found).toContain("MUG-01");
    expect(r.found).toContain("1,080");
  });
  it("#18 R-04 exact", () => {
    expect(st(bk001({ cartons: fv(91) }), "R-04")).toEqual(["fail"]);
  });
  it("#19 no items → R-04 fails", () => {
    expect(st(bk001({ items: [] }), "R-04")).toEqual(["fail"]);
  });
  it("#20 R-03 + R-04 → repair says which number (item cartons 9 → 90)", () => {
    const b = bk001({ items: [item({ cartons: fv(9) })] });
    const rs = runChecks(b, ctx);
    expect(one(rs.results, "R-04")[0].status).toBe("fail");
    const fx = suggestFixes(b, ctx, rs);
    const top = fx.byResult["R-04:booking"]?.[0];
    expect(top?.summary).toMatch(/cartons from 9 to 90/);
    expect(top?.evidence).toBeTruthy();
  });
});

describe("A. R-05", () => {
  it("#21 exactly at limit passes (1500/3 = 500 A, Cheapest)", () => {
    const rs = res(bk001({ grossWeightKg: fv("1500") }));
    expect(one(rs, "R-05")[0].status).toBe("pass");
    expect(runChecks(bk001({ grossWeightKg: fv("1500") }), ctx).carrier.recommended).toBe("A");
  });
  it("#22 pallets 0/blank/negative/fractional → cannot check, no crash", async () => {
    for (const p of [0, null, -2, 2.5, "abc"]) {
      const o = await book([bookingRow({ "Booking ID": "B1", Pallets: p as never })], [itemRow({ "Booking ID": "B1" })]);
      const r = one(runChecks(o.bookings[0], ctx).results, "R-05")[0];
      expect(r.status).toBe("missing_data");
    }
  });
  it("#23 450 kg/pallet, Fastest → visible R-05 issue on C, fix names B and 5 pallets, not Red-blocking", () => {
    const b = bk001({ grossWeightKg: fv("1350"), priority: fv("Fastest" as const) });
    const rep = runChecks(b, ctx);
    expect(rep.carrier.preferred).toBe("C");
    expect(rep.carrier.recommended).toBe("B");
    const pref = rep.results.find((r) => r.id === "R-05:booking:preferred")!;
    expect(pref).toBeTruthy();
    expect(pref.nonBlocking).toBe(true);
    expect(pref.found).toContain("Carrier B");
    expect(pref.fix.text).toMatch(/4 pallets|5 pallets/);
    expect(rep.status).not.toBe("blocked");
  });
  it("#23b the 10-rule stage does NOT show R-05 as a plain green OK in that case", () => {
    const b = bk001({ grossWeightKg: fv("1350"), priority: fv("Fastest" as const) });
    const step = checkSequence(runChecks(b, ctx).results).find((s) => s.ruleId === "R-05")!;
    expect(step.state).not.toBe("pass");
  });
  it("#23c Red only when no carrier fits", () => {
    const b = bk001({ grossWeightKg: fv("2400") }); // 800/pallet
    const rep = runChecks(b, ctx);
    expect(one(rep.results, "R-05")[0].status).toBe("fail");
    expect(rep.status).toBe("blocked");
  });
  it("#24 gross too low → R-05 uses item weight", () => {
    const b = bk001({ grossWeightKg: fv("620"), items: [item({ unitWeightKg: fv("1.5") })] }); // net 1620 → 540/pallet
    const rep = runChecks(b, ctx);
    expect(st(b, "R-07")).toEqual(["fail"]);
    expect(rep.carrier.evalBasis).toBe("net");
    expect(rep.carrier.rows.find((r) => r.carrier.id === "A")!.eligible).toBe(false);
  });
  it("#25 pass/fail per carrier for every booking", () => {
    const rep = runChecks(bk001(), ctx);
    expect(rep.carrier.rows.map((r) => r.eligible)).toEqual([true, true, true]);
    expect(one(rep.results, "R-05")[0].why.inputs.some((i) => /A 500 kg ✓/.test(i.value))).toBe(true);
  });
});

describe("A. R-06 (keywords only, no AI)", () => {
  const check = (ds: string[], ok: (s: string) => boolean) => expect(ds.map((d) => [d, dg(d).status]).filter(([, s]) => !ok(s))).toEqual([]);
  const redAll = (ds: string[]) => check(ds, (s) => s === "fail");
  const flaggedAll = (ds: string[]) => check(ds, (s) => s !== "pass");
  const cleanAll = (ds: string[]) => check(ds, (s) => s === "pass");
  const red = (d: string) => redAll([d]);
  const flagged = (d: string) => flaggedAll([d]);
  it("#27 lithium: clear words → Red", () => {
    redAll(["Power bank 10000mAh", "Li-ion battery pack", "Vape pen", "E-cigarette kit", "Rechargeable battery AA"]);
  });
  it("#27b lithium devices (phone, laptop, tablet, smartwatch, earbuds, camera, drone, e-bike) → Red", () => {
    redAll(["Smartphone", "Laptop computer", "Tablet 10 inch", "Smartwatch", "Wireless earbuds", "E-bike", "E-scooter", "Drone with camera"]);
  });
  it("#27c camera / rechargeable toys / generic 'rechargeable' at least flagged", () => {
    flaggedAll(["Digital camera", "Rechargeable toy car", "Rechargeable desk lamp"]);
  });
  it("#28 aerosols → Red", () => {
    redAll(["Hairspray 250ml", "Spray deodorant", "Dry shampoo", "Spray paint", "Compressed air duster", "Insect spray", "Whipped cream canisters"]);
  });
  it("#29 flammables → Red", () => {
    redAll(["Perfume 50ml", "Eau de parfum", "Eau de toilette", "Cologne", "Nail polish", "Nail polish remover", "Acetone", "Hand sanitiser", "Vodka 70cl", "Whisky", "Lighter fluid", "White spirit", "Paint thinner", "Solvent-based paint", "Wood varnish", "Isopropyl alcohol", "Reed diffuser"]);
  });
  it("#29b gin → Red; essential oils at least flagged", () => {
    red("London dry gin 70cl");
    flagged("Lavender essential oil 10ml");
  });
  it("#30 false positives avoided", () => {
    cleanAll(["Battery-free wall clock", "Toy car, batteries not included", "Clock (no batteries)", "AA alkaline batteries", "Pump spray bottle", "Trigger spray cleaner", "Water-based paint", "Scented candle", "Alcohol-free hand sanitiser"]);
  });
  it("#30b accessories: phone case (no electronics), laptop sleeve → pass", () => {
    cleanAll(["Phone case (no electronics)", "Laptop sleeve"]);
  });
  it("#31 HS hints alone → please confirm (needs_answer), not Red", () => {
    expect(["850760", "850650", "330300", "320810", "220860", "360610", "330720"].map((hs) => [hs, dg("Assorted goods", hs).status]).filter(([, s]) => s !== "needs_answer")).toEqual([]);
  });
  it("#31b SKU used as hint", () => {
    const b = bk001({ items: [item({ sku: fv("POWERBANK-01"), description: fv("Gadget") })] });
    expect(one(res(b), "R-06")[0].status).not.toBe("pass");
  });
  it("#32 trigger word shown", () => {
    expect(dg("Perfume 50ml").found).toContain("perfume");
  });
  it("#33 fix = remove or ship separately, no tested fix", () => {
    const r = dg("Perfume 50ml");
    expect(r.fix.text).toMatch(/(remove|off this booking).*separately.*dangerous.goods/i);
    expect(r.fix.tested ?? []).toHaveLength(0);
  });
});

describe("A. R-07..R-10", () => {
  it("#34 equal passes", () => {
    expect(st(bk001({ grossWeightKg: fv("540") }), "R-07")).toEqual(["pass"]);
  });
  it("#35 0.001 kg margin", () => {
    expect(st(bk001({ grossWeightKg: fv("539.999") }), "R-07")).toEqual(["pass"]);
  });
  it("#36 stated quantities", () => {
    expect(st(bk001({ grossWeightKg: fv("600"), items: [item({ quantity: fv(1800) })] }), "R-07")).toEqual(["fail"]);
  });
  it("#37/#38 R-08", () => {
    expect(st(bk001({ appointmentBooked: fv("No" as const) }), "R-08")).toEqual(["fail"]);
    expect(one(res(bk001({ appointmentBooked: fv("No" as const) })), "R-08")[0].severity).toBe("amber");
    expect(st(bk001(), "R-08")).toEqual(["pass"]);
    expect(st(bk001({ destinationType: fv("Business address" as const), appointmentBooked: fv("No" as const) }), "R-08")).toEqual(["not_applicable"]);
    expect(st(bk001({ destinationType: fv("Business address" as const), appointmentBooked: fv(null) }), "R-08")).toEqual(["not_applicable"]);
  });
  it("#39 blank appointment for warehouse = Amber shown as missing (does not block)", () => {
    const rep = runChecks(bk001({ appointmentBooked: fv(null) }), ctx);
    const r = one(rep.results, "R-08")[0];
    expect(r.found.toLowerCase()).toContain("blank");
    expect(rep.status).toBe("check");
  });
  it("#40 Y/yes/YES and destination type any case (upload)", async () => {
    for (const v of ["Y", "yes", "YES", " Yes "]) {
      const o = await book([bookingRow({ "Booking ID": "B1", "Delivery appointment booked": v, "Destination type": "WAREHOUSE" })], [itemRow({ "Booking ID": "B1" })]);
      expect(o.bookings[0].appointmentBooked.value).toBe("Yes");
      expect(o.bookings[0].destinationType.value).toBe("Warehouse");
    }
  });
  it("#41 blank origin fails (Amber)", () => {
    const r = one(res(bk001({ items: [item({ countryOfOrigin: fv(null) })] })), "R-09")[0];
    expect([r.status, r.severity]).toEqual(["fail", "amber"]);
  });
  it("#42 chat mapping", () => {
    for (const s of ["UK", "England", "Britain", "made here"]) expect(matchAllowed("countryOfOrigin", s)).toMatchObject({ ok: true, value: "United Kingdom" });
  });
  it("#44 today passes; UK time", () => {
    expect(st(bk001({ readyDate: fv(TODAY) }), "R-10")).toEqual(["pass"]);
    expect(londonToday(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(londonToday(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
  });
  it("#45 date formats", () => {
    expect(parseDate({ kind: "text", value: "05-11-2026" }).value).toBe("2026-11-05");
    expect(parseDate({ kind: "text", value: "05/11/2026" }).value).toBe("2026-11-05");
    expect(parseDate({ kind: "date", value: new Date(Date.UTC(2026, 10, 5)) }).value).toBe("2026-11-05");
    expect(parseDate({ kind: "number", value: 46331 }).value).toBe("2026-11-05");
    expect(parseDate({ kind: "text", value: "46331" }).value).toBe("2026-11-05");
  });
  it("#46 impossible date flagged", () => {
    const p = parseDate({ kind: "text", value: "31-02-2026" });
    expect(p.value).toBeNull();
    expect(p.problem).toBeTruthy();
  });
});

describe("B. file reading", () => {
  it("#48 header row found below several title rows", async () => {
    const bytes = await workbook(
      { name: "Bookings", headers: BOOKING_HEADERS, rows: [bookingRow({ "Booking ID": "B1" })], title: "Line1" },
      { name: "Items", headers: ITEM_HEADERS, rows: [itemRow({ "Booking ID": "B1" })], title: null },
    );
    const o = await parseUpload([{ name: "x.xlsx", bytes }]);
    expect(o.ok && o.bookings.length).toBe(1);
  });
  it("#49 sheets found by headers, not names; two files", async () => {
    const b = await workbook({ name: "Foo", headers: BOOKING_HEADERS, rows: [bookingRow({ "Booking ID": "B1" })] });
    const i = await workbook({ name: "Bar", headers: ITEM_HEADERS, rows: [itemRow({ "Booking ID": "B1" })] });
    const o = await parseUpload([{ name: "a.xlsx", bytes: b }, { name: "b.xlsx", bytes: i }]);
    expect(o.ok && o.bookings[0].items.length).toBe(1);
  });
  it("#50 'Quantity (units)' + split origin/destination city/country columns, reordered + extra columns", async () => {
    const bh = ["Seller name", "Booking ID", "Origin city", "Origin country", "Destination city", "Destination country", "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value", "Currency", "Total gross weight (kg)", "Delivery appointment booked", "Notes"];
    const ih = ["SKU", "Booking ID", "Description", "HS code", "Quantity (units)", "Unit price", "Units per carton", "Cartons", "Unit weight (kg)", "Country of origin", "Extra"];
    const o = await book(
      [["Acme", "B1", "Leeds", "United Kingdom", "Frankfurt", "Germany", "Warehouse", "05-11-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes", "x"]],
      [["MUG-01", "B1", "Mug", "691200", 1080, 5, 12, 90, 0.5, "United Kingdom", "y"]],
      bh,
      ih,
    );
    const b = o.bookings[0];
    expect(b.destinationCountry.value).toBe("Germany");
    expect(b.items[0].quantity.value).toBe(1080);
  });
  it("#51 header/value trim + case", async () => {
    const bh = BOOKING_HEADERS.map((h) => `  ${h.toUpperCase()} `);
    const o = await book([bookingRow({ "Booking ID": "B1", "Seller priority": " cheapest ", "Destination type": "warehouse", Currency: "gbp" })], [itemRow({ "Booking ID": "B1" })], bh);
    const b = o.bookings[0];
    expect([b.priority.value, b.destinationType.value, b.currency.value]).toEqual(["Cheapest", "Warehouse", "GBP"]);
  });
  it("#52 identical example row skipped and told; modified not skipped", async () => {
    const o = await book([EXAMPLE_BOOKING, bookingRow({ "Booking ID": "B1" })], [EXAMPLE_ITEM, itemRow({ "Booking ID": "B1" })]);
    expect(o.bookings.map((b) => b.bookingId.value)).toEqual(["B1"]);
    expect(o.warnings.some((w) => w.code === "example-skipped")).toBe(true);
    const o2 = await book([bookingRow({ Pallets: 4 })], [EXAMPLE_ITEM]);
    expect(o2.bookings.map((b) => b.bookingId.value)).toEqual(["BK-001"]);
  });
  it("#53 empty rows skipped", async () => {
    const o = await book([bookingRow({ "Booking ID": "B1" }), [], BOOKING_HEADERS.map(() => "  "), bookingRow({ "Booking ID": "B2" })], [itemRow({ "Booking ID": "B1" }), [], itemRow({ "Booking ID": "B2" })]);
    expect(o.bookings.length).toBe(2);
  });
  it("#54 numbers as text", async () => {
    const o = await book([bookingRow({ "Booking ID": "B1", "Total declared value": "5400 GBP", Cartons: "90" })], [itemRow({ "Booking ID": "B1", Quantity: "1,080", "Unit price": "£5.00" })]);
    const b = o.bookings[0];
    expect([b.declaredValue.value, b.items[0].quantity.value, b.items[0].unitPrice.value]).toEqual(["5400", 1080, "5"]);
  });
  it("#55 'bk-001 ' links to BK-001", async () => {
    const o = await book([bookingRow({ "Booking ID": "BK-777" })], [itemRow({ "Booking ID": " bk-777 " })]);
    expect(o.bookings[0].items.length).toBe(1);
  });
  it("#56 duplicate IDs flagged, kept separate", async () => {
    const o = await book([bookingRow({ "Booking ID": "D1" }), bookingRow({ "Booking ID": "d1 " })], [itemRow({ "Booking ID": "D1" })]);
    expect(o.bookings.length).toBe(2);
    expect(o.warnings.some((w) => w.code === "duplicate-id")).toBe(true);
    expect(runChecks(o.bookings[0], ctx).results.some((r) => r.id === "DATA:duplicate-id")).toBe(true);
  });
  it("#57 orphan items flagged", async () => {
    const o = await book([bookingRow({ "Booking ID": "B1" })], [itemRow({ "Booking ID": "B1" }), itemRow({ "Booking ID": "ZZ-9" })]);
    expect(o.warnings.some((w) => w.code === "orphan-item" && w.message.includes("ZZ-9"))).toBe(true);
  });
  it("#58 booking with no items flagged", async () => {
    const o = await book([bookingRow({ "Booking ID": "B1" }), bookingRow({ "Booking ID": "B2" })], [itemRow({ "Booking ID": "B1" })]);
    const b2 = o.bookings.find((b) => b.bookingId.value === "B2")!;
    expect(runChecks(b2, ctx).results.some((r) => r.id === "DATA:no-items")).toBe(true);
  });
  it("#59 same SKU twice flagged", () => {
    const rs = res(bk001({ items: [item({}, "a"), item({}, "b")] }));
    expect(rs.some((r) => r.id.startsWith("INFO:dup-sku"))).toBe(true);
  });
  it("#60 missing required field = cannot check, blocks", () => {
    const rep = runChecks(bk001({ sellerName: fv(null) }), ctx);
    expect(rep.results.some((r) => r.id === "DATA:sellerName" && r.status === "missing_data")).toBe(true);
    expect(rep.status).toBe("blocked");
  });
  it("#61 city/country mismatch Info; route from country", async () => {
    const o = await book([bookingRow({ "Booking ID": "B1", Destination: "Frankfurt, France" })], [itemRow({ "Booking ID": "B1" })]);
    const rep = runChecks(o.bookings[0], ctx);
    expect(rep.results.some((r) => r.id === "INFO:city-country")).toBe(true);
    expect(rep.carrier.route).toBe("France");
    expect(rep.carrier.rows[0].totalCost!.toString()).toBe("510");
  });
  it("#62 a bad row never crashes the batch", async () => {
    const bad = bookingRow({ "Booking ID": "B2", Pallets: { formula: "1/0", result: { error: "#DIV/0!" } } as never, "Ready to ship date": true as never, Origin: 42 as never, Destination: "" });
    const o = await book([bookingRow({ "Booking ID": "B1" }), bad], [itemRow({ "Booking ID": "B1" }), itemRow({ "Booking ID": "B2", "HS code": { richText: [{ text: "69" }, { text: "1200" }] } as never, Quantity: "lots" })]);
    expect(o.bookings.length).toBe(2);
    for (const b of o.bookings) expect(() => runChecks(b, ctx)).not.toThrow();
  });
  it("#50/#62 judges' workbook parses and has items with quantity", async () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/judges/Test3_Dangerous_Goods_R06.xlsx"));
    const o = await parseUpload([{ name: "Test3.xlsx", bytes }]);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.bookings.length).toBeGreaterThan(0);
    for (const b of o.bookings) {
      expect(b.items.length).toBeGreaterThan(0);
      for (const it of b.items) expect(it.quantity.value).not.toBeNull();
      expect(() => runChecks(b, ctx)).not.toThrow();
    }
  });
});

describe("C. carrier", () => {
  const base = { destinationCountry: "Germany" as const, pallets: 3, grossKg: dec(620), netKg: dec(540), priority: "Cheapest" as const };
  it("#63/#64 route + cost", () => {
    const a = analyseCarriers({ ...base, destinationCountry: "Netherlands" });
    expect(a.rows.map((r) => r.totalCost!.toString())).toEqual(["480", "600", "960"]);
  });
  it("#65 filters overweight, ranks rest", () => {
    const a = analyseCarriers({ ...base, grossKg: dec(1350) });
    expect(a.ranking).toEqual(["A", "B"]);
    expect(analyseCarriers({ ...base, grossKg: dec(1800) }).ranking).toEqual(["B"]);
  });
  it("#67 Balanced has TOPSIS + marginal", () => {
    const a = analyseCarriers({ ...base, priority: "Balanced" });
    expect(a.balanced?.topsis).toBeTruthy();
    expect(a.balanced?.marginal.length).toBeGreaterThan(0);
  });
  it("#68 recommendation even with Red issues (R-03 red)", () => {
    const rep = runChecks(bk001({ items: [item({ quantity: fv(1800) })] }), ctx);
    expect(rep.status).toBe("blocked");
    expect(rep.carrier.recommended).toBe("A");
  });
  it("#68b recommendation when pallets missing", () => {
    const rep = runChecks(bk001({ pallets: fv(null) }), ctx);
    expect(rep.carrier.recommended).not.toBeNull();
  });
  it("#68c recommendation ('once fixed, use …') when no carrier fits", () => {
    const rep = runChecks(bk001({ grossWeightKg: fv("2400") }), ctx);
    expect(rep.carrier.recommended).not.toBeNull();
  });
  it("#69 pallets missing → per-pallet prices, no total", () => {
    const a = analyseCarriers({ ...base, pallets: null });
    expect(a.rows.map((r) => [r.pricePerPallet?.toString(), r.totalCost])).toEqual([["180", null], ["220", null], ["340", null]]);
  });
  it("#70 changing inputs reruns (pure function)", () => {
    expect(runChecks(bk001({ priority: fv("Fastest" as const) }), ctx).carrier.recommended).toBe("C");
    expect(runChecks(bk001({ destinationCountry: fv("France" as const), destinationCity: fv("Paris" as const) }), ctx).carrier.rows[0].totalCost!.toString()).toBe("510");
  });
});

// --- D. Chat (Gemini mocked: extraction handed in directly).
const deps: TurnDeps = { today: TODAY, suggestHs: async () => null };
function op(field: ExtractOperation["field"], value: string | null, quote: string, extra: Partial<ExtractOperation> = {}): ExtractOperation {
  return { op: "set", field, itemRef: null, value, unit: null, quote, ...extra };
}
const turn = (s: ChatSession, text: string, operations: ExtractOperation[]) =>
  handleTurn(s, text, false, { ok: true as const, data: { operations, ambiguities: [], newShipment: false } }, deps);
const qCount = (reply: string) => reply.split("\n").filter((l) => /^\d\. /.test(l)).length || (reply.trim().endsWith("?") ? 1 : 0);

describe("D. chat", () => {
  it("#71/#73 business address → appointment No without asking", async () => {
    const r = await turn(newChatSession("x"), "to a shop in Paris", [op("destinationType", "shop", "a shop"), op("destinationCity", "Paris", "Paris")]);
    expect(r.session.booking.appointmentBooked.value).toBe("No");
    expect(missingQuestions(r.session).some((q) => q.key === "appointmentBooked")).toBe(false);
    const w = await turn(newChatSession("y"), "to a warehouse", [op("destinationType", "warehouse", "a warehouse")]);
    expect(missingQuestions(w.session).some((q) => q.key === "appointmentBooked")).toBe(true);
  });
  it("#72 origin UK, GBP, country from city", async () => {
    const r = await turn(newChatSession("x"), "to Rotterdam", [op("destinationCity", "Rotterdam", "Rotterdam")]);
    const b = r.session.booking;
    expect([b.originCountry.value, b.currency.value, b.destinationCountry.value]).toEqual(["United Kingdom", "GBP", "Netherlands"]);
  });
  it("#43 never fills origin with UK by default", async () => {
    const r = await turn(newChatSession("x"), "1080 mugs from Leeds", [op("originCity", "Leeds", "from Leeds"), op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" }), op("quantity", "1080", "1080 mugs", { itemRef: "mugs" })]);
    expect(r.session.booking.items[0].countryOfOrigin.value).toBeNull();
  });
  it("#74 stated kept even if wrong; calculated marked", async () => {
    let s = (await turn(newChatSession("x"), "1800 mugs, 12 per box, 90 boxes", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" }), op("quantity", "1800", "1800 mugs", { itemRef: "mugs" }), op("unitsPerCarton", "12", "12 per box", { itemRef: "mugs" }), op("cartons", "90", "90 boxes", { itemRef: "mugs" })])).session;
    expect(s.booking.items[0].quantity).toMatchObject({ value: 1800, source: "stated" });
    s = (await turn(newChatSession("y"), "12 per box, 90 boxes of mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" }), op("unitsPerCarton", "12", "12 per box", { itemRef: "mugs" }), op("cartons", "90", "90 boxes", { itemRef: "mugs" })])).session;
    expect(s.booking.items[0].quantity).toMatchObject({ value: 1080, source: "derived" });
    const last = s.messages.at(-1)!.text;
    expect(last).toMatch(/worked out/i);
  });
  it("#75 stated 90 stays, R-04 flagged, asks to update to 120", async () => {
    let s = (await turn(newChatSession("x"), "mugs, 90 boxes, 12 per box", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" }), op("cartons", "90", "90 boxes", { itemRef: "mugs" }), op("unitsPerCarton", "12", "12 per box", { itemRef: "mugs" })])).session;
    s = (await turn(s, "90 cartons in total", [op("cartons", "90", "90 cartons in total")])).session;
    const r = await turn(s, "also 30 cartons of plates", [op("description", "plates", "plates", { op: "add_item", itemRef: "plates" }), op("cartons", "30", "30 cartons of plates", { itemRef: "plates" })]);
    expect(r.session.booking.cartons).toMatchObject({ value: 90, source: "stated" });
    expect(r.reply).toContain("Update the total to 120?");
    expect(one(runChecks(r.session.booking, ctx).results, "R-04")[0].status).toBe("fail");
  });
  it("#76 gross weight never calculated without consent", async () => {
    const r = await turn(newChatSession("x"), "1080 mugs 0.5kg each on 3 pallets", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" }), op("quantity", "1080", "1080 mugs", { itemRef: "mugs" }), op("unitWeightKg", "0.5", "0.5kg", { itemRef: "mugs", unit: "kg" }), op("pallets", "3", "3 pallets")]);
    expect(r.session.booking.grossWeightKg.value).toBeNull();
    const u = await turn(r.session, "no idea of the gross weight", [op("grossWeightKg", null, "no idea of the gross weight", { op: "unknown" })]);
    expect(u.session.booking.grossWeightKg.value).toBeNull();
    const p = await turn(u.session, "don't know the pallet weight", [op("palletWeightKg", null, "don't know the pallet weight", { op: "unknown" })]);
    expect(p.session.booking.grossWeightKg).toMatchObject({ value: "615", source: "assumed" });
    expect(p.reply).toMatch(/confirm/i);
  });
  it("#77 unit conversions", () => {
    expect(parseAmount("300", "lb", "weight")).toMatchObject({ ok: true, value: "136.077711" });
    expect(parseAmount("2", "tonnes", "weight")).toMatchObject({ ok: true, value: "2000" });
    expect(parseAmount("90", "boxes", "int")).toMatchObject({ ok: true, value: "90" });
    expect(parseAmount("1080", "pieces", "int")).toMatchObject({ ok: true, value: "1080" });
    expect(parseAmount("5k", null, "int")).toMatchObject({ ok: true, value: "5000" });
    expect(parseAmount("5K", null, "money")).toMatchObject({ ok: true, value: "5000" });
  });
  it("#78 city outside list → lists options, no guess", async () => {
    const r = await turn(newChatSession("x"), "going to Munich", [op("destinationCity", "Munich", "Munich")]);
    expect(r.session.booking.destinationCity.value).toBeNull();
    expect(r.reply).toContain("Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam");
  });
  it("#79 euros/dollars → ask GBP, never convert", async () => {
    let s = (await turn(newChatSession("x"), "mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    const r = await turn(s, "$5 each", [op("unitPrice", "$5", "$5 each", { itemRef: "mugs" })]);
    expect(r.session.booking.items[0].unitPrice.value).toBeNull();
    expect(r.reply).toMatch(/GBP/);
    s = r.session;
    const r2 = await turn(s, "total value 5000 euros", [op("declaredValue", "5000 euros", "5000 euros")]);
    expect(r2.session.booking.declaredValue.value).not.toBe("5000");
  });
  it("#80 past ready date asked again straight away", async () => {
    const r = await turn(newChatSession("x"), "ready 20-10-2026", [op("readyDate", "20-10-2026", "ready 20-10-2026")]);
    expect(r.reply).toMatch(/When will it actually be ready to ship\?/);
  });
  it("#47 next Thursday from today, read back", async () => {
    expect(resolveDate("next Thursday", TODAY)).toBe("2026-10-29");
    const r = await turn(newChatSession("x"), "ready next Thursday", [op("readyDate", "next Thursday", "next Thursday")]);
    expect(r.reply).toMatch(/Ready to ship Thursday.*29.*correct\?/);
  });
  it("#81 ≤3 questions; no re-ask", async () => {
    let s = newChatSession("x");
    const r = await turn(s, "hello", []);
    expect(qCount(r.reply)).toBeLessThanOrEqual(3);
    s = (await turn(r.session, "from Leeds to Paris, 3 pallets", [op("originCity", "Leeds", "from Leeds"), op("destinationCity", "Paris", "to Paris"), op("pallets", "3", "3 pallets")])).session;
    const last = s.messages.at(-1)!.text;
    expect(qCount(last)).toBeLessThanOrEqual(3);
    expect(last).not.toMatch(/Which UK city|Where is it going|How many pallets/);
  });
});

describe("E. output/status", () => {
  it("#82 every non-pass issue has found, severity/state, why, how-to-fix", () => {
    const b = bk001({ grossWeightKg: fv("100"), declaredValue: fv("1"), appointmentBooked: fv("No" as const), items: [item({ hsCode: fv("000000"), quantity: fv(1800), countryOfOrigin: fv(null), unitPrice: fv("0") })] });
    const bad = res(b).filter((r) => r.status !== "pass" && r.status !== "not_applicable");
    const lacking = bad.filter((r) => !r.found || !r.whyItMatters || !(r.fix.text || r.fix.noApplyReason)).map((r) => `${r.id} found=${!!r.found} why=${!!r.whyItMatters} fix=${!!(r.fix.text || r.fix.noApplyReason)}`);
    expect(lacking).toEqual([]);
  });
  it("#83 status mapping", () => {
    expect(runChecks(bk001({ items: [item({ quantity: fv(1800) })] }), ctx).status).toBe("blocked");
    expect(runChecks(bk001({ appointmentBooked: fv("No" as const) }), ctx).status).toBe("check");
    expect(runChecks(bk001({ appointmentBooked: fv("No" as const) }), { ...ctx, acknowledged: ["R-08:booking"] }).status).toBe("ready");
    expect(runChecks(bk001(), ctx).status).toBe("ready");
  });
  it("#85 tested fixes contain only numeric patches", () => {
    const b = bk001({ items: [item({ quantity: fv(1800), hsCode: fv(null) })] });
    const fx = suggestFixes(b, ctx);
    const fields = Object.values(fx.byResult).flat().flatMap((f) => f.patches.map((p) => p.field));
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(["quantity", "unitPrice", "unitsPerCarton", "cartons", "declaredValue", "pallets"]).toContain(f);
  });
  it("#87 working-days assumption; past ready date → collection next working day from today", () => {
    const d = computeDeliveryDates({ readyDate: "2026-10-20", today: "2026-10-26", transitDays: 3, holidays: { uk: new Map(), destination: new Map() }, destinationLabel: "Frankfurt" });
    expect(d.assumptions).toContain("A2");
    expect(d.collection).toBe("2026-10-27");
  });
});

describe("A. R-06 extra", () => {
  it("#26 SKU is only a hint: SKU 'MUG-01' must not cancel a lithium/spirit description", () => {
    for (const d of ["Smartphone", "Vodka 70cl"]) {
      const b = bk001({ items: [item({ sku: fv("MUG-01"), description: fv(d) })] });
      expect([d, one(res(b), "R-06")[0].status]).toEqual([d, "fail"]);
    }
  });
});
