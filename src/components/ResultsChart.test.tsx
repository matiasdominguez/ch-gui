import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import type { QueryResult } from "../types";
import { columnShape } from "../lib/chartData";
import { ResultsChart } from "./ResultsChart";

const RESULT: QueryResult = {
  columns: [
    { name: "kind", type: "String" },
    { name: "n", type: "UInt64" },
  ],
  rows: [
    [
      { t: "Str", v: "buy" },
      { t: "Int", v: 3 },
    ],
  ],
  stats: { rows: 1, elapsed_ms: 1, read_rows: 0, read_bytes: 0 },
} as unknown as QueryResult;
const CHART = { type: "bar" as const, xCol: null, yCol: null };

describe("ResultsChart", () => {
  it("says when it charts a capped result", () => {
    const { getByText } = renderWithProviders(
      <ResultsChart capped result={RESULT} chart={CHART} onChange={() => {}} />,
    );
    expect(getByText("First 10,000 rows only")).toBeTruthy();
  });

  it("says nothing extra for a complete result", () => {
    const { queryByText } = renderWithProviders(
      <ResultsChart result={RESULT} chart={CHART} onChange={() => {}} />,
    );
    expect(queryByText("First 10,000 rows only")).toBeNull();
  });

  it("counts rows per category on a raw result", () => {
    const raw = {
      ...RESULT,
      columns: [
        { name: "id", type: "UInt64" },
        { name: "kind", type: "String" },
      ],
      rows: [
        [
          { t: "Int", v: 1 },
          { t: "Str", v: "buy" },
        ],
        [
          { t: "Int", v: 2 },
          { t: "Str", v: "buy" },
        ],
      ],
    } as unknown as QueryResult;
    const { getByLabelText } = renderWithProviders(
      <ResultsChart result={raw} chart={CHART} onChange={() => {}} />,
    );
    const y = getByLabelText("Y axis column") as HTMLSelectElement;
    expect(y.selectedOptions[0].textContent).toBe("y: count of rows");
    expect([...y.options].map((o) => o.textContent)).toEqual([
      "y: count of rows",
      "y: sum of id",
    ]);
  });

  it("keeps the metric column as y on an aggregated result", () => {
    const { getByLabelText } = renderWithProviders(
      <ResultsChart result={RESULT} chart={CHART} onChange={() => {}} />,
    );
    const y = getByLabelText("Y axis column") as HTMLSelectElement;
    expect(y.selectedOptions[0].textContent).toBe("y: n");
  });

  it("says summed bars are totals from a capped sample", () => {
    const raw = {
      ...RESULT,
      rows: [RESULT.rows[0], RESULT.rows[0]],
    } as QueryResult;
    const { getByText } = renderWithProviders(
      <ResultsChart capped result={raw} chart={CHART} onChange={() => {}} />,
    );
    expect(getByText("Totals from the first 10,000 rows only")).toBeTruthy();
  });

  it("keeps a column apart from the count, whatever its name", () => {
    const onChange = vi.fn();
    const named = {
      ...RESULT,
      columns: [
        { name: "kind", type: "String" },
        { name: "count", type: "UInt64" },
      ],
    } as QueryResult;
    const { getByLabelText } = renderWithProviders(
      <ResultsChart result={named} chart={CHART} onChange={onChange} />,
    );
    const y = getByLabelText("Y axis column") as HTMLSelectElement;
    fireEvent.change(y, { target: { value: "col:count" } });
    expect(onChange).toHaveBeenLastCalledWith({ yCount: null, yCol: "count" });
    fireEvent.change(y, { target: { value: "count" } });
    expect(onChange).toHaveBeenLastCalledWith({
      yCount: columnShape(named),
      yCol: null,
    });
  });

  it("drops a count pick when the result's columns change", () => {
    const other = {
      ...RESULT,
      columns: [
        { name: "kind", type: "String" },
        { name: "total", type: "UInt64" },
      ],
    } as QueryResult;
    const { getByLabelText } = renderWithProviders(
      <ResultsChart
        result={other}
        chart={{ ...CHART, yCount: columnShape(RESULT) }}
        onChange={() => {}}
      />,
    );
    const y = getByLabelText("Y axis column") as HTMLSelectElement;
    expect(y.selectedOptions[0].textContent).toBe("y: total");
  });
});
