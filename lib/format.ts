import { Decimal } from "./num";

// Display formatting only. Never feed formatted values back into calculations.

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 1080 → "1,080"; 5.5 → "5.5"; keeps every decimal digit given. */
export function fmtNum(v: Decimal | number | string, dp?: number): string {
  const d = new Decimal(v);
  const s = dp === undefined ? d.toFixed() : d.toFixed(dp);
  const neg = s.startsWith("-");
  const [i, f] = (neg ? s.slice(1) : s).split(".");
  return `${neg ? "-" : ""}${groupThousands(i)}${f ? `.${f}` : ""}`;
}

/** £540, £1,700, £5.50 — whole pounds shown without pence. */
export function fmtGBP(v: Decimal | number | string): string {
  const d = new Decimal(v);
  const body = d.isInteger() ? fmtNum(d.abs(), 0) : fmtNum(d.abs(), 2);
  return `${d.isNegative() ? "-" : ""}£${body}`;
}

/** Weight in kg, up to the decimals present (1 dp when dp=1). */
export function fmtKg(v: Decimal | number | string, dp?: number): string {
  return `${fmtNum(v, dp)} kg`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoParts(iso: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, dow };
}

/** "2026-11-05" → "Thu 05 Nov 2026" (spec §11.4). */
export function fmtDateLong(iso: string): string {
  const { y, m, d, dow } = isoParts(iso);
  return `${WEEKDAYS[dow]} ${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-11-05" → "Thursday 05 Nov 2026" (chat read-back). */
export function fmtDateSpoken(iso: string): string {
  const { y, m, d, dow } = isoParts(iso);
  return `${WEEKDAYS_LONG[dow]} ${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-11-05" → "05-11-2026" (field format, spec §11.4). */
export function fmtDateField(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
