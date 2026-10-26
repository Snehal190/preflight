import {
  CURRENCIES,
  DESTINATION_CITIES,
  DESTINATION_COUNTRIES,
  DESTINATION_TYPES,
  ITEM_ORIGIN_COUNTRIES,
  ORIGIN_CITIES,
  PRIORITIES,
  YES_NO,
} from "../reference/allowed";
import { EXAMPLE_BOOKING_ROW, EXAMPLE_ITEM_ROW } from "../reference/example";
import type { Booking, FieldValue, Item, Location } from "../types";
import { detectFileKind, isEmptyCell, readCsv, readXlsx, type Cell, type RawSheet } from "./cells";
import { parseDate, parseDecimal, parseEnum, parseHsCode, parsePositiveInt, parseText, type Parsed } from "./values";

// Spec §5: find the sheets by their headers, map columns by name, read values (never formulas),
// skip only the untouched template example, and keep going whatever one bad row contains.

export const MAX_DATA_ROWS = 2000;
const HEADER_SCAN_ROWS = 20;

export interface UploadFile {
  name: string;
  bytes: Uint8Array;
}

export interface ParseWarning {
  code: "example-skipped" | "unknown-columns" | "missing-columns" | "orphan-item" | "duplicate-id" | "row-error";
  message: string;
}

export type ParseOutcome =
  | { ok: true; bookings: Booking[]; warnings: ParseWarning[] }
  | { ok: false; error: string };

export function normaliseHeader(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normaliseBookingId(s: string): string {
  return s.trim().toUpperCase();
}

// Columns. Origin/Destination may be one "City, Country" column (as in the template example) or
// separate city/country columns. Confirm against the real template when it arrives.
const BOOKING_COLUMNS = [
  "Booking ID",
  "Seller name",
  "Destination type",
  "Ready to ship date",
  "Seller priority",
  "Pallets",
  "Cartons",
  "Total declared value",
  "Currency",
  "Total gross weight (kg)",
  "Delivery appointment booked",
] as const;
const PLACE_COLUMNS = {
  origin: { combined: "Origin", city: "Origin city", country: "Origin country" },
  destination: { combined: "Destination", city: "Destination city", country: "Destination country" },
} as const;
const ITEM_COLUMNS = [
  "Booking ID",
  "SKU",
  "Description",
  "HS code",
  "Quantity",
  "Unit price",
  "Units per carton",
  "Cartons",
  "Unit weight (kg)",
  "Country of origin",
] as const;

// Other names sellers' (and the judges') sheets use for the same column. The judges' Items sheet
// says "Quantity (units)". Matched after trimming and ignoring case.
const HEADER_ALIASES: Record<string, readonly string[]> = {
  Quantity: ["Quantity (units)", "Qty", "Units", "Quantity (pcs)"],
  "Unit price": ["Unit price (GBP)", "Unit price (£)", "Price per unit"],
  "Unit weight (kg)": ["Unit weight", "Unit weight (kgs)", "Weight per unit (kg)"],
  "Total gross weight (kg)": ["Total gross weight", "Gross weight (kg)", "Gross weight"],
  "Total declared value": ["Total declared value (GBP)", "Declared value", "Total value"],
  "Delivery appointment booked": ["Delivery appointment", "Appointment booked"],
  "Units per carton": ["Units per box", "Units / carton"],
  "Ready to ship date": ["Ready date", "Ready to ship"],
};

interface Table {
  sheet: RawSheet;
  /** 0-based index of the header row. */
  headerRow: number;
  /** normalised header → { column index, header as written } */
  columns: Map<string, { index: number; header: string }>;
}

function cellText(c: Cell | undefined): string {
  if (!c) return "";
  if (c.kind === "text") return c.value;
  return "";
}

function findHeader(sheet: RawSheet): Table | null {
  const limit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    const row = sheet.rows[r];
    if (!row.some((c) => normaliseHeader(cellText(c)) === "booking id")) continue;
    const columns = new Map<string, { index: number; header: string }>();
    row.forEach((c, index) => {
      const h = cellText(c).trim();
      if (h && !columns.has(normaliseHeader(h))) columns.set(normaliseHeader(h), { index, header: h.replace(/\s+/g, " ") });
    });
    for (const [name, aliases] of Object.entries(HEADER_ALIASES)) {
      if (columns.has(normaliseHeader(name))) continue;
      const alias = aliases.map(normaliseHeader).find((a) => columns.has(a));
      if (!alias) continue;
      columns.set(normaliseHeader(name), columns.get(alias)!);
      columns.delete(alias);
    }
    return { sheet, headerRow: r, columns };
  }
  return null;
}

