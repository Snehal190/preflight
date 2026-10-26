// Builds samples/planted-mistakes.xlsx: template-shaped (title row, headers in row 2) with one
// known mistake per booking, for manual testing of the upload path. Run: node scripts/make-samples.mjs
import ExcelJS from "exceljs";

const B = ["Booking ID", "Seller name", "Origin", "Destination", "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value", "Currency", "Total gross weight (kg)", "Delivery appointment booked"];
const I = ["Booking ID", "SKU", "Description", "HS code", "Quantity", "Unit price", "Units per carton", "Cartons", "Unit weight (kg)", "Country of origin"];

const bookings = [
  ["BK-001", "Northfield Goods", "Manchester, United Kingdom", "Frankfurt, Germany", "Warehouse", "05-11-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"], // template example → skipped
  ["BK-101", "Clean Co", "London, United Kingdom", "Hamburg, Germany", "Business address", "12-11-2026", "Balanced", 2, 40, 960, "GBP", 300, ""], // clean
  ["BK-102", "Typo Traders", "Leeds, United Kingdom", "Paris, France", "Warehouse", "10-11-2026", "Cheapest", 3, 90, 5400, "GBP", 1000, "Yes"], // quantity 1800 (swap)
  ["BK-103", "Blank Fields Ltd", "Birmingham, United Kingdom", "Amsterdam, Netherlands", "Warehouse", "16-11-2026", "Most reliable", 1, 20, 400, "GBP", 150, "No"], // HS blank, origin blank, no appt
  ["BK-104", "Heavy Haul", "Leeds, United Kingdom", "Berlin, Germany", "Business address", "09-11-2026", "Fastest", 4, 100, 12000, "GBP", 1800, ""], // C over weight → B
  ["BK-105", "Gadget Hub", "London, United Kingdom", "Rotterdam, Netherlands", "Business address", "11-11-2026", "Cheapest", 1, 20, 500, "GBP", 120, ""], // power bank + portable charger
  ["BK-106", "Stone & Co", "Leeds, United Kingdom", "Lyon, France", "Business address", "13-11-2026", "Cheapest", 3, 30, 3000, "GBP", 2400, ""], // 800 kg/pallet
  ["BK-107", "Late Larry", "Birmingham, United Kingdom", "Frankfurt, Germany", "Warehouse", "01-10-2026", "Cheapest", 3, 100, 5400, "GBP", 620, "Yes"], // cartons 100 vs 90, past date
  ["BK-108", "Mixed Up", "London, United Kingdom", "Paris, Germany", "Business address", "12-11-2026", "", 2, 40, 960, "GBP", 300, ""], // city/country, no priority
  ["BK-109", "Twin One", "London, United Kingdom", "Berlin, Germany", "Business address", "12-11-2026", "Cheapest", 2, 40, 960, "GBP", 300, ""], // duplicate ID
  ["bk-109", "Twin Two", "Leeds, United Kingdom", "Hamburg, Germany", "Business address", "12-11-2026", "Cheapest", 2, 40, 960, "GBP", 300, ""], // duplicate ID
  ["BK-110", "Date Dan", "Leeds, United Kingdom", "Amsterdam, Netherlands", "Business address", "31-02-2026", "Fastest", 1, 10, 250, "GBP", 80, ""], // impossible date, HS lost zero
];
const items = [
  ["BK-001", "MUG-01", "Ceramic coffee mug, 350 ml", "691200", 1080, 5, 12, 90, 0.5, "United Kingdom"],
  ["BK-101", "TEE-01", "Cotton t-shirt", "610910", 480, 2, 12, 40, 0.2, "India"],
  ["BK-102", "MUG-01", "Ceramic coffee mug, 350 ml", "691200", 1800, 5, 12, 90, 0.5, "United Kingdom"],
  ["BK-103", "CAN-01", "Soy wax candle", "", 200, 2, 10, 20, 0.4, ""],
  ["BK-104", "TILE-01", "Ceramic floor tile", "690721", 2400, 5, 24, 100, 0.6, "Turkey"],
  ["BK-105", "PB-01", "Portable power bank 10000mAh", "850760", 100, 3, 10, 10, 0.3, "China"],
  ["BK-105", "CH-01", "Portable charger", "850760", 100, 2, 10, 10, 0.2, "China"],
  ["BK-106", "SLAB-01", "Granite worktop slab", "680223", 30, 100, 1, 30, 70, "India"],
  ["BK-107", "MUG-01", "Ceramic coffee mug, 350 ml", "691200", 1080, 5, 12, 90, 0.5, "United Kingdom"],
  ["BK-108", "TEE-01", "Cotton t-shirt", "610910", 480, 2, 12, 40, 0.2, "Vietnam"],
  ["BK-109", "TEE-01", "Cotton t-shirt", "610910", 480, 2, 12, 40, 0.2, "India"],
  ["BK-110", "COF-01", "Roasted coffee beans, 1 kg", 90121, 10, 25, 1, 10, 1, "Vietnam"],
  ["BK-999", "LOST-01", "Orphan item", "691200", 10, 1, 10, 1, 1, "China"],
];

const wb = new ExcelJS.Workbook();
for (const [name, headers, rows] of [["Bookings", B, bookings], ["Items", I, items]]) {
  const ws = wb.addWorksheet(name);
  ws.addRow([`${name}: one row per ${name === "Bookings" ? "booking" : "item"}. Planted mistakes for testing.`]);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r.map((v) => (v === "" ? null : v)));
}
await wb.xlsx.writeFile("samples/planted-mistakes.xlsx");

const clean = new ExcelJS.Workbook();
for (const [name, headers, row] of [["Bookings", B, bookings[1]], ["Items", I, items[1]]]) {
  const ws = clean.addWorksheet(name);
  ws.addRow(["Clean example for testing."]);
  ws.addRow(headers);
  ws.addRow(row.map((v) => (v === "" ? null : v)));
}
await clean.xlsx.writeFile("samples/clean-booking.xlsx");
console.log("wrote samples/planted-mistakes.xlsx and samples/clean-booking.xlsx");
