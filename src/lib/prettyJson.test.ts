import { describe, expect, it } from "vitest";

import { prettyJsonOrNull } from "./prettyJson";

describe("prettyJsonOrNull", () => {
  it("pretty-prints a JSON object", () => {
    expect(prettyJsonOrNull('{"a":1,"b":[2,3]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
    );
  });

  it("pretty-prints a JSON array and tolerates surrounding whitespace", () => {
    expect(prettyJsonOrNull("  [1, 2]  ")).toBe("[\n  1,\n  2\n]");
  });

  it("returns null for bare scalars even though they parse as JSON", () => {
    expect(prettyJsonOrNull("123")).toBeNull();
    expect(prettyJsonOrNull('"quoted"')).toBeNull();
    expect(prettyJsonOrNull("true")).toBeNull();
  });

  it("returns null for CH literal form (single quotes — not JSON)", () => {
    expect(prettyJsonOrNull("{'a':1}")).toBeNull();
    expect(prettyJsonOrNull("['a','b']")).toBeNull();
  });

  it("returns null for plain text and empty strings", () => {
    expect(prettyJsonOrNull("hello world")).toBeNull();
    expect(prettyJsonOrNull("")).toBeNull();
  });

  it("preserves 64-bit integer digits exactly (no JS-number round-trip)", () => {
    expect(prettyJsonOrNull('{"event_id":18446744073709551615}')).toBe(
      '{\n  "event_id": 18446744073709551615\n}',
    );
    expect(prettyJsonOrNull("[9007199254740993]")).toBe(
      "[\n  9007199254740993\n]",
    );
  });

  it("preserves high-precision floats verbatim", () => {
    expect(prettyJsonOrNull('{"x":0.1234567890123456789}')).toBe(
      '{\n  "x": 0.1234567890123456789\n}',
    );
  });

  it("keeps empty containers compact", () => {
    expect(prettyJsonOrNull('{"a":{},"b":[]}')).toBe(
      '{\n  "a": {},\n  "b": []\n}',
    );
  });

  it("leaves structural characters inside strings alone", () => {
    expect(prettyJsonOrNull('{"a":"b:c,{d}[e]","q":"\\"x\\""}')).toBe(
      '{\n  "a": "b:c,{d}[e]",\n  "q": "\\"x\\""\n}',
    );
  });
});
