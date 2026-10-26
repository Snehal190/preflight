import { describe, expect, it } from "vitest";
import { parseUpload, bookingLabel, MAX_DATA_ROWS, type ParseOutcome } from "@/lib/parse";
import { parseDate, parseDecimal, parseHsCode, parsePositiveInt } from "@/lib/parse/values";
import { runChecks } from "@/lib/rules";
import type { Booking } from "@/lib/types";
import { TODAY } from "./fixtures/bookings";
import {
  BOOKING_HEADERS,
  EXAMPLE_BOOKING,
  EXAMPLE_ITEM,
  ITEM_HEADERS,
  bookingRow,
  bookingsSheet,
  itemRow,
  itemsSheet,
  workbook,
  type Row,
} from "./fixtures/workbook";

async function parseBook(bookings: Row[], items: Row[], opts: { bookingsExtra?: object; itemsExtra?: object } = {}) {
  const bytes = await workbook(bookingsSheet(bookings, opts.bookingsExtra), itemsSheet(items, opts.itemsExtra));
  return parseUpload([{ name: "bookings.xlsx", bytes }]);
}

function ok(o: ParseOutcome) {
  if (!o.ok) throw new Error(o.error);
  return o;
}

function byId(o: ParseOutcome, id: string): Booking {
  const b = ok(o).bookings.find((x) => x.bookingId.value === id);
  if (!b) throw new Error(`no booking ${id}`);
  return b;
}

const text = (value: string) => ({ kind: "text" as const, value });
const num = (value: number) => ({ kind: "number" as const, value });

describe("sheets, headers and the example row", () => {
  it("finds the header row by scanning below the title sentence, and skips the identical example", async () => {
    const o = ok(await parseBook([EXAMPLE_BOOKING, bookingRow({ "Booking ID": "BK-002" })], [EXAMPLE_ITEM, itemRow({ "Booking ID": "BK-002" })]));
    expect(o.bookings.map((b) => b.bookingId.value)).toEqual(["BK-002"]);
    expect(o.warnings.map((w) => w.message)).toContain("Skipped the template's example row (row 3).");
    expect(o.bookings[0].items).toHaveLength(1);
    expect(o.bookings[0].pallets.location).toEqual({ kind: "cell", sheet: "Bookings", row: 4, column: "Pallets" });
  });

  it("keeps BK-001 as a real booking when any value differs", async () => {
    const o = ok(await parseBook([bookingRow({ Pallets: 4 })], [EXAMPLE_ITEM]));
    expect(o.bookings).toHaveLength(1);
    expect(o.bookings[0].items).toHaveLength(1);
    expect(o.warnings.some((w) => w.code === "example-skipped")).toBe(false);
  });

  it("skips the example item only when the example booking was skipped too (approved Q16)", async () => {
    const o = ok(await parseBook([bookingRow({ "Seller name": "Real Seller" })], [EXAMPLE_ITEM]));
    expect(o.bookings[0].items).toHaveLength(1);
  });

  it("finds the header row when there's no title row", async () => {
    const o = ok(await parseBook([bookingRow({ "Booking ID": "BK-9" })], [itemRow({ "Booking ID": "BK-9" })], { bookingsExtra: { title: null } }));
    expect(o.bookings[0].bookingId.location).toMatchObject({ row: 2 });
  });

  it("skips fully empty rows, including dropdown-only rows down to row 500", async () => {
    const o = ok(await parseBook([bookingRow({ "Booking ID": "BK-2" }), [], bookingRow({ "Booking ID": "BK-3" })], [itemRow({ "Booking ID": "BK-2" })], { bookingsExtra: { trailingEmpty: 490 } }));
    expect(o.bookings.map((b) => b.bookingId.value)).toEqual(["BK-2", "BK-3"]);
  });

  it("maps reordered columns by name and reports extra columns", async () => {
    const headers = [...BOOKING_HEADERS].reverse().concat(["Notes"]);
    const row = bookingRow({ "Booking ID": "BK-7" }).slice().reverse().concat(["hello"]);
    const bytes = await workbook({ name: "B", headers, rows: [row] }, itemsSheet([itemRow({ "Booking ID": "BK-7" })]));
    const o = ok(await parseUpload([{ name: "x.xlsx", bytes }]));
    expect(o.bookings[0].pallets.value).toBe(3);
    expect(o.bookings[0].sellerName.value).toBe("Northfield Goods");
    expect(o.warnings.some((w) => w.code === "unknown-columns" && w.message.includes('"Notes"'))).toBe(true);
  });

  it("identifies sheets by headers, not names", async () => {
    const bytes = await workbook({ name: "Sheet9", headers: ITEM_HEADERS, rows: [itemRow({ "Booking ID": "BK-5" })] }, { name: "Items", headers: BOOKING_HEADERS, rows: [bookingRow({ "Booking ID": "BK-5" })] });
    const o = ok(await parseUpload([{ name: "x.xlsx", bytes }]));
    expect(o.bookings[0].items).toHaveLength(1);
  });

  it("a missing required column → Missing data on that field, with a banner", async () => {
    const headers = BOOKING_HEADERS.filter((h) => h !== "Currency");
    const row = bookingRow({ "Booking ID": "BK-4" }).filter((_, i) => BOOKING_HEADERS[i] !== "Currency");
    const bytes = await workbook({ name: "Bookings", headers, rows: [row] }, itemsSheet([itemRow({ "Booking ID": "BK-4" })]));
    const o = ok(await parseUpload([{ name: "x.xlsx", bytes }]));
    expect(o.bookings[0].currency.value).toBeNull();
    expect(o.warnings.some((w) => w.code === "missing-columns" && w.message.includes('"Currency"'))).toBe(true);
    const r = runChecks(o.bookings[0], { today: TODAY }).results.find((x) => x.id === "DATA:currency")!;
    expect(r.found).toContain('the "Currency" column is missing');
  });

  it("a missing sheet is a clear error", async () => {
    const bytes = await workbook(bookingsSheet([bookingRow({})]));
    const o = await parseUpload([{ name: "x.xlsx", bytes }]);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error).toContain("the Items sheet");
  });
});

