import { Decimal } from "../num";
import { isRealDate, toIso } from "../dates/today";
import { cellRaw, isEmptyCell, type Cell } from "./cells";

// Cell → value parsers (spec §5.3). Each returns the value, or null with a plain-English problem.
// Nothing is ever rounded or guessed.

export interface Parsed<T> {
  value: T | null;
  raw: string | null;
  problem?: string;
  /** Couldn't be read at all → Missing data even for rules that fail on bad values. */
  unreadable?: boolean;
}

function unreadableOrNull<T>(c: Cell | undefined): Parsed<T> | null {
  if (isEmptyCell(c)) return { value: null, raw: null };
  if (c!.kind === "formula_no_value") {
    return { value: null, raw: cellRaw(c), problem: "This cell is a formula with no saved value, please paste values.", unreadable: true };
  }
  if (c!.kind === "error") return { value: null, raw: cellRaw(c), problem: `the cell shows the error ${cellRaw(c)}.`, unreadable: true };
  return null;
}

/** "1,080", "£5.00", "5400 GBP", " 90 " → decimal string. */
export function parseNumberText(s: string): string | null {
  const stripped = s.replace(/£/g, "").replace(/gbp/gi, "").replace(/,/g, "").replace(/\s+/g, "");
  return /^-?\d+(\.\d+)?$/.test(stripped) ? stripped : /^-?\.\d+$/.test(stripped) ? stripped.replace(".", "0.") : null;
}

function numberOf(c: Cell): Decimal | null {
  if (c.kind === "number") return Number.isFinite(c.value) ? new Decimal(c.value) : null;
  if (c.kind === "text") {
    const n = parseNumberText(c.value);
    return n === null ? null : new Decimal(n);
  }
  return null;
}

/** Whole-number fields: integers above 0. 0, negative or fractional → problem, never rounded. */
export function parsePositiveInt(c: Cell | undefined): Parsed<number> {
  const early = unreadableOrNull<number>(c);
  if (early) return early;
  const raw = cellRaw(c);
  const n = numberOf(c!);
  if (n === null) return { value: null, raw, problem: `"${raw}" isn't a number.` };
  if (!n.isInteger() || n.lte(0)) return { value: null, raw, problem: `must be a whole number above 0 (found ${raw}).` };
  if (n.gt(Number.MAX_SAFE_INTEGER)) return { value: null, raw, problem: `${raw} is too large.` };
  return { value: n.toNumber(), raw };
}

export type DecimalRule = "gte0" | "gt0";

/** Money/weight fields kept as decimal strings. */
export function parseDecimal(c: Cell | undefined, rule: DecimalRule): Parsed<string> {
  const early = unreadableOrNull<string>(c);
  if (early) return early;
  const raw = cellRaw(c);
  const n = numberOf(c!);
  if (n === null) return { value: null, raw, problem: `"${raw}" isn't a number.` };
  if (rule === "gt0" && n.lte(0)) return { value: null, raw, problem: `must be more than 0 (found ${raw}).` };
  if (rule === "gte0" && n.lt(0)) return { value: null, raw, problem: `can't be negative (found ${raw}).` };
  return { value: n.toFixed(), raw };
}

/** HS code: digits only, leading zeros kept. Invalid → value null + problem (R-01 fails it). */
export function parseHsCode(c: Cell | undefined): Parsed<string> & { wasNumeric: boolean } {
  const early = unreadableOrNull<string>(c);
  if (early) return { ...early, wasNumeric: false };
  const raw = cellRaw(c);
  if (c!.kind === "number") {
    if (!Number.isInteger(c!.value) || c!.value < 0) return { value: null, raw, problem: "it isn't a whole number", wasNumeric: true };
    return { value: new Decimal(c!.value).toFixed(0), raw, wasNumeric: true };
  }
  if (c!.kind === "text") {
    const stripped = c!.value.replace(/[\s.\-]/g, "");
    if (stripped === "") return { value: null, raw: null, wasNumeric: false };
    if (!/^\d+$/.test(stripped)) return { value: null, raw, problem: "it contains characters other than digits", wasNumeric: false };
    return { value: stripped, raw, wasNumeric: false };
  }
  return { value: null, raw, problem: "it isn't a code", wasNumeric: false };
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function fromSerial(n: number): string | null {
  if (!Number.isInteger(n) || n < 1) return null;
  const dt = new Date(EXCEL_EPOCH_UTC + n * 86_400_000);
  const y = dt.getUTCFullYear();
  if (y < 1900 || y > 2200) return null;
  return toIso(y, dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Ready-to-ship date: Excel date, serial, or DD-MM-YYYY / DD/MM/YYYY / D-M-YYYY. Always day first. */
export function parseDate(c: Cell | undefined): Parsed<string> {
  const early = unreadableOrNull<string>(c);
  if (early) return early;
  const raw = cellRaw(c);
  const bad = (why: string): Parsed<string> => ({ value: null, raw, problem: why });
  if (c!.kind === "date") {
    const d = c!.value;
    if (Number.isNaN(d.getTime())) return bad("that isn't a readable date.");
    return { value: toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), raw };
  }
  if (c!.kind === "number") {
    const iso = fromSerial(c!.value);
    return iso ? { value: iso, raw } : bad(`${raw} isn't a valid date serial number.`);
  }
  if (c!.kind === "text") {
    const s = c!.value.trim();
    const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
    if (m) {
      const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!isRealDate(y, mo, d)) return bad(`"${s}" isn't a real date (day-month-year).`);
      return { value: toIso(y, mo, d), raw };
    }
    if (/^\d{5}$/.test(s)) {
      const iso = fromSerial(Number(s));
      if (iso) return { value: iso, raw };
    }
    return bad(`"${s}" isn't a date in DD-MM-YYYY format.`);
  }
  return bad("that isn't a date.");
}

/** Fixed-list value: trimmed, case-insensitive. Yes/No also accepts Y/N. */
export function parseEnum<T extends string>(c: Cell | undefined, allowed: readonly T[], opts: { yesNo?: boolean } = {}): Parsed<T> {
  const early = unreadableOrNull<T>(c);
  if (early) return early;
  const raw = cellRaw(c);
  const s = (raw ?? "").trim().toLowerCase();
  let match = allowed.find((a) => a.toLowerCase() === s);
  if (!match && opts.yesNo) {
    if (s === "y") match = allowed.find((a) => a === "Yes");
    if (s === "n") match = allowed.find((a) => a === "No");
  }
  if (match) return { value: match, raw };
  return { value: null, raw, problem: `"${raw}" isn't one of the allowed options: ${allowed.join(", ")}.` };
}

/** Free text (seller name, SKU, description). */
export function parseText(c: Cell | undefined): Parsed<string> {
  const early = unreadableOrNull<string>(c);
  if (early) return early;
  const raw = cellRaw(c);
  const v = (raw ?? "").trim();
  return v ? { value: v, raw } : { value: null, raw: null };
}
