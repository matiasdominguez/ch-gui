import { describe, expect, it } from "vitest";

import { quoteIdent, sqlNameAfter } from "./sqlIdent";

describe("quoteIdent", () => {
  it("backtick-quotes a plain name", () => {
    expect(quoteIdent("events")).toBe("`events`");
  });

  it("quotes names with dots and spaces verbatim", () => {
    expect(quoteIdent("my table.v2")).toBe("`my table.v2`");
  });

  it("escapes embedded backticks", () => {
    expect(quoteIdent("we`ird")).toBe("`we\\`ird`");
  });

  it("escapes backslashes before backticks so escapes can't be neutralized", () => {
    expect(quoteIdent("trail\\")).toBe("`trail\\\\`");
    expect(quoteIdent("a\\`b")).toBe("`a\\\\\\`b`");
  });

  it("handles the empty string", () => {
    expect(quoteIdent("")).toBe("``");
  });
});

describe("sqlNameAfter", () => {
  it("escapes without adding quotes when the user already typed an opening quote", () => {
    expect(sqlNameAfter("`", "my-col")).toBe("my-col");
    expect(sqlNameAfter("`", "a`b\\")).toBe("a\\`b\\\\");
    expect(sqlNameAfter('"', 'a"b`c')).toBe('a\\"b`c');
    expect(sqlNameAfter("", "my-col")).toBe("`my-col`");
  });
});