describe("cell values", () => {
  it("reads numbers written as text", async () => {
    const o = await parseBook(
      [bookingRow({ "Booking ID": "BK-2", "Total declared value": "5400 GBP", Cartons: " 90 " })],
      [itemRow({ "Booking ID": "BK-2", Quantity: "1,080", "Unit price": "£5.00" })],
    );
    const b = byId(o, "BK-2");
    expect(b.declaredValue.value).toBe("5400");
    expect(b.cartons.value).toBe(90);
    expect(b.items[0].quantity.value).toBe(1080);
    expect(b.items[0].unitPrice.value).toBe("5");
    expect(b.items[0].unitPrice.raw).toBe("£5.00");
  });

  it("whole-number fields: 0, negative and fractional are Missing data, never rounded", () => {
    expect(parsePositiveInt(num(2.5)).problem).toContain("whole number above 0");
    expect(parsePositiveInt(num(0)).value).toBeNull();
    expect(parsePositiveInt(text("-3")).value).toBeNull();
    expect(parsePositiveInt(text("abc")).problem).toBe('"abc" isn\'t a number.');
  });

  it("decimal fields respect their lower bounds", () => {
    expect(parseDecimal(num(0), "gte0").value).toBe("0");
    expect(parseDecimal(num(0), "gt0").value).toBeNull();
    expect(parseDecimal(text("-1"), "gte0").value).toBeNull();
    expect(parseDecimal(num(0.1), "gt0").value).toBe("0.1");
  });

  it.each([
    ["numeric 691200 (691200.0)", num(691200.0), "691200", true],
    ['text "090111"', text("090111"), "090111", false],
    ["numeric 90111", num(90111), "90111", true],
    ['text "6912.00"', text("6912.00"), "691200", false],
    ['text "0901 11"', text("0901 11"), "090111", false],
  ])("HS code %s → %s", (_, cell, expected, numeric) => {
    const p = parseHsCode(cell);
    expect(p.value).toBe(expected);
    expect(p.wasNumeric).toBe(numeric);
  });

  it("HS code blank → null; 'ABC123' → invalid; non-integer number → invalid", () => {
    expect(parseHsCode({ kind: "empty" })).toMatchObject({ value: null, raw: null });
    expect(parseHsCode(text("ABC123"))).toMatchObject({ value: null, raw: "ABC123" });
    expect(parseHsCode(num(6912.5)).value).toBeNull();
  });

  it("dates: real Excel date cell, serial, DD-MM-YYYY, D/M/YYYY; 31-02 rejected", async () => {
    const o = await parseBook(
      [
        bookingRow({ "Booking ID": "D1", "Ready to ship date": new Date(Date.UTC(2026, 10, 5)) }),
        bookingRow({ "Booking ID": "D2", "Ready to ship date": 46331 }),
        bookingRow({ "Booking ID": "D3", "Ready to ship date": "05-11-2026" }),
        bookingRow({ "Booking ID": "D4", "Ready to ship date": "5/11/2026" }),
        bookingRow({ "Booking ID": "D5", "Ready to ship date": "31-02-2026" }),
      ],
      [],
    );
    for (const id of ["D1", "D2", "D3", "D4"]) expect(byId(o, id).readyDate.value).toBe("2026-11-05");
    const d5 = byId(o, "D5").readyDate;
    expect(d5.value).toBeNull();
    expect(d5.raw).toBe("31-02-2026");
    expect(d5.problem).toContain("isn't a real date");
  });

  it("dates are never month-first", () => {
    expect(parseDate(text("12-01-2027")).value).toBe("2027-01-12");
    expect(parseDate(text("01-13-2027")).value).toBeNull();
    expect(parseDate(text("2026-11-05")).value).toBeNull();
  });

  it("formula cells: cached result used; no cached result → Missing data", async () => {
    const o = await parseBook(
      [bookingRow({ "Booking ID": "F1", Cartons: { formula: "45*2", result: 90 } as never }), bookingRow({ "Booking ID": "F2", Cartons: { formula: "45*2" } as never })],
      [itemRow({ "Booking ID": "F1", "HS code": { formula: "A1" } as never })],
    );
    expect(byId(o, "F1").cartons.value).toBe(90);
    const f2 = byId(o, "F2").cartons;
    expect(f2.value).toBeNull();
    expect(f2.problem).toBe("This cell is a formula with no saved value, please paste values.");
    const r01 = runChecks(byId(o, "F1"), { today: TODAY }).results.find((r) => r.ruleId === "R-01")!;
    expect(r01.status).toBe("missing_data");
  });

  it("fixed lists: case-insensitive, Y/N, and unknown values show the allowed options", async () => {
    const o = await parseBook([bookingRow({ "Booking ID": "E1", "Seller priority": " fastest ", "Delivery appointment booked": "y", Destination: "Munich, Germany" })], []);
    const b = byId(o, "E1");
    expect(b.priority.value).toBe("Fastest");
    expect(b.appointmentBooked.value).toBe("Yes");
    expect(b.destinationCity.value).toBeNull();
    expect(b.destinationCity.problem).toContain("Berlin, Frankfurt, Hamburg");
    expect(b.destinationCountry.value).toBe("Germany");
  });

  it("a currency other than GBP → Missing data (approved Q17)", async () => {
    const b = byId(await parseBook([bookingRow({ "Booking ID": "C1", Currency: "EUR" })], []), "C1");
    expect(b.currency.value).toBeNull();
    expect(runChecks(b, { today: TODAY }).results.some((r) => r.id === "DATA:currency")).toBe(true);
  });
});