type Classified = { bookings: Table[]; items: Table[] };

function classify(tables: Table[]): Classified {
  const out: Classified = { bookings: [], items: [] };
  for (const t of tables) {
    if (t.columns.has("seller name")) out.bookings.push(t);
    else if (t.columns.has("sku")) out.items.push(t);
  }
  return out;
}

function expectedHeaders(t: Table, kind: "bookings" | "items"): { missing: string[]; unknown: string[] } {
  const known = new Set<string>();
  const missing: string[] = [];
  const required: string[] = kind === "bookings" ? [...BOOKING_COLUMNS] : [...ITEM_COLUMNS];
  for (const h of required) {
    known.add(normaliseHeader(h));
    if (!t.columns.has(normaliseHeader(h))) missing.push(h);
  }
  if (kind === "bookings") {
    for (const p of Object.values(PLACE_COLUMNS)) {
      for (const h of [p.combined, p.city, p.country]) known.add(normaliseHeader(h));
      const hasCombined = t.columns.has(normaliseHeader(p.combined));
      const hasSplit = t.columns.has(normaliseHeader(p.city)) && t.columns.has(normaliseHeader(p.country));
      if (!hasCombined && !hasSplit) missing.push(p.combined);
    }
  }
  const unknown = [...t.columns.entries()].filter(([k]) => !known.has(k)).map(([, v]) => v.header);
  return { missing, unknown };
}

/** Data rows after the header that aren't fully empty, with their 1-based row numbers. */
function dataRows(t: Table): { rowNumber: number; cells: Cell[] }[] {
  const out: { rowNumber: number; cells: Cell[] }[] = [];
  for (let r = t.headerRow + 1; r < t.sheet.rows.length; r++) {
    const cells = t.sheet.rows[r];
    if (cells.every((c) => isEmptyCell(c))) continue;
    out.push({ rowNumber: r + 1, cells });
  }
  return out;
}

class RowReader {
  constructor(
    private t: Table,
    private cells: Cell[],
    private rowNumber: number,
  ) {}

  has(header: string): boolean {
    return this.t.columns.has(normaliseHeader(header));
  }

  cell(header: string): Cell | undefined {
    const col = this.t.columns.get(normaliseHeader(header));
    return col ? this.cells[col.index] : undefined;
  }

  location(header: string): Location {
    const col = this.t.columns.get(normaliseHeader(header));
    return { kind: "cell", sheet: this.t.sheet.name, row: this.rowNumber, column: col?.header ?? header };
  }

  field<T>(header: string, parse: (c: Cell | undefined) => Parsed<T>): FieldValue<T> {
    if (!this.has(header)) {
      return {
        value: null,
        raw: null,
        source: "file",
        location: this.location(header),
        problem: `the "${header}" column is missing from the ${this.t.sheet.name} sheet.`,
        unreadable: true,
      };
    }
    const p = parse(this.cell(header));
    const fv: FieldValue<T> = { value: p.value, raw: p.raw, source: "file", location: this.location(header) };
    if (p.problem) fv.problem = p.problem;
    if (p.unreadable) fv.unreadable = true;
    return fv;
  }
}

/** "Manchester, United Kingdom" → city + country fields (both located at the combined column). */
function placeFields<C extends string, K extends string>(
  rr: RowReader,
  cols: { combined: string; city: string; country: string },
  cities: readonly C[],
  countries: readonly K[],
): { city: FieldValue<C>; country: FieldValue<K> } {
  if (rr.has(cols.city) && rr.has(cols.country)) {
    return { city: rr.field(cols.city, (c) => parseEnum(c, cities)), country: rr.field(cols.country, (c) => parseEnum(c, countries)) };
  }
  const whole = rr.field(cols.combined, parseText);
  const loc = rr.location(cols.combined);
  const base = { source: "file" as const, location: loc };
  if (whole.value === null) {
    const f = { ...base, value: null, raw: whole.raw, problem: whole.problem, unreadable: whole.unreadable };
    return { city: f, country: f };
  }
  const idx = whole.value.lastIndexOf(",");
  const cityText = idx >= 0 ? whole.value.slice(0, idx) : whole.value;
  const countryText = idx >= 0 ? whole.value.slice(idx + 1) : "";
  const city = parseEnum<C>({ kind: "text", value: cityText }, cities);
  const country = countryText.trim() ? parseEnum<K>({ kind: "text", value: countryText }, countries) : { value: null, raw: null, problem: `no country given in "${whole.raw}" (expected "City, Country").` };
  return {
    city: { ...base, value: city.value, raw: whole.raw, ...(city.problem ? { problem: city.problem } : {}) },
    country: { ...base, value: country.value, raw: whole.raw, ...(country.problem ? { problem: country.problem } : {}) },
  };
}

