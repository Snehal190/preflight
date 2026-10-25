import { z } from "zod";

// Public holidays from Nager.Date (spec §11.3). Network access is injected so the date maths stays
// pure and testable; the database cache (lib/db) wraps a HolidayFetcher.

const NagerHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localName: z.string().nullable().optional(),
  name: z.string(),
  global: z.boolean(),
  counties: z.array(z.string()).nullable(),
  types: z.array(z.string()).optional(),
});
export const NagerResponseSchema = z.array(NagerHolidaySchema);
export type NagerHoliday = z.infer<typeof NagerHolidaySchema>;

/** Returns the year's holidays for a country, or null when the service is unavailable. */
export type HolidayFetcher = (year: number, countryCode: string) => Promise<NagerHoliday[] | null>;

const TIMEOUT_MS = 5000;

export const fetchNagerYear: HolidayFetcher = async (year, countryCode) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const parsed = NagerResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Only days off count: e.g. NL lists Good Friday as an observance, not a public holiday. */
const DAY_OFF_TYPES = new Set(["Public", "Bank"]);

/** Holidays that apply to a region: national ones plus those listing the subdivision. */
export function holidaysFor(list: NagerHoliday[], subdivision: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of list) {
    if (h.types && !h.types.some((t) => DAY_OFF_TYPES.has(t))) continue;
    if (h.global || (subdivision !== null && (h.counties ?? []).includes(subdivision))) out.set(h.date, h.name);
  }
  return out;
}

/** Holiday map for the given years, or null if any year couldn't be loaded. */
export async function loadHolidays(fetcher: HolidayFetcher, countryCode: string, subdivision: string | null, years: number[]): Promise<Map<string, string> | null> {
  const merged = new Map<string, string>();
  for (const y of [...new Set(years)].sort()) {
    const list = await fetcher(y, countryCode);
    if (!list) return null;
    for (const [d, n] of holidaysFor(list, subdivision)) merged.set(d, n);
  }
  return merged;
}
