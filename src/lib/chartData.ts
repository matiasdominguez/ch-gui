import type { CellValue, QueryResult } from "../types";

export interface ChartPoint {
  x: string | number | null;
  y: number;
}

function cellToX(cell: CellValue): string | number | null {
  return cell.t === "Null" ? null : cell.v;
}

function cellToY(cell: CellValue): number | null {
  switch (cell.t) {
    case "Int":
    case "Float":
      return cell.v;
    case "BigInt":
    case "Decimal": {
      const n = Number(cell.v);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return null;
  }
}

/** A Map keeps first-seen x order, which preserves the query's ORDER BY. */
export function chartPoints(
  { columns, rows }: QueryResult,
  xCol: string,
  yCol: string | null,
): ChartPoint[] {
  const xIdx = columns.findIndex((c) => c.name === xCol);
  const yIdx = yCol == null ? -1 : columns.findIndex((c) => c.name === yCol);
  if (xIdx < 0 || (yCol != null && yIdx < 0)) return [];
  const groups = new Map<string | number | null, number | null>();
  for (const row of rows) {
    const x = cellToX(row[xIdx]);
    const y = yIdx < 0 ? 1 : cellToY(row[yIdx]);
    const prev = groups.get(x) ?? null;
    groups.set(x, y == null ? prev : (prev ?? 0) + y);
  }
  const points: ChartPoint[] = [];
  // A sum of huge floats can reach Infinity, which the chart can't plot.
  for (const [x, y] of groups) {
    if (y != null && Number.isFinite(y)) points.push({ x, y });
  }
  return points;
}

export function columnShape({ columns }: QueryResult): string {
  return columns.map((c) => `${c.name}\u0000${c.type}`).join("\u0001");
}

export function xIsUnique(
  { columns, rows }: QueryResult,
  xCol: string,
): boolean {
  const xIdx = columns.findIndex((c) => c.name === xCol);
  const seen = new Set<string | number | null>();
  for (const row of rows) {
    const x = cellToX(row[xIdx]);
    if (seen.has(x)) return false;
    seen.add(x);
  }
  return true;
}

export function defaultY(
  xCol: string,
  numericCols: string[],
  unique: boolean,
): string | null {
  const first = numericCols.find((c) => c !== xCol);
  return first && unique ? first : null;
}
