// Fixed reference data (spec §2.1). Never read from uploads; never overridable.

export const ORIGIN_COUNTRY = "United Kingdom" as const;

// Manchester stays allowed: the judges' "Allowed values" sheet lists it and their test data may
// use it. It's left out of examples and hints only (product owner, 26 Oct 2026).
export const ORIGIN_CITIES = ["London", "Manchester", "Birmingham", "Leeds"] as const;
export type OriginCity = (typeof ORIGIN_CITIES)[number];

export const DESTINATION_COUNTRIES = ["Germany", "France", "Netherlands"] as const;
export type DestinationCountry = (typeof DESTINATION_COUNTRIES)[number];

export const DESTINATION_CITIES_BY_COUNTRY = {
  Germany: ["Berlin", "Frankfurt", "Hamburg"],
  France: ["Paris", "Lyon"],
  Netherlands: ["Amsterdam", "Rotterdam"],
} as const satisfies Record<DestinationCountry, readonly string[]>;

export const DESTINATION_CITIES = [
  "Berlin",
  "Frankfurt",
  "Hamburg",
  "Paris",
  "Lyon",
  "Amsterdam",
  "Rotterdam",
] as const;
export type DestinationCity = (typeof DESTINATION_CITIES)[number];

export const CURRENCIES = ["GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ITEM_ORIGIN_COUNTRIES = [
  "United Kingdom",
  "China",
  "India",
  "Vietnam",
  "Turkey",
  "Germany",
] as const;
export type ItemOriginCountry = (typeof ITEM_ORIGIN_COUNTRIES)[number];

export const DESTINATION_TYPES = ["Warehouse", "Business address"] as const;
export type DestinationType = (typeof DESTINATION_TYPES)[number];

export const PRIORITIES = ["Cheapest", "Fastest", "Most reliable", "Balanced"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const YES_NO = ["Yes", "No"] as const;
export type YesNo = (typeof YES_NO)[number];

/** The single country every destination city belongs to. */
export function countryOfCity(city: DestinationCity): DestinationCountry {
  for (const country of DESTINATION_COUNTRIES) {
    if ((DESTINATION_CITIES_BY_COUNTRY[country] as readonly string[]).includes(city)) return country;
  }
  throw new Error(`Unknown destination city: ${city}`);
}

/** ISO country codes used for public-holiday lookups (spec §11). */
export const HOLIDAY_COUNTRY_CODE: Record<DestinationCountry | "United Kingdom", string> = {
  "United Kingdom": "GB",
  Germany: "DE",
  France: "FR",
  Netherlands: "NL",
};

/** Regional holiday subdivision per city; null = national holidays only (spec §11.2). */
export const HOLIDAY_SUBDIVISION_BY_CITY: Record<DestinationCity, string | null> = {
  Berlin: "DE-BE",
  Frankfurt: "DE-HE",
  Hamburg: "DE-HH",
  Paris: null,
  Lyon: null,
  Amsterdam: null,
  Rotterdam: null,
};

/** The UK holidays that apply are England's (spec §11.3). */
export const UK_HOLIDAY_SUBDIVISION = "GB-ENG";
