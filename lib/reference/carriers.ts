import type { DestinationCountry } from "./allowed";

// Carrier rate card (spec §2.2). Prices are GBP per pallet, kept as decimal strings.
// Carrier logic must stay generic: nothing elsewhere may rely on which carrier is cheapest etc.

export type CarrierId = "A" | "B" | "C";

export interface Carrier {
  id: CarrierId;
  name: string;
  service: string;
  pricePerPallet: Record<DestinationCountry, string>;
  transitDays: number;
  onTimePct: number;
  maxKgPerPallet: number;
}

export const CARRIERS: readonly Carrier[] = [
  {
    id: "A",
    name: "Carrier A",
    service: "Road economy",
    pricePerPallet: { Germany: "180", France: "170", Netherlands: "160" },
    transitDays: 5,
    onTimePct: 92,
    maxKgPerPallet: 500,
  },
  {
    id: "B",
    name: "Carrier B",
    service: "Road standard",
    pricePerPallet: { Germany: "220", France: "210", Netherlands: "200" },
    transitDays: 3,
    onTimePct: 95,
    maxKgPerPallet: 750,
  },
  {
    id: "C",
    name: "Carrier C",
    service: "Road express",
    pricePerPallet: { Germany: "340", France: "330", Netherlands: "320" },
    transitDays: 2,
    onTimePct: 98,
    maxKgPerPallet: 400,
  },
];

export const CARRIER_IDS = CARRIERS.map((c) => c.id);

export function carrierById(id: CarrierId): Carrier {
  const c = CARRIERS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown carrier: ${id}`);
  return c;
}
