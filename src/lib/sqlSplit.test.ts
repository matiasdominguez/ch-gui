import { describe, expect, it } from "vitest";

import {
  splitStatements,
  splitStatementsWithRanges,
  statementAtOffset,
} from "./sqlSplit";

describe("splitStatements", () => {
  it("returns a single statement when there are no semicolons", () => {
    expect(splitStatements("SELECT 1")).toEqual(["SELECT 1"]);
  });

  it("splits on top-level semicolons and trims", () => {
    expect(splitStatements("SELECT 1; SELECT 2;")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside single-quoted strings", () => {
    expect(splitStatements("SELECT 'a; b'; SELECT 2")).toEqual([
      "SELECT 'a; b'",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside line comments", () => {
    expect(
      splitStatements("SELECT 1 -- comment; not a split\n; SELECT 2"),
    ).toEqual(["SELECT 1 -- comment; not a split", "SELECT 2"]);
  });

  it("ignores semicolons inside block comments", () => {
    expect(
      splitStatements("SELECT 1 /* ; still same stmt */ ; SELECT 2"),
    ).toEqual(["SELECT 1 /* ; still same stmt */", "SELECT 2"]);
  });

  it("passes `{param}` tokens through unchanged", () => {
    expect(splitStatements("SELECT {a}; SELECT {b}")).toEqual([
      "SELECT {a}",
      "SELECT {b}",
    ]);
  });

  it("drops empty statements produced by trailing semicolons", () => {
    expect(splitStatements(";;SELECT 1;;")).toEqual(["SELECT 1"]);
  });

  it("returns empty on an empty input", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("   \n  ")).toEqual([]);
  });
});

describe("splitStatementsWithRanges", () => {
  const sliceMatches = (sql: string) => {
    for (const s of splitStatementsWithRanges(sql)) {
      expect(sql.slice(s.start, s.end)).toBe(s.text);
    }
  };

  it("reports the offsets of a single statement", () => {
    expect(splitStatementsWithRanges("SELECT 1")).toEqual([
      { text: "SELECT 1", start: 0, end: 8 },
    ]);
  });

  it("reports trimmed offsets for each statement in a batch", () => {
    expect(splitStatementsWithRanges("SELECT 1; SELECT 2")).toEqual([
      { text: "SELECT 1", start: 0, end: 8 },
      { text: "SELECT 2", start: 10, end: 18 },
    ]);
  });

  it("excludes surrounding whitespace from the range", () => {
    expect(splitStatementsWithRanges("  SELECT 1  ")).toEqual([
      { text: "SELECT 1", start: 2, end: 10 },
    ]);
  });

  it("keeps offsets correct across strings and comments", () => {
    const sql = "SELECT 'a; b'; SELECT 2";
    expect(splitStatementsWithRanges(sql)).toEqual([
      { text: "SELECT 'a; b'", start: 0, end: 13 },
      { text: "SELECT 2", start: 15, end: 23 },
    ]);
    sliceMatches(sql);
  });

  it("drops empty statements but keeps the surviving offsets", () => {
    expect(splitStatementsWithRanges(";;SELECT 1;;")).toEqual([
      { text: "SELECT 1", start: 2, end: 10 },
    ]);
  });

  it("returns empty for blank input", () => {
    expect(splitStatementsWithRanges("")).toEqual([]);
    expect(splitStatementsWithRanges("   \n ")).toEqual([]);
  });

  it("stays consistent with splitStatements", () => {
    const sql = "SELECT 1; SELECT 'x;y'; -- c\nSELECT 3";
    expect(splitStatementsWithRanges(sql).map((s) => s.text)).toEqual(
      splitStatements(sql),
    );
    sliceMatches(sql);
  });
});

describe("statementAtOffset", () => {
  const sql = "SELECT 1; SELECT 2";
  const stmt0 = { text: "SELECT 1", start: 0, end: 8 };
  const stmt1 = { text: "SELECT 2", start: 10, end: 18 };

  it("returns the statement the caret sits inside", () => {
    expect(statementAtOffset(sql, 3)).toEqual(stmt0);
    expect(statementAtOffset(sql, 14)).toEqual(stmt1);
  });

  it("maps the caret at the start of a statement to that statement", () => {
    expect(statementAtOffset(sql, 0)).toEqual(stmt0);
    expect(statementAtOffset(sql, 10)).toEqual(stmt1);
  });

  it("attributes inter-statement whitespace to the following statement", () => {
    const s = "SELECT 1;\n\nSELECT 2";
    expect(statementAtOffset(s, 10)?.text).toBe("SELECT 2");
  });

  it("maps trailing whitespace after the last ; to the last statement", () => {
    expect(statementAtOffset("SELECT 1;  ", 10)).toEqual(stmt0);
  });

  it("returns null when there are no statements", () => {
    expect(statementAtOffset("", 0)).toBeNull();
    expect(statementAtOffset("   ", 1)).toBeNull();
  });
});