type BookingFields = Omit<Booking, "key" | "items" | "integrity">;

function readBookingRow(rr: RowReader): BookingFields {
  const origin = placeFields(rr, PLACE_COLUMNS.origin, ORIGIN_CITIES, ["United Kingdom"] as const);
  const dest = placeFields(rr, PLACE_COLUMNS.destination, DESTINATION_CITIES, DESTINATION_COUNTRIES);
  return {
    bookingId: rr.field("Booking ID", parseText),
    sellerName: rr.field("Seller name", parseText),
    originCity: origin.city,
    originCountry: origin.country,
    destinationCity: dest.city,
    destinationCountry: dest.country,
    destinationType: rr.field("Destination type", (c) => parseEnum(c, DESTINATION_TYPES)),
    readyDate: rr.field("Ready to ship date", parseDate),
    priority: rr.field("Seller priority", (c) => parseEnum(c, PRIORITIES)),
    pallets: rr.field("Pallets", parsePositiveInt),
    cartons: rr.field("Cartons", parsePositiveInt),
    declaredValue: rr.field("Total declared value", (c) => parseDecimal(c, "gte0")),
    currency: rr.field("Currency", (c) => parseEnum(c, CURRENCIES)),
    grossWeightKg: rr.field("Total gross weight (kg)", (c) => parseDecimal(c, "gt0")),
    appointmentBooked: rr.field("Delivery appointment booked", (c) => parseEnum(c, YES_NO, { yesNo: true })),
  };
}

function readItemRow(rr: RowReader, itemId: string): { bookingIdRaw: string | null; item: Item } {
  const hs = rr.has("HS code") ? parseHsCode(rr.cell("HS code")) : null;
  const hsField: FieldValue<string> = hs
    ? { value: hs.value, raw: hs.raw, source: "file", location: rr.location("HS code"), ...(hs.problem ? { problem: hs.problem } : {}), ...(hs.unreadable ? { unreadable: true } : {}) }
    : rr.field("HS code", parseText);
  return {
    bookingIdRaw: rr.field("Booking ID", parseText).value,
    item: {
      itemId,
      sku: rr.field("SKU", parseText),
      description: rr.field("Description", parseText),
      hsCode: hsField,
      hsWasNumeric: hs?.wasNumeric ?? false,
      quantity: rr.field("Quantity", parsePositiveInt),
      unitPrice: rr.field("Unit price", (c) => parseDecimal(c, "gte0")),
      unitsPerCarton: rr.field("Units per carton", parsePositiveInt),
      cartons: rr.field("Cartons", parsePositiveInt),
      unitWeightKg: rr.field("Unit weight (kg)", (c) => parseDecimal(c, "gt0")),
      countryOfOrigin: rr.field("Country of origin", (c) => parseEnum(c, ITEM_ORIGIN_COUNTRIES)),
    },
  };
}

/** Canonical parsed values, for "every field exactly matches the example" comparisons. */
function canonical(obj: Record<string, unknown>, skip: string[] = []): string {
  const vals: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.includes(k)) continue;
    if (v && typeof v === "object" && "value" in v) vals[k] = (v as FieldValue<unknown>).value;
  }
  return JSON.stringify(vals, Object.keys(vals).sort());
}

function exampleTable(row: Readonly<Record<string, string>>, name: string): { t: Table; cells: Cell[] } {
  const headers = Object.keys(row);
  const cells: Cell[] = headers.map((h) => ({ kind: "text", value: row[h] }));
  const columns = new Map(headers.map((h, index) => [normaliseHeader(h), { index, header: h }]));
  return { t: { sheet: { name, file: name, rows: [] }, headerRow: 0, columns }, cells };
}

