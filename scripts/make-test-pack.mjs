// Builds samples/test-pack/Bookings.xlsx and Items.xlsx: two separate files (tests the two-file
// upload), each with a title row, a template example row, and planted issues covering every rule.
// Run: node scripts/make-test-pack.mjs   — expected results: samples/test-pack/README.md
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const OUT = "samples/test-pack";
mkdirSync(OUT, { recursive: true });

// Bookings: an extra "Notes" column (should be ignored with a warning).
const B = ["Booking ID", "Seller name", "Origin", "Destination", "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value", "Currency", "Total gross weight (kg)", "Delivery appointment booked", "Notes"];
// Items: columns deliberately reordered (SKU first) — mapping is by header name.
const I = ["SKU", "Booking ID", "Description", "HS code", "Quantity", "Unit price", "Units per carton", "Cartons", "Unit weight (kg)", "Country of origin"];

const bookings = [
  ["BK-001", "Northfield Goods", "Manchester, United Kingdom", "Frankfurt, Germany", "Warehouse", "05-11-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes", "template example → skipped"],
  ["T-01", "Clean Co", "London, United Kingdom", "Hamburg, Germany", "Business address", new Date(Date.UTC(2026, 10, 12)), "Balanced", 2, 40, 960, "GBP", 300, null, "clean; real Excel date; Balanced"],
  ["T-02", "Typo Traders", "Leeds, United Kingdom", "Paris, France", "Warehouse", "10-11-2026", "Cheapest", 3, 90, 5400, "GBP", 1000, "Yes", "quantity 1800 (digits swapped)"],
  ["T-03", "Carton Count Ltd", "Manchester, United Kingdom", "Frankfurt, Germany", "Warehouse", "11-11-2026", "Cheapest", 3, 100, 5400, "GBP", 620, "Yes", "booking cartons 100 vs 90"],
  ["T-04", "Blank Fields Ltd", "Birmingham, United Kingdom", "Amsterdam, Netherlands", "Business address", "16-11-2026", "Most reliable", 1, 30, 650, "GBP", 150, null, "HS blank, origin blank, HS lost leading zero"],
  ["T-05", "Heavy Haul", "Manchester, United Kingdom", "Berlin, Germany", "Business address", "09-11-2026", "Fastest", 4, 100, 12000, "GBP", 1800, null, "Fastest pick C over weight"],
  ["T-06", "Stone & Co", "Leeds, United Kingdom", "Lyon, France", "Business address", "13-11-2026", "Cheapest", 3, 30, 3000, "GBP", 2400, null, "800 kg/pallet: no carrier"],
  ["T-07", "Gadget Hub", "London, United Kingdom", "Rotterdam, Netherlands", "Business address", "11-11-2026", "Cheapest", 1, 25, 700, "GBP", 120, null, "dangerous goods"],
  ["T-08", "Light Weight Ltd", "Manchester, United Kingdom", "Frankfurt, Germany", "Warehouse", "12-11-2026", "Cheapest", 3, 90, 5400, "GBP", 400, "Yes", "gross below product weight"],
  ["T-09", "Late Larry", "Birmingham, United Kingdom", "Frankfurt, Germany", "Warehouse", "01-10-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "No", "past date + no appointment"],
  ["T-10", "Messy Data", "London, United Kingdom", "Hamburg, Germany", "Business address", "12-11-2026", null, 2.5, 90, 5400, "EUR", 620, null, "fractional pallets, EUR, no priority"],
  ["T-11", "Text Numbers", "Leeds, United Kingdom", "Hamburg, Germany", "Business address", "5/11/2026", "Cheapest", "3", " 90 ", "5400 GBP", "GBP", "620", null, "numbers typed as text; D/M/YYYY"],
  ["T-12", "Mixed Up", "London, United Kingdom", "Paris, Germany", "Business address", "12-11-2026", "Cheapest", 3, 91, 5400, "GBP", 620, null, "Info only"],
  ["T-13", "Twin One", "London, United Kingdom", "Berlin, Germany", "Business address", "12-11-2026", "Cheapest", 2, 40, 960, "GBP", 300, null, "duplicate ID"],
  [" t-13 ", "Twin Two", "Leeds, United Kingdom", "Hamburg, Germany", "Business address", "12-11-2026", "Cheapest", 2, 40, 960, "GBP", 300, null, "duplicate ID"],
  ["T-14", "Date Dan", "Manchester, United Kingdom", "Amsterdam, Netherlands", "Business address", "31-02-2026", "Fastest", 3, 90, 5400, "GBP", 620, null, "impossible date"],
  ["T-15", "Formula Fran", "London, United Kingdom", "Paris, France", "Business address", "12-11-2026", "Cheapest", 3, { formula: "45*2" }, 5400, "GBP", 620, null, "formula with no saved value"],
];

const mug = (id, overrides = {}) => {
  const base = { SKU: "MUG-01", "Booking ID": id, Description: "Ceramic coffee mug, 350 ml", "HS code": "691200", Quantity: 1080, "Unit price": 5, "Units per carton": 12, Cartons: 90, "Unit weight (kg)": 0.5, "Country of origin": "United Kingdom" };
  return { ...base, ...overrides };
};
const items = [
  mug("BK-001"), // template example item → skipped
  { SKU: "TEE-01", "Booking ID": "T-01", Description: "Cotton t-shirt", "HS code": "610910", Quantity: 480, "Unit price": 2, "Units per carton": 12, Cartons: 40, "Unit weight (kg)": 0.2, "Country of origin": "India" },
  mug("T-02", { Quantity: 1800 }),
  mug("T-03"),
  { SKU: "CAN-01", "Booking ID": "T-04", Description: "Soy wax candle", "HS code": null, Quantity: 200, "Unit price": 2, "Units per carton": 10, Cartons: 20, "Unit weight (kg)": 0.4, "Country of origin": null },
  { SKU: "COF-01", "Booking ID": "T-04", Description: "Roasted coffee beans, 1 kg", "HS code": 90121, Quantity: 10, "Unit price": 25, "Units per carton": 1, Cartons: 10, "Unit weight (kg)": 1, "Country of origin": "Vietnam" },
  { SKU: "TILE-01", "Booking ID": "T-05", Description: "Ceramic floor tile", "HS code": "690721", Quantity: 2400, "Unit price": 5, "Units per carton": 24, Cartons: 100, "Unit weight (kg)": 0.6, "Country of origin": "Turkey" },
  { SKU: "SLAB-01", "Booking ID": "T-06", Description: "Granite worktop slab", "HS code": "680223", Quantity: 30, "Unit price": 100, "Units per carton": 1, Cartons: 30, "Unit weight (kg)": 70, "Country of origin": "India" },
  { SKU: "PB-01", "Booking ID": "T-07", Description: "Portable power bank 10000mAh", "HS code": "850760", Quantity: 100, "Unit price": 3, "Units per carton": 10, Cartons: 10, "Unit weight (kg)": 0.3, "Country of origin": "China" },
  { SKU: "CH-01", "Booking ID": "T-07", Description: "Portable charger", "HS code": "850760", Quantity: 100, "Unit price": 2, "Units per carton": 10, Cartons: 10, "Unit weight (kg)": 0.2, "Country of origin": "China" },
  { SKU: "TR-01", "Booking ID": "T-07", Description: "Torch, batteries not included", "HS code": "851310", Quantity: 50, "Unit price": 4, "Units per carton": 10, Cartons: 5, "Unit weight (kg)": 0.2, "Country of origin": "China" },
  mug("T-08"),
  mug("T-09"),
  mug("T-10"),
  mug("t-11", { Quantity: "1,080", "Unit price": "£5.00", "HS code": "6912.00" }),
  mug("T-12", { Quantity: 540, Cartons: 45 }),
  mug("T-12", { Quantity: 540, Cartons: 45 }),
  { SKU: "FREE-01", "Booking ID": "T-12", Description: "Promotional leaflet", "HS code": "491110", Quantity: 100, "Unit price": 0, "Units per carton": 100, Cartons: 1, "Unit weight (kg)": 0.01, "Country of origin": "United Kingdom" },
  { SKU: "TEE-01", "Booking ID": "T-13", Description: "Cotton t-shirt", "HS code": "610910", Quantity: 480, "Unit price": 2, "Units per carton": 12, Cartons: 40, "Unit weight (kg)": 0.2, "Country of origin": "India" },
  mug("T-14"),
  mug("T-15"),
  mug("T-99", { SKU: "LOST-01", Description: "Orphan item" }),
];

async function write(file, sheet, headers, rows, title) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow([title]);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(Array.isArray(r) ? r : headers.map((h) => r[h] ?? null));
  await wb.xlsx.writeFile(`${OUT}/${file}`);
}

await write("Bookings.xlsx", "Bookings", B, bookings, "PreFlight test pack — Bookings. One row per booking. Planted issues for testing.");
await write("Items.xlsx", "Items", I, items, "PreFlight test pack — Items. One row per product line.");
console.log(`wrote ${OUT}/Bookings.xlsx and ${OUT}/Items.xlsx`);
