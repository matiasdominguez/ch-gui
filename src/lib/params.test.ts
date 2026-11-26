import { describe, expect, it } from "vitest";

import { extractParams, inferKind, substituteParams } from "./params";

describe("extractParams", () => {
  it("returns unique specs in first-appearance order", () => {
    expect(extractParams("SELECT {a}, {b}, {a}, {c}")).toEqual([
      { name: "a", kind: "text" },
      { name: "b", kind: "text" },
      { name: "c", kind: "text" },
    ]);
  });

  it("returns empty when no placeholders are present", () => {
    expect(extractParams("SELECT 1")).toEqual([]);
  });

  it("extracts identifiers with underscores and digits", () => {
    expect(extractParams("WHERE x = {start_date_1}")).toEqual([
      { name: "start_date_1", kind: "text" },
    ]);
  });

  it("matches placeholders even inside string literals (documented behavior)", () => {
    expect(extractParams("SELECT 'hello {name}'")).toEqual([
      { name: "name", kind: "text" },
    ]);
  });

  it("ignores tokens without braces", () => {
    expect(extractParams("SELECT foo, bar")).toEqual([]);
  });

  it("applies the date heuristic to `_date` and `_at` suffixes", () => {
    expect(
      extractParams("WHERE a = {start_date} AND b = {created_at}"),
    ).toEqual([
      { name: "start_date", kind: "date" },
      { name: "created_at", kind: "date" },
    ]);
  });

  it("applies the number heuristic to `_id`, `_count`, `limit`, `offset`", () => {
    expect(
      extractParams(
        "SELECT {user_id}, {row_count} FROM t LIMIT {limit} OFFSET {offset}",
      ),
    ).toEqual([
      { name: "user_id", kind: "number" },
      { name: "row_count", kind: "number" },
      { name: "limit", kind: "number" },
      { name: "offset", kind: "number" },
    ]);
  });

  it("respects sigils over heuristics", () => {
    expect(extractParams("SELECT {@count}, {#date}")).toEqual([
      { name: "count", kind: "date" },
      { name: "date", kind: "number" },
    ]);
  });

  it("sigil kind is kept for duplicate placeholders (first wins)", () => {
    expect(extractParams("{@d} AND {d}")).toEqual([
      { name: "d", kind: "date" },
    ]);
  });
});

describe("inferKind", () => {
  it.each([
    ["@", "anything", "date"],
    ["#", "anything", "number"],
    ["", "start_date", "date"],
    ["", "date", "date"],
    ["", "created_at", "date"],
    ["", "from", "date"],
    ["", "to", "date"],
    ["", "user_id", "number"],
    ["", "row_count", "number"],
    ["", "n", "number"],
    ["", "count", "number"],
    ["", "limit", "number"],
    ["", "offset", "number"],
    ["", "name", "text"],
    ["", "query", "text"],
    ["", "status", "text"],
  ])("inferKind(%j, %j) → %s", (sigil, name, expected) => {
    expect(inferKind(sigil, name)).toBe(expected);
  });
});

describe("substituteParams", () => {
  it("replaces text placeholders verbatim", () => {
    expect(substituteParams("SELECT {name}", { name: "'alice'" })).toBe(
      "SELECT 'alice'",
    );
  });

  it("replaces number placeholders without adding quotes", () => {
    expect(substituteParams("LIMIT {#n}", { n: "42" })).toBe("LIMIT 42");
  });

  it("wraps date placeholders in single quotes", () => {
    expect(
      substituteParams("WHERE d = {@start}", { start: "2026-04-01" }),
    ).toBe("WHERE d = '2026-04-01'");
  });

  it("passes pre-quoted date values through unchanged", () => {
    expect(
      substituteParams("WHERE d = {@start}", {
        start: "toDate('2026-04-01')",
      }),
    ).toBe("WHERE d = toDate('2026-04-01')");
  });

  it("leaves missing keys untouched so the server error surfaces", () => {
    expect(substituteParams("SELECT {#a}, {b}", { a: "1" })).toBe(
      "SELECT 1, {b}",
    );
  });

  it("replaces every occurrence", () => {
    expect(
      substituteParams("SELECT {d} FROM t WHERE x = {d}", { d: "US" }),
    ).toBe("SELECT 'US' FROM t WHERE x = 'US'");
  });

  it("returns the source string when there are no placeholders", () => {
    expect(substituteParams("SELECT 1", { ignored: "x" })).toBe("SELECT 1");
  });

  it("accepts an explicit specs argument", () => {
    expect(
      substituteParams("SELECT {limit}", { limit: "10" }, [
        { name: "limit", kind: "number" },
      ]),
    ).toBe("SELECT 10");
  });
});

describe("text parameters", () => {
  it("quote and escape the value", () => {
    expect(
      substituteParams("WHERE country = {country}", { country: "US" }),
    ).toBe("WHERE country = 'US'");
    expect(substituteParams("WHERE name = {who}", { who: "O'Brien" })).toBe(
      "WHERE name = 'O\\'Brien'",
    );
    expect(substituteParams("WHERE p = {path}", { path: "C:\\tmp" })).toBe(
      "WHERE p = 'C:\\\\tmp'",
    );
  });

  it("pass a value through when it already starts with a quote", () => {
    expect(
      substituteParams("WHERE c IN ({countries})", { countries: "'US','CA'" }),
    ).toBe("WHERE c IN ('US','CA')");
  });

  it("escape but don't re-quote inside a quoted string", () => {
    expect(
      substituteParams("WHERE country = '{country}'", { country: "US" }),
    ).toBe("WHERE country = 'US'");
    expect(substituteParams("WHERE n = '{who}'", { who: "O'Brien" })).toBe(
      "WHERE n = 'O\\'Brien'",
    );
    expect(
      substituteParams("WHERE d = '{@from}'", { from: "2026-01-01" }),
    ).toBe("WHERE d = '2026-01-01'");
  });

  it("go in verbatim inside a quoted identifier", () => {
    expect(substituteParams('SELECT "{col}" FROM t', { col: "total" })).toBe(
      'SELECT "total" FROM t',
    );
  });
});

describe("raw parameters", () => {
  it("insert the value as SQL", () => {
    expect(extractParams("ORDER BY {!sort}")).toEqual([
      { name: "sort", kind: "raw" },
    ]);
    expect(substituteParams("ORDER BY {!sort} DESC", { sort: "revenue" })).toBe(
      "ORDER BY revenue DESC",
    );
  });
});

describe("placeholders that aren't parameters", () => {
  it("ignore regex quantifiers", () => {
    expect(extractParams("WHERE match(s, '\\d{3}-\\d{2,4}')")).toEqual([]);
  });

  it("ignore comments", () => {
    const sql = "SELECT 1 -- {todo}\n/* {later} */ # {note}\nWHERE x = {x}";
    expect(extractParams(sql)).toEqual([{ name: "x", kind: "text" }]);
    expect(
      substituteParams(sql, { x: "a", todo: "b", later: "c", note: "d" }),
    ).toBe("SELECT 1 -- {todo}\n/* {later} */ # {note}\nWHERE x = 'a'");
  });

  it("leave server-side {name:Type} parameters alone", () => {
    expect(extractParams("WHERE id = {id:UInt64}")).toEqual([]);
  });

  it("still read a {#n} number sigil, not a # comment", () => {
    expect(extractParams("LIMIT {#n}")).toEqual([
      { name: "n", kind: "number" },
    ]);
  });
});