const EXAMPLE_BOOKING_CANON = (() => {
  const { t, cells } = exampleTable(EXAMPLE_BOOKING_ROW, "Bookings");
  return canonical(readBookingRow(new RowReader(t, cells, 3)));
})();
const EXAMPLE_ITEM_CANON = (() => {
  const { t, cells } = exampleTable(EXAMPLE_ITEM_ROW, "Items");
  const { bookingIdRaw, item } = readItemRow(new RowReader(t, cells, 3), "x");
  return `${bookingIdRaw}|${canonical(item, ["itemId", "hsWasNumeric"])}`;
})();

function emptyBookingFields(rr: RowReader, why: string): BookingFields {
  const fields = readBookingRowSafe(rr);
  if (fields) return fields;
  const f = <T>(col: string): FieldValue<T> => ({ value: null, raw: null, source: "file", location: rr.location(col), problem: why, unreadable: true });
  return {
    bookingId: f("Booking ID"),
    sellerName: f("Seller name"),
    originCity: f("Origin"),
    originCountry: f("Origin"),
    destinationCity: f("Destination"),
    destinationCountry: f("Destination"),
    destinationType: f("Destination type"),
    readyDate: f("Ready to ship date"),
    priority: f("Seller priority"),
    pallets: f("Pallets"),
    cartons: f("Cartons"),
    declaredValue: f("Total declared value"),
    currency: f("Currency"),
    grossWeightKg: f("Total gross weight (kg)"),
    appointmentBooked: f("Delivery appointment booked"),
  };
}

function readBookingRowSafe(rr: RowReader): BookingFields | null {
  try {
    return readBookingRow(rr);
  } catch {
    return null;
  }
}

