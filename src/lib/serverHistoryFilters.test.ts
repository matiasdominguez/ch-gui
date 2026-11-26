import { describe, expect, it } from "vitest";

import {
  filterSummary,
  uiToBackendFilters,
  type ServerHistoryFilterUi,
} from "./serverHistoryFilters";

const blank: ServerHistoryFilterUi = {
  min_duration_s: "",
  min_memory_mb: "",
  exception_only: false,
};

describe("uiToBackendFilters", () => {
  it("produces an empty object when nothing is set", () => {
    expect(uiToBackendFilters(blank)).toEqual({});
  });

  it("converts seconds to ms and MB to bytes", () => {
    expect(
      uiToBackendFilters({
        min_duration_s: 2.5,
        min_memory_mb: 10,
        exception_only: false,
      }),
    ).toEqual({
      min_duration_ms: 2500,
      min_memory_bytes: 10 * 1024 * 1024,
    });
  });

  it("treats 0 and negatives as 'no filter' on both axes", () => {
    expect(
      uiToBackendFilters({
        min_duration_s: 0,
        min_memory_mb: -5,
        exception_only: false,
      }),
    ).toEqual({});
  });

  it("rounds fractional results so the backend gets an integer", () => {
    const result = uiToBackendFilters({
      min_duration_s: 0.3333,
      min_memory_mb: 1.5,
      exception_only: false,
    });
    expect(result.min_duration_ms).toBe(333);
    expect(Number.isInteger(result.min_duration_ms)).toBe(true);
    expect(result.min_memory_bytes).toBe(1_572_864);
  });

  it("passes exception_only through only when true", () => {
    expect(uiToBackendFilters({ ...blank, exception_only: true })).toEqual({
      exception_only: true,
    });
    expect(uiToBackendFilters({ ...blank, exception_only: false })).toEqual({});
  });
});

describe("filterSummary", () => {
  it("returns null when nothing is active", () => {
    expect(filterSummary(blank, false)).toBeNull();
  });

  it("joins active filters with middle dots in the UI's original units", () => {
    expect(
      filterSummary(
        {
          min_duration_s: 5,
          min_memory_mb: 100,
          exception_only: true,
        },
        false,
      ),
    ).toBe("≥5s · ≥100MB · errors");
  });

  it("adds 'grouped' only when grouped=true", () => {
    expect(filterSummary(blank, true)).toBe("grouped");
    expect(filterSummary({ ...blank, exception_only: true }, true)).toBe(
      "errors · grouped",
    );
  });

  it("skips zero / empty values so they don't show in the header", () => {
    expect(
      filterSummary(
        { min_duration_s: 0, min_memory_mb: "", exception_only: false },
        false,
      ),
    ).toBeNull();
  });
});
