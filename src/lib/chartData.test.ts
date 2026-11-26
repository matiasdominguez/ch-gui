import { describe, expect, it } from "vitest";

import type { CellValue, QueryResult } from "../types";
import { chartPoints, defaultY, xIsUnique } from "./chartData";

const s = (v: string): CellValue => ({ t: "Str", v });
const n = (v: number): CellValue => ({ t: "Int", v });
const NULL: CellValue = { t: "Null" };

const EVENTS: QueryResult = {
  columns: [
    { name: "id", type: "UInt64" },
    { name: "kind", type: "String" },
    { name: "amount", type: "Float64" },
  ],
  rows: [
    [n(1), s("buy"), n(10)],
    [n(2), s("sell"), n(5)],
    [n(3), s("buy"), NULL],
    [n(4), s("buy"), n(2)],
  ],
  stats: { rows: 4, elapsed_ms: 1 },
};

describe("chartPoints", () => {
  it("counts rows per x value, in first-seen order", () => {
    expect(chartPoints(EVENTS, "kind", null)).toEqual([
      { x: "buy", y: 3 },
      { x: "sell", y: 1 },
    ]);
  });

  it("sums y per x value and skips NULL cells", () => {
    expect(chartPoints(EVENTS, "kind", "amount")).toEqual([
      { x: "buy", y: 12 },
      { x: "sell", y: 5 },
    ]);
  });

  it("drops an x value whose y cells are all NULL", () => {
    expect(chartPoints(EVENTS, "id", "amount").map((p) => p.x)).toEqual([
      1, 2, 4,
    ]);
  });

  it("drops a total that overflows", () => {
    const huge: QueryResult = {
      ...EVENTS,
      rows: [
        [n(1), s("buy"), { t: "Float", v: 1e308 }],
        [n(2), s("buy"), { t: "Float", v: 1e308 }],
        [n(3), s("sell"), n(5)],
      ],
    };
    expect(chartPoints(huge, "kind", "amount")).toEqual([{ x: "sell", y: 5 }]);
  });

  it("returns nothing for an unknown column", () => {
    expect(chartPoints(EVENTS, "kind", "nope")).toEqual([]);
  });
});

describe("defaultY", () => {
  it("counts rows when x repeats, whatever its type", () => {
    expect(defaultY("kind", ["id", "amount"], false)).toBeNull();
    expect(defaultY("day", ["id"], false)).toBeNull();
  });

  it("keeps the metric when each x appears once", () => {
    expect(defaultY("kind", ["n"], true)).toBe("n");
  });

  it("counts rows when x is the only numeric column", () => {
    expect(defaultY("id", ["id"], true)).toBeNull();
  });
});

describe("xIsUnique", () => {
  it("tells repeated x values from unique ones", () => {
    expect(xIsUnique(EVENTS, "kind")).toBe(false);
    expect(xIsUnique(EVENTS, "id")).toBe(true);
  });
});