export async function parseUpload(files: UploadFile[]): Promise<ParseOutcome> {
  if (files.length === 0) return { ok: false, error: "No files were uploaded." };
  const sheets: RawSheet[] = [];
  for (const f of files) {
    const kind = detectFileKind(f.name, f.bytes);
    if ("error" in kind) return { ok: false, error: kind.error };
    try {
      if (kind.kind === "xlsx") sheets.push(...(await readXlsx(f.name, f.bytes)));
      else sheets.push(readCsv(f.name, new TextDecoder("utf-8").decode(f.bytes)));
    } catch {
      return { ok: false, error: `We couldn't open ${f.name}. Check it's a valid .xlsx or .csv file.` };
    }
  }

  const tables = sheets.map(findHeader).filter((t): t is Table => t !== null);
  const { bookings: bTables, items: iTables } = classify(tables);
  const notFound: string[] = [];
  if (bTables.length === 0) notFound.push('the Bookings sheet (a header row with "Booking ID" and "Seller name")');
  if (iTables.length === 0) notFound.push('the Items sheet (a header row with "Booking ID" and "SKU")');
  if (notFound.length) return { ok: false, error: `We couldn't find ${notFound.join(" or ")}. The header row must be within the first ${HEADER_SCAN_ROWS} rows.` };
  if (bTables.length > 1) return { ok: false, error: `We found more than one Bookings sheet (${bTables.map((t) => t.sheet.name).join(", ")}). Upload just one.` };
  if (iTables.length > 1) return { ok: false, error: `We found more than one Items sheet (${iTables.map((t) => t.sheet.name).join(", ")}). Upload just one.` };
  const bt = bTables[0];
  const itbl = iTables[0];

  const warnings: ParseWarning[] = [];
  for (const [t, kind] of [[bt, "bookings"], [itbl, "items"]] as const) {
    const { missing, unknown } = expectedHeaders(t, kind);
    if (missing.length) warnings.push({ code: "missing-columns", message: `The ${t.sheet.name} sheet has no ${missing.map((m) => `"${m}"`).join(", ")} column${missing.length > 1 ? "s" : ""}; checks that need ${missing.length > 1 ? "them" : "it"} show Missing data.` });
    if (unknown.length) warnings.push({ code: "unknown-columns", message: `Ignored extra column${unknown.length > 1 ? "s" : ""} in the ${t.sheet.name} sheet: ${unknown.map((u) => `"${u}"`).join(", ")}.` });
  }

  const bRows = dataRows(bt);
  const iRows = dataRows(itbl);
  for (const [rows, t] of [[bRows, bt], [iRows, itbl]] as const) {
    if (rows.length > MAX_DATA_ROWS) return { ok: false, error: `The ${t.sheet.name} sheet has ${rows.length} rows; the limit is ${MAX_DATA_ROWS}. Split it into smaller files.` };
  }

  // Bookings.
  type Pending = { rowNumber: number; fields: BookingFields; norm: string | null };
  const pending: Pending[] = [];
  let exampleBookingSkipped = false;
  for (const { rowNumber, cells } of bRows) {
    const rr = new RowReader(bt, cells, rowNumber);
    const fields = emptyBookingFields(rr, "we couldn't read this row.");
    if (!exampleBookingSkipped && canonical(fields) === EXAMPLE_BOOKING_CANON) {
      exampleBookingSkipped = true;
      warnings.push({ code: "example-skipped", message: `Skipped the template's example row (row ${rowNumber}).` });
      continue;
    }
    const id = fields.bookingId.value;
    pending.push({ rowNumber, fields, norm: id ? normaliseBookingId(id) : null });
  }

  const rowsById = new Map<string, number[]>();
  for (const p of pending) if (p.norm) rowsById.set(p.norm, [...(rowsById.get(p.norm) ?? []), p.rowNumber]);
  for (const [id, rows] of rowsById) {
    if (rows.length > 1) warnings.push({ code: "duplicate-id", message: `${id} appears ${rows.length} times in the Bookings sheet (rows ${rows.join(", ")}). We kept them separate; fix the IDs to check them.` });
  }

  // Items.
  const itemsById = new Map<string, Item[]>();
  let exampleItemSkipped = false;
  for (const { rowNumber, cells } of iRows) {
    const rr = new RowReader(itbl, cells, rowNumber);
    let parsed: ReturnType<typeof readItemRow>;
    try {
      parsed = readItemRow(rr, `${itbl.sheet.name}!r${rowNumber}`);
    } catch {
      warnings.push({ code: "row-error", message: `We couldn't read Items sheet row ${rowNumber}.` });
      continue;
    }
    const { bookingIdRaw, item } = parsed;
    if (exampleBookingSkipped && !exampleItemSkipped && `${bookingIdRaw}|${canonical(item, ["itemId", "hsWasNumeric"])}` === EXAMPLE_ITEM_CANON) {
      exampleItemSkipped = true;
      warnings.push({ code: "example-skipped", message: `Skipped the template's example item row (row ${rowNumber}).` });
      continue;
    }
    if (!bookingIdRaw) {
      warnings.push({ code: "orphan-item", message: `Items sheet row ${rowNumber} has no Booking ID, so it isn't linked to any booking.` });
      continue;
    }
    const norm = normaliseBookingId(bookingIdRaw);
    if (!rowsById.has(norm)) {
      warnings.push({ code: "orphan-item", message: `Items sheet row ${rowNumber} refers to ${bookingIdRaw.trim()}, which isn't in the Bookings sheet.` });
      continue;
    }
    itemsById.set(norm, [...(itemsById.get(norm) ?? []), item]);
  }

  const bookings: Booking[] = pending.map((p) => {
    const dupRows = p.norm ? rowsById.get(p.norm)! : [];
    const duplicated = dupRows.length > 1;
    const key = p.norm ? (duplicated ? `${p.norm}#r${p.rowNumber}` : p.norm) : `#r${p.rowNumber}`;
    const items = p.norm ? (itemsById.get(p.norm) ?? []) : [];
    return {
      key,
      ...p.fields,
      // Duplicated IDs: each booking shows the same items, since we can't tell whose they are.
      items: items.map((it) => (duplicated ? { ...it, itemId: `${it.itemId}@r${p.rowNumber}` } : it)),
      integrity: duplicated ? { duplicateIdRows: dupRows } : {},
    };
  });

  return { ok: true, bookings, warnings };
}

/** "BK-004 (row 7)" for duplicated IDs, otherwise the ID as typed. */
export function bookingLabel(b: Booking): string {
  const id = b.bookingId.raw?.trim() || "(no ID)";
  const row = b.bookingId.location?.kind === "cell" ? b.bookingId.location.row : null;
  return b.integrity.duplicateIdRows && row ? `${id} (row ${row})` : id;
}
