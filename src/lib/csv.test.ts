import { describe, expect, it } from "vitest";

import type { CellValue, ColumnMeta } from "../types";
import {
  rowsToClipboardTsv,
  rowsToJson,
  rowsToJsonLines,
  rowsToMarkdown,
  rowsToPythonList,
  rowsToSqlValues,
} from "./csv";

const COLS: ColumnMeta[] = [
  { name: "id", type: "UInt32" },
  { name: "name", type: "String" },
];

describe("rowsToMarkdown", () => {
  it("builds a GitHub-flavored table: header, separator, rows", () => {
    const rows: CellValue[][] = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "a" },
      ],
      [
        { t: "Int", v: 2 },
        { t: "Str", v: "b" },
      ],
    ];
    expect(rowsToMarkdown(COLS, rows)).toBe(
      "| id | name |\n| --- | --- |\n| 1 | a |\n| 2 | b |",
    );
  });

  it("escapes pipes and flattens newlines inside cells", () => {
    const rows: CellValue[][] = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "a|b\nc" },
      ],
    ];
    expect(rowsToMarkdown(COLS, rows)).toBe(
      "| id | name |\n| --- | --- |\n| 1 | a\\|b c |",
    );
  });

  it("renders NULL as an empty cell", () => {
    const rows: CellValue[][] = [[{ t: "Int", v: 1 }, { t: "Null" }]];
    expect(rowsToMarkdown(COLS, rows)).toBe(
      "| id | name |\n| --- | --- |\n| 1 |  |",
    );
  });

  it("emits just header + separator for zero rows", () => {
    expect(rowsToMarkdown(COLS, [])).toBe("| id | name |\n| --- | --- |");
  });
});

describe("rowsToJson", () => {
  it("emits a JSON array of row objects, typed per cell", () => {
    const rows: CellValue[][] = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "a" },
      ],
      [{ t: "Int", v: 2 }, { t: "Null" }],
    ];
    const out = rowsToJson(COLS, rows);
    expect(JSON.parse(out)).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: null },
    ]);
  });

  it("emits BigInt beyond 2^53 as a bare numeric token (digits preserved in the text)", () => {
    const rows: CellValue[][] = [
      [
        { t: "BigInt", v: "18446744073709551615" },
        { t: "Str", v: "x" },
      ],
    ];
    expect(rowsToJson(COLS, rows)).toContain('"id": 18446744073709551615');
  });

  it("quotes a non-numeric Decimal/BigInt string instead of emitting invalid JSON", () => {
    const rows: CellValue[][] = [
      [
        { t: "Decimal", v: "1e10" },
        { t: "Str", v: "x" },
      ],
    ];
    expect(JSON.parse(rowsToJson(COLS, rows))[0].id).toBe("1e10");
  });

  it("escapes quotes and newlines via JSON string rules", () => {
    const rows: CellValue[][] = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: 'say "hi"\nbye' },
      ],
    ];
    expect(JSON.parse(rowsToJson(COLS, rows))[0].name).toBe('say "hi"\nbye');
  });

  it("returns [] for zero rows", () => {
    expect(rowsToJson(COLS, [])).toBe("[]");
  });
});

describe("rowsToJsonLines", () => {
  it("emits one parseable object per line, no array wrapper", () => {
    const rows: CellValue[][] = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "a" },
      ],
      [
        { t: "Int", v: 2 },
        { t: "Str", v: "b" },
      ],
    ];
    const lines = rowsToJsonLines(COLS, rows).split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ id: 1, name: "a" });
    expect(JSON.parse(lines[1])).toEqual({ id: 2, name: "b" });
  });

  it("returns an empty string for zero rows", () => {
    expect(rowsToJsonLines(COLS, [])).toBe("");
  });
});

describe("rowsToSqlValues", () => {
  it("emits VALUES tuples with CH-style string escaping", () => {
    const rows: CellValue[][] = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "it's a \\ test" },
      ],
      [{ t: "Int", v: 2 }, { t: "Null" }],
    ];
    expect(rowsToSqlValues(rows)).toBe("(1, 'it\\'s a \\\\ test'),\n(2, NULL)");
  });

  it("passes Other cells (CH array/map literals) through unquoted", () => {
    const rows: CellValue[][] = [
      [
        { t: "Other", v: "['a','b']" },
        { t: "DateTime", v: "2026-01-01 00:00:00" },
      ],
    ];
    expect(rowsToSqlValues(rows)).toBe("(['a','b'], '2026-01-01 00:00:00')");
  });

  it("emits numeric BigInt/Decimal bare", () => {
    const rows: CellValue[][] = [
      [
        { t: "BigInt", v: "18446744073709551615" },
        { t: "Decimal", v: "12.345" },
      ],
    ];
    expect(rowsToSqlValues(rows)).toBe("(18446744073709551615, 12.345)");
  });
});

describe("rowsToPythonList", () => {
  it("emits a list of dicts with Python literals", () => {
    const rows: CellValue[][] = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "a" },
      ],
      [{ t: "Int", v: 2 }, { t: "Null" }],
    ];
    expect(rowsToPythonList(COLS, rows)).toBe(
      "[\n    {'id': 1, 'name': 'a'},\n    {'id': 2, 'name': None},\n]",
    );
  });

  it("escapes quotes, backslashes, and control chars in strings", () => {
    const rows: CellValue[][] = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "it's\na\ttab\\" },
      ],
    ];
    expect(rowsToPythonList(COLS, rows)).toContain("'it\\'s\\na\\ttab\\\\'");
  });

  it("returns [] for zero rows", () => {
    expect(rowsToPythonList(COLS, [])).toBe("[]");
  });
});

describe("rowsToClipboardTsv", () => {
  const cols = [
    { name: "id", type: "UInt8" },
    { name: "note", type: "String" },
  ];
  it("quotes only fields that hold a tab, line break, or quote", () => {
    const rows = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "plain" },
      ],
      [
        { t: "Int", v: 2 },
        { t: "Str", v: "two\nlines" },
      ],
      [
        { t: "Int", v: 3 },
        { t: "Str", v: 'tab\there "q"' },
      ],
    ] as CellValue[][];
    expect(rowsToClipboardTsv(cols, rows)).toBe(
      'id\tnote\n1\tplain\n2\t"two\nlines"\n3\t"tab\there ""q"""',
    );
  });

  it("keeps a literal backslash-n apart from a real line break", () => {
    const rows = [
      [
        { t: "Int", v: 1 },
        { t: "Str", v: "a\\nb" },
      ],
    ] as CellValue[][];
    expect(rowsToClipboardTsv(cols, rows)).toBe("id\tnote\n1\ta\\nb");
  });
});
