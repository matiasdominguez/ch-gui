import { describe, expect, it } from "vitest";

import { detectLeadingKeyword, isExplain } from "./sqlKind";

describe("detectLeadingKeyword", () => {
  it("returns the first keyword uppercased", () => {
    expect(detectLeadingKeyword("SELECT 1")).toBe("SELECT");
    expect(detectLeadingKeyword("select 1")).toBe("SELECT");
  });

  it("skips leading whitespace", () => {
    expect(detectLeadingKeyword("   EXPLAIN SELECT 1")).toBe("EXPLAIN");
    expect(detectLeadingKeyword("\n\n\tEXPLAIN …")).toBe("EXPLAIN");
  });

  it("skips line comments", () => {
    expect(detectLeadingKeyword("-- a leading note\nEXPLAIN SELECT 1")).toBe(
      "EXPLAIN",
    );
    expect(detectLeadingKeyword("# hash comment\nEXPLAIN 1")).toBe("EXPLAIN");
  });

  it("skips block comments (non-nesting)", () => {
    expect(detectLeadingKeyword("/* block */ EXPLAIN SELECT 1")).toBe(
      "EXPLAIN",
    );
    expect(detectLeadingKeyword("/* multi\n line */\nEXPLAIN SELECT 1")).toBe(
      "EXPLAIN",
    );
  });

  it("skips multiple comment forms interleaved with whitespace", () => {
    expect(detectLeadingKeyword("  -- l1\n/* b */\n   # l2\nEXPLAIN x")).toBe(
      "EXPLAIN",
    );
  });

  it("returns null on empty / whitespace / comments-only buffers", () => {
    expect(detectLeadingKeyword("")).toBeNull();
    expect(detectLeadingKeyword("   ")).toBeNull();
    expect(detectLeadingKeyword("-- only a comment\n")).toBeNull();
  });
});

describe("isExplain", () => {
  it("is true for EXPLAIN variants regardless of case", () => {
    expect(isExplain("EXPLAIN SELECT 1")).toBe(true);
    expect(isExplain("explain pipeline SELECT 1")).toBe(true);
    expect(isExplain("  -- comment\n  EXPLAIN estimate SELECT 1")).toBe(true);
  });

  it("is false for SELECT with string literal containing 'explain'", () => {
    expect(isExplain("SELECT 'explain' AS foo")).toBe(false);
  });

  it("is false for subqueries that happen to embed EXPLAIN", () => {
    expect(isExplain("SELECT * FROM (EXPLAIN SELECT 1)")).toBe(false);
  });
});
