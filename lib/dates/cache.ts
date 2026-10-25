import { fetchNagerYear, type HolidayFetcher, type NagerHoliday } from "./holidays";

// In-process holiday cache (per year/country). The Neon holiday_cache table replaces this at step 9.
// Failures aren't cached, so a later request retries the service.

const memo = new Map<string, NagerHoliday[]>();

export function cachedFetcher(inner: HolidayFetcher = fetchNagerYear): HolidayFetcher {
  return async (year, cc) => {
    const key = `${cc}:${year}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const list = await inner(year, cc);
    if (list) memo.set(key, list);
    return list;
  };
}
