import { addDays, dayOfWeek, isRealDate, toIso } from "../dates/today";

// Resolves what the seller said about the ready date, in code, from today in Europe/London
// (spec §12.4). The result is always read back with its weekday for confirmation.
// "next Thursday" = the first Thursday after today. Unrecognised → null (the bot asks again).

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthIndex(word: string): number {
  return MONTHS.findIndex((m) => word.startsWith(m)) + 1;
}

/** How far back a day + month with no year is still read as this year (then flagged as past). */
const RECENT_PAST_DAYS = 90;

/**
 * Day + month, no year: the coming date — unless it fell in the last 90 days, in which case it's
 * this year's (and the bot says it's in the past) rather than silently jumping to next year.
 */
function dayMonthOnly(d: number, m: number, today: string): string | null {
  const y = Number(today.slice(0, 4));
  if (!isRealDate(y, m, d)) return isRealDate(y + 1, m, d) ? toIso(y + 1, m, d) : null;
  const thisYear = toIso(y, m, d);
  if (thisYear >= today) return thisYear;
  if (thisYear >= addDays(today, -RECENT_PAST_DAYS)) return thisYear;
  return isRealDate(y + 1, m, d) ? toIso(y + 1, m, d) : null;
}

export function resolveDate(said: string, today: string): string | null {
  const s = said.trim().toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").replace(/^(on|by|from) /, "").trim();
  if (s === "today") return today;
  if (s === "tomorrow") return addDays(today, 1);
  if (s === "day after tomorrow" || s === "the day after tomorrow") return addDays(today, 2);

  let m = /^in (\d+|a|one|two|three) (day|days|week|weeks)$/.exec(s);
  if (m) {
    const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3 };
    const n = words[m[1]] ?? Number(m[1]);
    return addDays(today, m[2].startsWith("week") ? n * 7 : n);
  }

  m = /^(?:(this|next|coming|this coming) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(s);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    let delta = (target - dayOfWeek(today) + 7) % 7;
    if (delta === 0) delta = m[1] ? 7 : 0; // bare "Thursday" on a Thursday = today
    return addDays(today, delta);
  }

  // Numeric, always day first: 05-11-2026, 5/11/2026, 5/11
  m = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?$/.exec(s);
  if (m) {
    const [d, mo] = [Number(m[1]), Number(m[2])];
    if (m[3]) return isRealDate(Number(m[3]), mo, d) ? toIso(Number(m[3]), mo, d) : null;
    return dayMonthOnly(d, mo, today);
  }

  // "5 November 2026", "5th Nov", "November 5th", "the 5th of November"
  m = /^(?:the )?(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)(?: (\d{4}))?$/.exec(s) ?? null;
  let d: number | null = null;
  let mo = 0;
  let y: number | null = null;
  if (m) {
    d = Number(m[1]);
    mo = monthIndex(m[2]);
    y = m[3] ? Number(m[3]) : null;
  } else {
    const m2 = /^([a-z]+) (?:the )?(\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s);
    if (m2) {
      d = Number(m2[2]);
      mo = monthIndex(m2[1]);
      y = m2[3] ? Number(m2[3]) : null;
    }
  }
  if (d !== null && mo > 0) {
    if (y !== null) return isRealDate(y, mo, d) ? toIso(y, mo, d) : null;
    return dayMonthOnly(d, mo, today);
  }

  // "the 5th" → this month if not past, else next month.
  m = /^(?:the )?(\d{1,2})(?:st|nd|rd|th)$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    for (let k = 0; k < 2; k++) {
      const mm = ((tm - 1 + k) % 12) + 1;
      const yy = ty + Math.floor((tm - 1 + k) / 12);
      if (isRealDate(yy, mm, day) && toIso(yy, mm, day) >= today) return toIso(yy, mm, day);
    }
    return null;
  }
  return null;
}
