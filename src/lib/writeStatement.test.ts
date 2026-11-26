import { describe, expect, it } from "vitest";

import { hasWriteStatement } from "./writeStatement";

describe("hasWriteStatement", () => {
  it("spots writes behind comments, in any case, anywhere in a script", () => {
    expect(hasWriteStatement("INSERT INTO t VALUES (1)")).toBe(true);
    expect(hasWriteStatement("-- again\ninsert into t values (1)")).toBe(true);
    expect(hasWriteStatement("SELECT 1; DROP TABLE t")).toBe(true);
    expect(hasWriteStatement("ALTER TABLE t DELETE WHERE 1")).toBe(true);
    expect(
      hasWriteStatement("WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x"),
    ).toBe(true);
  });

  it("leaves reads alone", () => {
    expect(hasWriteStatement("SELECT 1")).toBe(false);
    expect(hasWriteStatement("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(
      false,
    );
    expect(hasWriteStatement("EXPLAIN INSERT INTO t VALUES (1)")).toBe(false);
    expect(hasWriteStatement("SELECT 'INSERT' AS word")).toBe(false);
  });
});
