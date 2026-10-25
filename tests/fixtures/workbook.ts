import ExcelJS from "exceljs";

// Builds template-shaped workbooks in memory: a title sentence in row 1, headers in row 2.

export const BOOKING_HEADERS = [
  "Booking ID",
  "Seller name",
  "Origin",
  "Destination",
  "Destination type",
  "Ready to ship date",
  "Seller priority",
  "Pallets",
  "Cartons",
  "Total declared value",
  "Currency",
  "Total gross weight (kg)",
  "Delivery appointment booked",
];

export const ITEM_HEADERS = [
  "Booking ID",
  "SKU",
  "Description",
  "HS code",
  "Quantity",
  "Unit price",
  "Units per carton",
  "Cartons",
  "Unit weight (kg)",
  "Country of origin",
];

export type Row = ExcelJS.CellValue[];

export const EXAMPLE_BOOKING: Row = ["BK-001", "Northfield Goods", "Manchester, United Kingdom", "Frankfurt, Germany", "Warehouse", "05-11-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"];
export const EXAMPLE_ITEM: Row = ["BK-001", "MUG-01", "Ceramic coffee mug, 350 ml", "691200", 1080, 5, 12, 90, 0.5, "United Kingdom"];

export function bookingRow(overrides: Partial<Record<string, ExcelJS.CellValue>>, base: Row = EXAMPLE_BOOKING): Row {
  return BOOKING_HEADERS.map((h, i) => (h in overrides ? overrides[h]! : base[i]));
}

export function itemRow(overrides: Partial<Record<string, ExcelJS.CellValue>>, base: Row = EXAMPLE_ITEM): Row {
  return ITEM_HEADERS.map((h, i) => (h in overrides ? overrides[h]! : base[i]));
}

export interface SheetSpec {
  name: string;
  headers: string[];
  rows: Row[];
  title?: string | null;
  /** Rows of nothing inserted after the data (like the template's dropdowns to row 500). */
  trailingEmpty?: number;
}

export async function workbook(...sheets: SheetSpec[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    if (s.title !== null) ws.addRow([s.title ?? "Fill in one row per booking. Do not change the headers."]);
    ws.addRow(s.headers);
    for (const r of s.rows) ws.addRow(r);
    if (s.trailingEmpty) {
      const start = ws.rowCount + 1;
      for (let i = 0; i < s.trailingEmpty; i++) {
        ws.getCell(start + i, 5).dataValidation = { type: "list", allowBlank: true, formulae: ['"Warehouse,Business address"'] };
      }
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export function bookingsSheet(rows: Row[], extra: Partial<SheetSpec> = {}): SheetSpec {
  return { name: "Bookings", headers: BOOKING_HEADERS, rows, ...extra };
}

export function itemsSheet(rows: Row[], extra: Partial<SheetSpec> = {}): SheetSpec {
  return { name: "Items", headers: ITEM_HEADERS, rows, ...extra };
}