describe("integrity checks", () => {
  it("duplicate booking IDs stay separate and are both Missing data", async () => {
    const o = ok(await parseBook([bookingRow({ "Booking ID": "BK-4" }), bookingRow({ "Booking ID": "BK-5" }), bookingRow({ "Booking ID": "bk-4" })], [itemRow({ "Booking ID": "BK-4" })]));
    const dups = o.bookings.filter((b) => b.integrity.duplicateIdRows);
    expect(dups.map(bookingLabel)).toEqual(["BK-4 (row 3)", "bk-4 (row 5)"]);
    expect(new Set(dups.map((b) => b.key)).size).toBe(2);
    for (const b of dups) expect(runChecks(b, { today: TODAY }).results.some((r) => r.id === "DATA:duplicate-id")).toBe(true);
    expect(o.warnings.some((w) => w.code === "duplicate-id")).toBe(true);
  });

  it("orphan items are reported in the banner", async () => {
    const o = ok(await parseBook([bookingRow({ "Booking ID": "BK-2" })], [itemRow({ "Booking ID": "BK-2" }), itemRow({ "Booking ID": "BK-099" })]));
    expect(o.warnings.map((w) => w.message)).toContain("Items sheet row 4 refers to BK-099, which isn't in the Bookings sheet.");
  });

  it("a booking with no items is kept and flagged", async () => {
    const o = ok(await parseBook([bookingRow({ "Booking ID": "BK-2" })], []));
    expect(o.bookings[0].items).toEqual([]);
    expect(runChecks(o.bookings[0], { today: TODAY }).results.some((r) => r.id === "DATA:no-items")).toBe(true);
  });

  it('links " bk-001 " to BK-001 and displays the original', async () => {
    const o = ok(await parseBook([bookingRow({ "Seller name": "Someone else" })], [itemRow({ "Booking ID": " bk-001 " })]));
    expect(o.bookings[0].items).toHaveLength(1);
    expect(o.bookings[0].bookingId.raw).toBe("BK-001");
  });

  it("city-country mismatch → Info, priced on the country", async () => {
    const b = byId(await parseBook([bookingRow({ "Booking ID": "M1", Destination: "Paris, Germany" })], [itemRow({ "Booking ID": "M1" })]), "M1");
    const report = runChecks(b, { today: TODAY });
    expect(report.results.find((r) => r.id === "INFO:city-country")!.found).toBe("Paris is in France, but the country says Germany.");
    expect(report.carrier.route).toBe("Germany");
  });

  it("one bad row never crashes the upload: every booking gets a result", async () => {
    const o = ok(
      await parseBook(
        [bookingRow({ "Booking ID": "G1" }), bookingRow({ "Booking ID": "G2", Pallets: "lots", "Ready to ship date": true, Origin: 12, Currency: { error: "#REF!" } as never })],
        [itemRow({ "Booking ID": "G2", Quantity: "??", "HS code": true })],
      ),
    );
    expect(o.bookings).toHaveLength(2);
    for (const b of o.bookings) expect(() => runChecks(b, { today: TODAY })).not.toThrow();
  });
});

