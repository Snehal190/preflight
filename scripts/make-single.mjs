// samples/test-pack/single-booking.xlsx: one booking with a planted quantity typo (1,800 vs 12 × 90)
// and no delivery slot — for trying the upload → verify → fix → carrier flow.
import ExcelJS from "exceljs";
const B = ["Booking ID", "Seller name", "Origin", "Destination", "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value", "Currency", "Total gross weight (kg)", "Delivery appointment booked"];
const I = ["Booking ID", "SKU", "Description", "HS code", "Quantity", "Unit price", "Units per carton", "Cartons", "Unit weight (kg)", "Country of origin"];
const wb = new ExcelJS.Workbook();
const b = wb.addWorksheet("Bookings");
b.addRow(["One booking for trying PreFlight."]);
b.addRow(B);
b.addRow(["BK-201", "Harbour Home Goods", "Birmingham, United Kingdom", "Hamburg, Germany", "Warehouse", "16-11-2026", "Cheapest", 2, 90, 6480, "GBP", 900, "No"]);
const i = wb.addWorksheet("Items");
i.addRow(["Product lines."]);
i.addRow(I);
i.addRow(["BK-201", "PLATE-01", "Ceramic dinner plate", "691200", 1800, 6, 12, 90, 0.8, "China"]);
await wb.xlsx.writeFile("samples/test-pack/single-booking.xlsx");
console.log("wrote samples/test-pack/single-booking.xlsx");
