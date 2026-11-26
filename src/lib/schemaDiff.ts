import type { ColumnDetail, TableDetails } from "../types";

/** Matches columns by name and ignores their position on purpose. */
export interface SchemaDiff {
  only_in_a: ColumnDetail[];
  only_in_b: ColumnDetail[];
  changed: { a: ColumnDetail; b: ColumnDetail }[];
}

export function computeSchemaDiff(
  a: TableDetails,
  b: TableDetails,
): SchemaDiff {
  const byNameA = new Map(a.columns.map((c) => [c.name, c]));
  const byNameB = new Map(b.columns.map((c) => [c.name, c]));
  const only_in_a: ColumnDetail[] = [];
  const only_in_b: ColumnDetail[] = [];
  const changed: { a: ColumnDetail; b: ColumnDetail }[] = [];

  for (const col of a.columns) {
    const other = byNameB.get(col.name);
    if (!other) {
      only_in_a.push(col);
    } else if (columnsDiffer(col, other)) {
      changed.push({ a: col, b: other });
    }
  }
  for (const col of b.columns) {
    if (!byNameA.has(col.name)) only_in_b.push(col);
  }
  return { only_in_a, only_in_b, changed };
}

export function columnsDiffer(a: ColumnDetail, b: ColumnDetail): boolean {
  return (
    a.type_str !== b.type_str ||
    a.default_kind !== b.default_kind ||
    a.default_expression !== b.default_expression ||
    a.compression_codec !== b.compression_codec
  );
}
