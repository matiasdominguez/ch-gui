import { describe, expect, it } from "vitest";

import { columnsDiffer, computeSchemaDiff } from "./schemaDiff";
import type { ColumnDetail, TableDetails } from "../types";

function col(overrides: Partial<ColumnDetail> = {}): ColumnDetail {
  return {
    name: "c",
    type_str: "String",
    default_kind: "",
    default_expression: "",
    compression_codec: "",
    comment: "",
    ...overrides,
  };
}

function details(columns: ColumnDetail[]): TableDetails {
  return {
    database: "db",
    table: "t",
    engine: "MergeTree",
    engine_full: "MergeTree()",
    partition_key: "",
    sorting_key: "",
    primary_key: "",
    sampling_key: "",
    total_rows: 0,
    total_bytes: 0,
    comment: "",
    create_table_query: "",
    partitions: [],
    columns,
    skip_indexes: [],
    dependencies: [],
    projections: [],
  };
}

describe("columnsDiffer", () => {
  it("returns false for identical columns", () => {
    const a = col({ name: "id", type_str: "UInt64" });
    const b = col({ name: "id", type_str: "UInt64" });
    expect(columnsDiffer(a, b)).toBe(false);
  });

  it("flags type changes", () => {
    const a = col({ name: "id", type_str: "UInt64" });
    const b = col({ name: "id", type_str: "UInt32" });
    expect(columnsDiffer(a, b)).toBe(true);
  });

  it("treats String and LowCardinality(String) as different (strict by design)", () => {
    const a = col({ name: "country", type_str: "String" });
    const b = col({ name: "country", type_str: "LowCardinality(String)" });
    expect(columnsDiffer(a, b)).toBe(true);
  });

  it("flags default-kind changes even with matching expressions", () => {
    const a = col({ default_kind: "DEFAULT", default_expression: "0" });
    const b = col({ default_kind: "MATERIALIZED", default_expression: "0" });
    expect(columnsDiffer(a, b)).toBe(true);
  });

  it("flags codec changes", () => {
    const a = col({ compression_codec: "" });
    const b = col({ compression_codec: "CODEC(ZSTD(3))" });
    expect(columnsDiffer(a, b)).toBe(true);
  });

  it("ignores comment differences", () => {
    const a = col({ comment: "old doc" });
    const b = col({ comment: "new doc" });
    expect(columnsDiffer(a, b)).toBe(false);
  });
});

describe("computeSchemaDiff", () => {
  it("returns all-empty when both sides have no columns", () => {
    const diff = computeSchemaDiff(details([]), details([]));
    expect(diff.only_in_a).toEqual([]);
    expect(diff.only_in_b).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("returns all-empty for identical column sets", () => {
    const cols = [
      col({ name: "id", type_str: "UInt64" }),
      col({ name: "name", type_str: "String" }),
    ];
    const diff = computeSchemaDiff(details(cols), details(cols));
    expect(diff.only_in_a).toEqual([]);
    expect(diff.only_in_b).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("collects only_in_a for columns missing from B", () => {
    const a = details([
      col({ name: "id", type_str: "UInt64" }),
      col({ name: "dropped", type_str: "String" }),
    ]);
    const b = details([col({ name: "id", type_str: "UInt64" })]);
    const diff = computeSchemaDiff(a, b);
    expect(diff.only_in_a.map((c) => c.name)).toEqual(["dropped"]);
    expect(diff.only_in_b).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("collects only_in_b for columns missing from A", () => {
    const a = details([col({ name: "id", type_str: "UInt64" })]);
    const b = details([
      col({ name: "id", type_str: "UInt64" }),
      col({ name: "added", type_str: "String" }),
    ]);
    const diff = computeSchemaDiff(a, b);
    expect(diff.only_in_a).toEqual([]);
    expect(diff.only_in_b.map((c) => c.name)).toEqual(["added"]);
    expect(diff.changed).toEqual([]);
  });

  it("collects changed for columns with differing attributes", () => {
    const a = details([col({ name: "age", type_str: "UInt8" })]);
    const b = details([col({ name: "age", type_str: "UInt16" })]);
    const diff = computeSchemaDiff(a, b);
    expect(diff.only_in_a).toEqual([]);
    expect(diff.only_in_b).toEqual([]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.a.type_str).toBe("UInt8");
    expect(diff.changed[0]!.b.type_str).toBe("UInt16");
  });

  it("partitions a mixed diff into all three buckets", () => {
    const a = details([
      col({ name: "id", type_str: "UInt64" }),
      col({ name: "age", type_str: "UInt8" }),
      col({ name: "dropped", type_str: "String" }),
    ]);
    const b = details([
      col({ name: "id", type_str: "UInt64" }),
      col({ name: "age", type_str: "UInt16" }),
      col({ name: "added", type_str: "String" }),
    ]);
    const diff = computeSchemaDiff(a, b);
    expect(diff.only_in_a.map((c) => c.name)).toEqual(["dropped"]);
    expect(diff.only_in_b.map((c) => c.name)).toEqual(["added"]);
    expect(diff.changed.map((p) => p.a.name)).toEqual(["age"]);
  });

  it("ignores column position differences (matches by name)", () => {
    const a = details([
      col({ name: "id", type_str: "UInt64" }),
      col({ name: "name", type_str: "String" }),
    ]);
    const b = details([
      col({ name: "name", type_str: "String" }),
      col({ name: "id", type_str: "UInt64" }),
    ]);
    const diff = computeSchemaDiff(a, b);
    expect(diff.only_in_a).toEqual([]);
    expect(diff.only_in_b).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("reports changed alongside codec differences", () => {
    const a = details([col({ name: "body", compression_codec: "" })]);
    const b = details([
      col({ name: "body", compression_codec: "CODEC(ZSTD(3))" }),
    ]);
    const diff = computeSchemaDiff(a, b);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.a.compression_codec).toBe("");
    expect(diff.changed[0]!.b.compression_codec).toBe("CODEC(ZSTD(3))");
  });
});
