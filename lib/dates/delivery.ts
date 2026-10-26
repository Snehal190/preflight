import type { AssumptionId } from "../reference/assumptions";
import {
  HOLIDAY_COUNTRY_CODE,
  HOLIDAY_SUBDIVISION_BY_CITY,
  UK_HOLIDAY_SUBDIVISION,
  type DestinationCity,
  type DestinationCountry,
} from "../reference/allowed";
import { fmtDateLong } from "../format";
import { addDays, dayOfWeek } from "./today";
import { loadHolidays, type HolidayFetcher } from "./holidays";

// Collection and delivery dates (spec §11). ASSUMPTION A2: transit counts working days.

export interface HolidaySets {
  /** England's holidays, or null when the holiday service was unavailable. */
  uk: Map<string, string> | null;
  /** Destination country (+ region) holidays, or null when unavailable. */
  destination: Map<string, string> | null;
}

export interface DeliveryDates {
  collection: string;
  delivery: string;
  /** Plain-English notes: moves, skipped holidays. */
  notes: string[];
  /** Always A2; A8 when holidays couldn't be checked. */
  assumptions: AssumptionId[];
}

function isWeekend(iso: string): boolean {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
}

function reasonNotWorking(iso: string, holidays: (Map<string, string> | null)[], labels: string[]): string | null {
  if (isWeekend(iso)) return "weekend";
  for (let i = 0; i < holidays.length; i++) {
    const name = holidays[i]?.get(iso);
    if (name) return `${name} (${labels[i]})`;
  }
  return null;
}

export function computeDeliveryDates(input: {
  readyDate: string;
  today: string;
  transitDays: number;
  holidays: HolidaySets;
  destinationLabel: string;
}): DeliveryDates {
  const { readyDate, today, transitDays, holidays, destinationLabel } = input;
  const notes: string[] = [];
  const assumptions: AssumptionId[] = ["A2"];
  const holidaysChecked = holidays.uk !== null && holidays.destination !== null;
  if (!holidaysChecked) assumptions.push("A8");

  // Collection: England's working days only.
  const collectionBlockers = [holidays.uk];
  let start = readyDate;
  if (readyDate < today) {
    start = today;
    notes.push(`Your ready date ${fmtDateLong(readyDate)} has passed, so collection is planned from today, ${fmtDateLong(today)}, or the next working day.`);
  }
  let collection = start;
  for (let guard = 0; guard < 60; guard++) {
    const why = reasonNotWorking(collection, collectionBlockers, ["UK"]);
    if (!why) break;
    collection = addDays(collection, 1);
  }
  if (collection !== start) {
    notes.push(`Collection moved from ${fmtDateLong(start)} to ${fmtDateLong(collection)}: ${reasonNotWorking(start, collectionBlockers, ["UK"])}${skippedBetween(start, collection, collectionBlockers, ["UK"])}.`);
  }

  // Delivery: N working days, skipping weekends and holidays in England or the destination.
  const blockers = [holidays.uk, holidays.destination];
  const labels = ["UK", destinationLabel];
  let day = collection;
  let counted = 0;
  const skipped: string[] = [];
  while (counted < transitDays) {
    day = addDays(day, 1);
    const why = reasonNotWorking(day, blockers, labels);
    if (why === null) counted++;
    else if (why !== "weekend") skipped.push(`${fmtDateLong(day)}, ${why}`);
  }
  if (skipped.length) notes.push(`Public holidays skipped: ${skipped.join("; ")}.`);
  return { collection, delivery: day, notes, assumptions };
}

function skippedBetween(from: string, to: string, blockers: (Map<string, string> | null)[], labels: string[]): string {
  const extra: string[] = [];
  for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) {
    const why = reasonNotWorking(d, blockers, labels);
    if (why && why !== "weekend") extra.push(`${fmtDateLong(d)}, ${why}`);
  }
  return extra.length ? `; also ${extra.join("; ")}` : "";
}

/** Loads the holiday sets a booking needs (current year and the next, to cover year end). */
export async function holidaySetsFor(
  fetcher: HolidayFetcher,
  destinationCountry: DestinationCountry,
  destinationCity: DestinationCity | null,
  fromIso: string,
): Promise<HolidaySets> {
  const y = Number(fromIso.slice(0, 4));
  const years = [y, y + 1];
  // A city in the wrong country (A5) contributes no region.
  const sub = destinationCity ? HOLIDAY_SUBDIVISION_BY_CITY[destinationCity] : null;
  const regional = sub && sub.startsWith(`${HOLIDAY_COUNTRY_CODE[destinationCountry]}-`) ? sub : null;
  const [uk, destination] = await Promise.all([
    loadHolidays(fetcher, HOLIDAY_COUNTRY_CODE["United Kingdom"], UK_HOLIDAY_SUBDIVISION, years),
    loadHolidays(fetcher, HOLIDAY_COUNTRY_CODE[destinationCountry], regional, years),
  ]);
  return { uk, destination };
}