describe("files", () => {
  it("accepts two CSV files", async () => {
    const csv = (headers: string[], rows: (string | number)[][]) => new TextEncoder().encode([headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"));
    const o = ok(
      await parseUpload([
        { name: "bookings.csv", bytes: csv(BOOKING_HEADERS, [bookingRow({ "Booking ID": "CSV-1", Pallets: "3" }).map(String)]) },
        { name: "items.csv", bytes: csv(ITEM_HEADERS, [itemRow({ "Booking ID": "CSV-1", "HS code": "090111" }).map(String)]) },
      ]),
    );
    expect(o.bookings[0].items[0].hsCode.value).toBe("090111");
    expect(o.bookings[0].readyDate.value).toBe("2026-11-05");
    expect(runChecks(o.bookings[0], { today: TODAY }).status).toBe("ready");
  });

  it("accepts one workbook per sheet", async () => {
    const o = ok(
      await parseUpload([
        { name: "b.xlsx", bytes: await workbook(bookingsSheet([bookingRow({ "Booking ID": "W1" })])) },
        { name: "i.xlsx", bytes: await workbook(itemsSheet([itemRow({ "Booking ID": "W1" })])) },
      ]),
    );
    expect(o.bookings[0].items).toHaveLength(1);
  });

  it("rejects .xls/.xlsm, fake .xlsx, non-UTF-8 CSV and files over 4 MB", async () => {
    const real = await workbook(bookingsSheet([]));
    const cases: [string, Uint8Array, string][] = [
      ["a.xlsm", real, ".xlsm and .xls"],
      ["a.xls", real, ".xlsm and .xls"],
      ["a.xlsx", new TextEncoder().encode("Booking ID,Seller name"), "isn't a real .xlsx"],
      ["a.csv", new Uint8Array([0x42, 0xff, 0xfe, 0x00]), "isn't a text CSV"],
      ["a.csv", new Uint8Array(4 * 1024 * 1024 + 1).fill(0x41), "larger than 4 MB"],
      ["a.pdf", real, "only .xlsx and .csv"],
    ];
    for (const [name, bytes, msg] of cases) {
      const o = await parseUpload([{ name, bytes }]);
      expect(o.ok).toBe(false);
      if (!o.ok) expect(o.error).toContain(msg);
    }
  });

  it(`rejects more than ${MAX_DATA_ROWS} data rows`, async () => {
    const rows = Array.from({ length: MAX_DATA_ROWS + 1 }, (_, i) => bookingRow({ "Booking ID": `R-${i}` }));
    const o = await parseBook(rows, []);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error).toContain("the limit is 2000");
  });
});
