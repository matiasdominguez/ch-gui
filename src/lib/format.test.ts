import { describe, expect, it } from "vitest";

import { formatBytes, formatCount } from "./format";

describe("formatBytes", () => {
  it("returns em-dash for null and undefined so loading vs zero don't alias", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("uses the right unit at each 1024 boundary", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.00 GB");
    expect(formatBytes(1024 ** 4)).toBe("1.00 TB");
  });

  it("keeps KB at 1 decimal and GB/TB at 2", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1.25 * 1024 ** 3)).toBe("1.25 GB");
    expect(formatBytes(1.5 * 1024 ** 4)).toBe("1.50 TB");
  });
});

describe("formatCount", () => {
  it("returns em-dash for null / undefined", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
  });

  it("switches units at 1000 / 1M / 1B", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1.0k");
    expect(formatCount(1_500)).toBe("1.5k");
    expect(formatCount(1_000_000)).toBe("1.00M");
    expect(formatCount(2_500_000)).toBe("2.50M");
    expect(formatCount(1_000_000_000)).toBe("1.00B");
  });
});
