import ExcelJS from "exceljs";
import Papa from "papaparse";

// A neutral cell model so .xlsx and .csv go through the same parsing (spec §5).

export type Cell =
  | { kind: "empty" }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  /** A real Excel date cell. ExcelJS gives a JS Date at UTC midnight; read UTC parts only. */
  | { kind: "date"; value: Date }
  | { kind: "bool"; value: boolean }
  /** A formula with no cached result: we never evaluate formulas (spec §5.3 rule 8). */
  | { kind: "formula_no_value"; formula: string }
  | { kind: "error"; value: string };

export interface RawSheet {
  /** Sheet name, or file name for a CSV. */
  name: string;
  file: string;
  /** rows[0] is spreadsheet row 1. */
  rows: Cell[][];
}

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export function isEmptyCell(c: Cell | undefined): boolean {
  return !c || c.kind === "empty" || (c.kind === "text" && c.value.trim() === "");
}

/** Exactly what was in the cell, as text, for display ("raw"). */
export function cellRaw(c: Cell | undefined): string | null {
  if (!c) return null;
  switch (c.kind) {
    case "empty":
      return null;
    case "number":
      return String(c.value);
    case "text":
      return c.value === "" ? null : c.value;
    case "date": {
      const d = c.value;
      return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
    }
    case "bool":
      return c.value ? "TRUE" : "FALSE";
    case "formula_no_value":
      return `=${c.formula}`;
    case "error":
      return c.value;
  }
}

function fromExcelValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return { kind: "empty" };
  if (typeof v === "number") return { kind: "number", value: v };
  if (typeof v === "string") return { kind: "text", value: v };
  if (typeof v === "boolean") return { kind: "bool", value: v };
  if (v instanceof Date) return { kind: "date", value: v };
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) {
      const f = v as ExcelJS.CellFormulaValue & { sharedFormula?: string };
      const result = f.result;
      if (result === undefined || result === null) return { kind: "formula_no_value", formula: f.formula ?? f.sharedFormula ?? "" };
      if (typeof result === "object" && !(result instanceof Date) && "error" in result) return { kind: "error", value: String(result.error) };
      return fromExcelValue(result as ExcelJS.CellValue);
    }
    if ("richText" in v) return { kind: "text", value: v.richText.map((r) => r.text).join("") };
    if ("text" in v && typeof (v as { text: unknown }).text === "string") return { kind: "text", value: (v as { text: string }).text };
    if ("error" in v) return { kind: "error", value: String(v.error) };
  }
  return { kind: "text", value: String(v) };
}

export async function readXlsx(file: string, bytes: Uint8Array): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS reads the data only; it never runs macros. Its typings predate the Buffer generic.
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    const last = ws.actualRowCount === 0 ? 0 : ws.rowCount;
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      const width = Math.max(row.cellCount, 0);
      for (let c = 1; c <= width; c++) cells.push(fromExcelValue(row.getCell(c).value));
      rows.push(cells);
    }
    sheets.push({ name: ws.name, file, rows });
  });
  return sheets;
}

export function readCsv(file: string, text: string): RawSheet {
  const clean = text.replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(clean, { header: false, skipEmptyLines: false });
  const rows = parsed.data.map((r) => r.map((v): Cell => (v === "" ? { kind: "empty" } : { kind: "text", value: v })));
  return { name: file, file, rows };
}

export type FileKind = "xlsx" | "csv";

/** Checks the real file signature, not just the extension (spec §17.2). */
export function detectFileKind(name: string, bytes: Uint8Array): { kind: FileKind } | { error: string } {
  const lower = name.toLowerCase();
  if (bytes.byteLength > MAX_FILE_BYTES) return { error: `${name} is larger than 4 MB.` };
  if (lower.endsWith(".xlsm") || lower.endsWith(".xls")) return { error: `${name}: .xlsm and .xls files aren't accepted. Save it as .xlsx or .csv.` };
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (lower.endsWith(".xlsx")) {
    if (!isZip) return { error: `${name} isn't a real .xlsx file.` };
    // Zip entry names are stored uncompressed, so a macro project is visible in the raw bytes.
    const ascii = Buffer.from(bytes).toString("latin1");
    if (ascii.includes("vbaProject.bin") || /macroEnabled/i.test(ascii)) {
      return { error: `${name} contains macros. Save it as a plain .xlsx (no macros) or .csv.` };
    }
    return { kind: "xlsx" };
  }
  if (lower.endsWith(".csv")) {
    if (isZip) return { error: `${name} looks like a spreadsheet, not a CSV. Rename it .xlsx or export it as CSV.` };
    if (bytes.includes(0)) return { error: `${name} isn't a text CSV file.` };
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { error: `${name} isn't UTF-8 text. Export it as "CSV UTF-8".` };
    }
    return { kind: "csv" };
  }
  return { error: `${name}: only .xlsx and .csv files are accepted.` };
}
