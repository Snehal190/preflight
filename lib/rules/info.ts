import { countryOfCity } from "../reference/allowed";
import type { Booking } from "../types";
import { input, itemName, itemScope, BOOKING_SCOPE } from "./helpers";
import type { CheckContext } from "./context";
import type { CheckResult, CheckScope } from "./types";

// Info tier (spec §8): advice only, never changes a booking's status.

export function infoResult(
  key: string,
  scope: CheckScope,
  partial: Pick<CheckResult, "found" | "shouldBe" | "fix" | "why"> & Partial<Pick<CheckResult, "assumptions">>,
): CheckResult {
  return {
    id: `INFO:${key}`,
    ruleId: "INFO",
    title: "Info: advice, not a rule",
    status: "fail",
    severity: "info",
    scope,
    whyItMatters: "",
    ...partial,
  };
}

export function bookingInfo(b: Booking, ctx: CheckContext): CheckResult[] {
  const out: CheckResult[] = [];

  // City doesn't belong to the destination country → price on the country (A5).
  const city = b.destinationCity.value;
  const country = b.destinationCountry.value;
  if (city && country && countryOfCity(city) !== country) {
    out.push(
      infoResult("city-country", BOOKING_SCOPE, {
        found: `${city} is in ${countryOfCity(city)}, but the country says ${country}.`,
        shouldBe: `A destination city in ${country}, or the country ${countryOfCity(city)}.`,
        fix: { text: "Correct the city or the country." },
        why: {
          formula: "Destination city must belong to the destination country",
          inputs: [input("Destination city", b.destinationCity), input("Destination country", b.destinationCountry)],
          result: `Route priced on ${country}`,
        },
        assumptions: ["A5"],
      }),
    );
  }

  // Same SKU twice in one booking.
  const bySku = new Map<string, typeof b.items>();
  for (const it of b.items) {
    const sku = it.sku.value?.trim().toUpperCase();
    if (!sku) continue;
    bySku.set(sku, [...(bySku.get(sku) ?? []), it]);
  }
  for (const [, its] of bySku) {
    if (its.length < 2) continue;
    const rows = its.map((it) => (it.sku.location?.kind === "cell" ? it.sku.location.row : null));
    const where = rows.every((r) => r !== null) ? ` (rows ${rows.slice(0, -1).join(", ")} and ${rows.at(-1)})` : "";
    const name = itemName(its[0]);
    out.push(
      infoResult(`dup-sku:${name}`, BOOKING_SCOPE, {
        found: `${name} appears ${its.length === 2 ? "twice" : `${its.length} times`}${where}.`,
        shouldBe: "Each SKU listed once per booking.",
        fix: { text: "Check this isn't a duplicate." },
        why: { formula: "Count of items with the same SKU", inputs: its.map((it) => input("SKU", it.sku)), result: `${its.length} lines` },
      }),
    );
  }

  // Unit price of £0.
  for (const it of b.items) {
    if (it.unitPrice.value !== null && Number(it.unitPrice.value) === 0) {
      out.push(
        infoResult(`zero-price:${it.itemId}`, itemScope(it), {
          found: `${itemName(it)} has a unit price of £0.`,
          shouldBe: "A real unit price.",
          fix: { text: "Customs will query goods declared as free. Enter the real price if there is one." },
          why: { formula: "Unit price > £0", inputs: [input("Unit price", it.unitPrice)], result: "£0" },
        }),
      );
    }
  }

  // Dangerous-goods check ran on keywords only.
  const ai = ctx.dgAi;
  const aiMissing = !ai || !ai.available || b.items.some((it) => !ai.byItemId[it.itemId]);
  if (b.items.length > 0 && aiMissing) {
    out.push(
      infoResult("dg-keywords-only", BOOKING_SCOPE, {
        found: "Dangerous-goods check ran on keywords only (AI unavailable).",
        shouldBe: "Keywords, AI review and HS hints.",
        fix: { text: "Double-check that no item contains a lithium battery, an aerosol or a flammable liquid." },
        why: { formula: "R-06 layers run", inputs: [], result: "Keywords + HS hints only" },
      }),
    );
  }

  return out;
}
