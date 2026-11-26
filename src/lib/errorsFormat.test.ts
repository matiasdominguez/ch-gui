import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MvFailure } from "../types";

import {
  formatLocalClock,
  formatRelativeOrShort,
  groupByView,
  parseUtcTime,
} from "./errorsFormat";

const NOW = new Date("2026-04-20T12:00:00Z").getTime();

function mvRow(event_time: string, view_name: string): MvFailure {
  return {
    event_time,
    view_name,
    view_type: "Materialized",
    status: "ExceptionWhileProcessing",
    exception: "some error",
    initial_query_id: "qid",
    initial_query: "INSERT INTO t SELECT 1",
    recent: false,
  };
}

describe("formatRelativeOrShort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for under a minute', () => {
    expect(formatRelativeOrShort("2026-04-20 11:59:30")).toBe("just now");
  });

  it("returns Xm ago for minute-scale", () => {
    expect(formatRelativeOrShort("2026-04-20 11:45:00")).toBe("15m ago");
    expect(formatRelativeOrShort("2026-04-20 11:01:00")).toBe("59m ago");
  });

  it("returns Xh ago for hour-scale within a day", () => {
    expect(formatRelativeOrShort("2026-04-20 09:00:00")).toBe("3h ago");
    expect(formatRelativeOrShort("2026-04-19 13:00:00")).toBe("23h ago");
  });

  it("returns Xd ago within a week", () => {
    expect(formatRelativeOrShort("2026-04-19 12:00:00")).toBe("1d ago");
    expect(formatRelativeOrShort("2026-04-14 12:00:00")).toBe("6d ago");
  });

  it("falls through to Mon DD (no year) at ≥7 days", () => {
    // The date text depends on the runner's locale, so check its structure.
    const out = formatRelativeOrShort("2026-04-10 12:00:00");
    expect(out).not.toMatch(/ago/);
    expect(out).not.toMatch(/2026/);
  });

  it("accepts ISO strings with explicit Z", () => {
    expect(formatRelativeOrShort("2026-04-20T11:30:00Z")).toBe("30m ago");
  });

  it("passes through empty input", () => {
    expect(formatRelativeOrShort("")).toBe("");
  });

  it("passes the raw string through on unparseable input", () => {
    expect(formatRelativeOrShort("not a date")).toBe("not a date");
  });
});

describe("groupByView", () => {
  it("returns empty for empty input", () => {
    expect(groupByView([])).toEqual([]);
  });

  it("groups rows by view_name with correct counts", () => {
    const rows = [
      mvRow("2026-04-20 10:00:00", "db.view_a"),
      mvRow("2026-04-20 11:00:00", "db.view_a"),
      mvRow("2026-04-20 09:00:00", "db.view_b"),
    ];
    const groups = groupByView(rows);
    const a = groups.find((g) => g.view_name === "db.view_a")!;
    const b = groups.find((g) => g.view_name === "db.view_b")!;
    expect(a.count).toBe(2);
    expect(b.count).toBe(1);
    expect(a.all).toHaveLength(2);
  });

  it("keeps the latest row as group.latest", () => {
    const rows = [
      mvRow("2026-04-20 10:00:00", "db.view_a"),
      mvRow("2026-04-20 11:00:00", "db.view_a"),
    ];
    const [g] = groupByView(rows);
    expect(g.latest.event_time).toBe("2026-04-20 11:00:00");
  });

  it("orders groups by their latest event_time descending", () => {
    const rows = [
      mvRow("2026-04-20 09:00:00", "db.view_old"),
      mvRow("2026-04-20 11:00:00", "db.view_new"),
    ];
    const groups = groupByView(rows);
    expect(groups.map((g) => g.view_name)).toEqual([
      "db.view_new",
      "db.view_old",
    ]);
  });
});

describe("groupByView recent flag", () => {
  it("marks a view new when any of its failures is new", () => {
    const [g] = groupByView([
      mvRow("2026-04-20 11:00:00", "db.v"),
      { ...mvRow("2026-04-20 11:59:00", "db.v"), recent: true },
    ]);
    expect(g.recent).toBe(true);
  });
});

describe("parseUtcTime", () => {
  it("reads server log times with microseconds and an offset", () => {
    expect(
      parseUtcTime("2026-10-06T08:00:39.123456+00:00")?.toISOString(),
    ).toBe("2026-10-06T08:00:39.123Z");
    expect(parseUtcTime("2026-10-06 08:00:39")?.toISOString()).toBe(
      "2026-10-06T08:00:39.000Z",
    );
    expect(parseUtcTime("nope")).toBeNull();
  });

  it("formats a log time as local clock time with milliseconds", () => {
    const d = new Date("2026-10-06T08:00:39.123Z");
    const p = (n: number) => String(n).padStart(2, "0");
    expect(formatLocalClock("2026-10-06T08:00:39.123456+00:00")).toBe(
      `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.123`,
    );
    expect(formatLocalClock("2026-10-06T08:00:39+00:00")).toBe(
      `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    );
  });
});
