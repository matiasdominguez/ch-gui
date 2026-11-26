import type { CellValue, ColumnMeta } from "../types";

export function cellToString(cell: CellValue): string {
  switch (cell.t) {
    case "Null":
      return "";
    case "Int":
    case "Float":
      return String(cell.v);
    case "BigInt":
    case "Decimal":
    case "Str":
    case "DateTime":
    case "Other":
      return cell.v;
  }
}

function escapeCsv(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(columns: ColumnMeta[], rows: CellValue[][]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsv(c.name)).join(","));
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsv(cellToString(cell))).join(","));
  }
  return lines.join("\n");
}

function escapeTsv(s: string): string {
  return s.replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/** Spreadsheets read quoted fields on paste. File export keeps `rowsToTsv`'s
 * backslash escapes, which ClickHouse's TabSeparated format reads. */
export function rowsToClipboardTsv(
  columns: ColumnMeta[],
  rows: CellValue[][],
): string {
  const field = (s: string) =>
    /[\t\r\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = [columns.map((c) => field(c.name)).join("\t")];
  for (const row of rows) {
    lines.push(row.map((cell) => field(cellToString(cell))).join("\t"));
  }
  return lines.join("\n");
}

export function rowsToTsv(columns: ColumnMeta[], rows: CellValue[][]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeTsv(c.name)).join("\t"));
  for (const row of rows) {
    lines.push(row.map((cell) => escapeTsv(cellToString(cell))).join("\t"));
  }
  return lines.join("\n");
}

function escapeMarkdown(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

export function rowsToMarkdown(
  columns: ColumnMeta[],
  rows: CellValue[][],
): string {
  const lines: string[] = [];
  lines.push(`| ${columns.map((c) => escapeMarkdown(c.name)).join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(
      `| ${row.map((cell) => escapeMarkdown(cellToString(cell))).join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

function isNumericToken(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s);
}

function jsonScalar(cell: CellValue): string {
  switch (cell.t) {
    case "Null":
      return "null";
    case "Int":
    case "Float":
      return JSON.stringify(cell.v);
    case "BigInt":
    case "Decimal":
      return isNumericToken(cell.v) ? cell.v : JSON.stringify(cell.v);
    default:
      return JSON.stringify(cell.v);
  }
}

function jsonObject(columns: ColumnMeta[], row: CellValue[]): string {
  const fields = columns.map(
    (c, i) => `${JSON.stringify(c.name)}: ${jsonScalar(row[i])}`,
  );
  return `{${fields.join(", ")}}`;
}

export function rowsToJson(columns: ColumnMeta[], rows: CellValue[][]): string {
  if (rows.length === 0) return "[]";
  return `[\n${rows.map((r) => `  ${jsonObject(columns, r)}`).join(",\n")}\n]`;
}

export function rowsToJsonLines(
  columns: ColumnMeta[],
  rows: CellValue[][],
): string {
  return rows.map((r) => jsonObject(columns, r)).join("\n");
}

// ClickHouse honors C-style backslash escapes inside single quotes.
function sqlString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function sqlLiteral(cell: CellValue): string {
  switch (cell.t) {
    case "Null":
      return "NULL";
    case "Int":
    case "Float":
      return String(cell.v);
    case "BigInt":
    case "Decimal":
      return isNumericToken(cell.v) ? cell.v : sqlString(cell.v);
    // klickhouse displays arrays, tuples, and maps as SQL literals, which are
    // valid in VALUES position.
    case "Other":
      return cell.v;
    default:
      return sqlString(cell.v);
  }
}

export function rowsToSqlValues(rows: CellValue[][]): string {
  return rows.map((r) => `(${r.map(sqlLiteral).join(", ")})`).join(",\n");
}

function pyString(s: string): string {
  return `'${s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}'`;
}

function pyLiteral(cell: CellValue): string {
  switch (cell.t) {
    case "Null":
      return "None";
    case "Int":
    case "Float":
      return String(cell.v);
    case "BigInt":
    case "Decimal":
      return isNumericToken(cell.v) ? cell.v : pyString(cell.v);
    default:
      return pyString(cell.v);
  }
}

export function rowsToPythonList(
  columns: ColumnMeta[],
  rows: CellValue[][],
): string {
  if (rows.length === 0) return "[]";
  const lines = rows.map((r) => {
    const fields = columns.map(
      (c, i) => `${pyString(c.name)}: ${pyLiteral(r[i])}`,
    );
    return `    {${fields.join(", ")}},`;
  });
  return `[\n${lines.join("\n")}\n]`;
}

export type ExportFormat = "csv" | "tsv" | "jsonl";

export function downloadTextFile(
  filename: string,
  content: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
