import { describe, expect, it } from "vitest";

import { formatDocMarkdown, mergeFunctionDocs } from "./chFunctions";
import type { FunctionDoc } from "../types";

function doc(overrides: Partial<FunctionDoc>): FunctionDoc {
  return {
    name: "f",
    description: "",
    is_aggregate: false,
    case_insensitive: false,
    syntax: "",
    arguments: "",
    returned_value: "",
    categories: "",
    ...overrides,
  };
}

describe("mergeFunctionDocs", () => {
  it("returns the bundle untouched when server is disabled", () => {
    const bundle = [doc({ name: "toDate", description: "bundle" })];
    const merged = mergeFunctionDocs({ status: "disabled" }, bundle);
    expect(merged).toEqual(bundle);
  });

  it("overlays server description onto bundle when non-empty", () => {
    const bundle = [doc({ name: "toDate", description: "bundle desc" })];
    const server: FunctionDoc[] = [
      doc({ name: "toDate", description: "server desc" }),
    ];
    const merged = mergeFunctionDocs(
      { status: "enabled", rows: server },
      bundle,
    );
    expect(merged[0]?.description).toBe("server desc");
  });

  it("falls back to bundle when server returns an empty description", () => {
    const bundle = [doc({ name: "toDate", description: "bundle desc" })];
    const server: FunctionDoc[] = [doc({ name: "toDate", description: "" })];
    const merged = mergeFunctionDocs(
      { status: "enabled", rows: server },
      bundle,
    );
    expect(merged[0]?.description).toBe("bundle desc");
  });

  it("matches case-insensitively between server and bundle", () => {
    const bundle = [doc({ name: "toDate", description: "bundle" })];
    const server: FunctionDoc[] = [
      doc({ name: "TODATE", description: "server" }),
    ];
    const merged = mergeFunctionDocs(
      { status: "enabled", rows: server },
      bundle,
    );
    expect(merged.length).toBe(1);
    expect(merged[0]?.description).toBe("server");
  });

  it("includes functions that only exist on the server", () => {
    const bundle = [doc({ name: "toDate" })];
    const server: FunctionDoc[] = [
      doc({ name: "newFn", description: "server" }),
    ];
    const merged = mergeFunctionDocs(
      { status: "enabled", rows: server },
      bundle,
    );
    expect(merged.map((d) => d.name).sort()).toEqual(["newFn", "toDate"]);
  });

  it("keeps server is_aggregate over bundle's", () => {
    const bundle = [doc({ name: "f", is_aggregate: false })];
    const server: FunctionDoc[] = [doc({ name: "f", is_aggregate: true })];
    const merged = mergeFunctionDocs(
      { status: "enabled", rows: server },
      bundle,
    );
    expect(merged[0]?.is_aggregate).toBe(true);
  });

  it("keeps server is_aggregate=false over bundle's true (no `||` fallback)", () => {
    const bundle = [doc({ name: "f", is_aggregate: true })];
    const server: FunctionDoc[] = [doc({ name: "f", is_aggregate: false })];
    const merged = mergeFunctionDocs(
      { status: "enabled", rows: server },
      bundle,
    );
    expect(merged[0]?.is_aggregate).toBe(false);
  });

  it("keeps server case_insensitive=false over bundle's true", () => {
    const bundle = [doc({ name: "f", case_insensitive: true })];
    const server: FunctionDoc[] = [doc({ name: "f", case_insensitive: false })];
    const merged = mergeFunctionDocs(
      { status: "enabled", rows: server },
      bundle,
    );
    expect(merged[0]?.case_insensitive).toBe(false);
  });
});

describe("formatDocMarkdown", () => {
  it("renders name + kind even with no other fields", () => {
    expect(formatDocMarkdown(doc({ name: "f" }))).toBe("**f** · _function_");
  });

  it("uses 'aggregate' kind when is_aggregate is true", () => {
    const md = formatDocMarkdown(doc({ name: "sum", is_aggregate: true }));
    expect(md).toContain("_aggregate_");
  });

  it("prefers server syntax over synthesizing from arguments", () => {
    const md = formatDocMarkdown(
      doc({ name: "f", syntax: "f(x, y)", arguments: "ignored" }),
    );
    expect(md).toContain("`f(x, y)`");
    expect(md).not.toContain("ignored");
  });

  it("synthesizes signature from name + arguments when syntax missing", () => {
    const md = formatDocMarkdown(doc({ name: "f", arguments: "x: Int" }));
    expect(md).toContain("`f(x: Int)`");
  });

  it("appends return type with arrow when both signature and return", () => {
    const md = formatDocMarkdown(
      doc({ name: "f", arguments: "x", returned_value: "UInt32" }),
    );
    expect(md).toContain("`f(x)` → UInt32");
  });

  it("omits sections for empty fields", () => {
    const md = formatDocMarkdown(doc({ name: "f" }));
    expect(md).not.toContain("categories");
    expect(md).not.toContain("→");
    expect(md.split("\n\n").length).toBe(1);
  });
});
