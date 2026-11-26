import { describe, expect, it } from "vitest";

import { applyAutoLimit } from "./autoLimit";

describe("applyAutoLimit", () => {
  it("appends LIMIT to a bare SELECT", () => {
    expect(applyAutoLimit("SELECT * FROM t")).toEqual({
      sql: "SELECT * FROM t\nLIMIT 10000",
      applied: true,
    });
  });

  it("appends to a WITH … SELECT", () => {
    const r = applyAutoLimit("WITH x AS (SELECT 1) SELECT * FROM x");
    expect(r.applied).toBe(true);
    expect(r.sql).toBe("WITH x AS (SELECT 1) SELECT * FROM x\nLIMIT 10000");
  });

  it("honors a custom limit", () => {
    expect(applyAutoLimit("SELECT 1", 50).sql).toBe("SELECT 1\nLIMIT 50");
  });

  it("leaves a statement with a top-level LIMIT untouched", () => {
    const sql = "SELECT * FROM t LIMIT 5";
    expect(applyAutoLimit(sql)).toEqual({ sql, applied: false });
  });

  it("is case-insensitive about the existing LIMIT", () => {
    const sql = "select * from t limit 5";
    expect(applyAutoLimit(sql).applied).toBe(false);
  });

  it("still appends when the only LIMIT is inside a subquery", () => {
    const sql = "SELECT * FROM (SELECT * FROM t LIMIT 5)";
    expect(applyAutoLimit(sql)).toEqual({
      sql: `${sql}\nLIMIT 10000`,
      applied: true,
    });
  });

  it("ignores LIMIT inside string literals and comments", () => {
    const r = applyAutoLimit(
      "SELECT 'no limit here', x -- limit 5\nFROM t /* LIMIT 3 */",
    );
    expect(r.applied).toBe(true);
  });

  it("treats a quoted identifier containing LIMIT as opaque", () => {
    const r = applyAutoLimit('SELECT "limit" FROM t');
    expect(r.applied).toBe(true);
    const r2 = applyAutoLimit("SELECT `limit` FROM t");
    expect(r2.applied).toBe(true);
  });

  it("splices LIMIT before a trailing SETTINGS clause", () => {
    expect(applyAutoLimit("SELECT * FROM t SETTINGS max_threads = 1").sql).toBe(
      "SELECT * FROM t\nLIMIT 10000\nSETTINGS max_threads = 1",
    );
  });

  it("splices LIMIT before FORMAT", () => {
    expect(applyAutoLimit("SELECT * FROM t FORMAT JSON").sql).toBe(
      "SELECT * FROM t\nLIMIT 10000\nFORMAT JSON",
    );
  });

  it("splices LIMIT before INTO OUTFILE", () => {
    expect(applyAutoLimit("SELECT * FROM t INTO OUTFILE 'x.csv'").sql).toBe(
      "SELECT * FROM t\nLIMIT 10000\nINTO OUTFILE 'x.csv'",
    );
  });

  it("splices before the earliest of several trailing clauses", () => {
    expect(
      applyAutoLimit("SELECT * FROM t INTO OUTFILE 'x' FORMAT CSV").sql,
    ).toBe("SELECT * FROM t\nLIMIT 10000\nINTO OUTFILE 'x' FORMAT CSV");
  });

  it("skips set operations — a trailing LIMIT binds to the last branch only", () => {
    for (const sql of [
      "SELECT 1 UNION ALL SELECT 2",
      "SELECT 1 UNION ALL SELECT 2 LIMIT 1",
      "SELECT 1 UNION DISTINCT SELECT 2",
      "SELECT a FROM t INTERSECT SELECT a FROM s",
      "SELECT a FROM t EXCEPT SELECT a FROM s",
    ]) {
      expect(applyAutoLimit(sql)).toEqual({ sql, applied: false });
    }
  });

  it("still caps `* EXCEPT (col)` column exclusion — not a set op", () => {
    const r = applyAutoLimit("SELECT * EXCEPT (secret) FROM t");
    expect(r.applied).toBe(true);
    expect(r.sql).toBe("SELECT * EXCEPT (secret) FROM t\nLIMIT 10000");
  });

  it("skips WITH … INSERT INTO (leading keyword WITH, but not a read)", () => {
    const sql = "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x";
    expect(applyAutoLimit(sql)).toEqual({ sql, applied: false });
  });

  it("skips standalone OFFSET / FETCH pagination", () => {
    expect(
      applyAutoLimit("SELECT * FROM t ORDER BY x OFFSET 10 ROWS").applied,
    ).toBe(false);
  });

  it("skips non-SELECT statements entirely", () => {
    for (const sql of [
      "INSERT INTO t VALUES (1)",
      "CREATE TABLE t (x Int32) ENGINE = Memory",
      "SHOW TABLES",
      "EXPLAIN SELECT * FROM t",
      "OPTIMIZE TABLE t FINAL",
      "SET max_threads = 1",
    ]) {
      expect(applyAutoLimit(sql)).toEqual({ sql, applied: false });
    }
  });

  it("skips leading-comment SELECTs correctly (still applies)", () => {
    const r = applyAutoLimit("-- top rows\nSELECT * FROM t");
    expect(r.applied).toBe(true);
  });

  it("does not splice into a SELECT list containing a `Settings` column", () => {
    const sql =
      "SELECT query, Settings FROM system.query_log WHERE type = 'QueryFinish'";
    expect(applyAutoLimit(sql)).toEqual({
      sql: `${sql}\nLIMIT 10000`,
      applied: true,
    });
  });

  it("does not splice on Map access to a `Settings` column", () => {
    const sql = "SELECT Settings['max_threads'] FROM system.query_log";
    expect(applyAutoLimit(sql)).toEqual({
      sql: `${sql}\nLIMIT 10000`,
      applied: true,
    });
  });

  it("does not splice on the format() function", () => {
    const sql = "SELECT format('{}: {}', name, engine) FROM system.tables";
    expect(applyAutoLimit(sql)).toEqual({
      sql: `${sql}\nLIMIT 10000`,
      applied: true,
    });
  });

  it("does not splice on a bare column named format", () => {
    for (const sql of [
      "SELECT format FROM t",
      "SELECT x, format FROM t",
      "SELECT x FROM t ORDER BY format DESC",
    ]) {
      expect(applyAutoLimit(sql)).toEqual({
        sql: `${sql}\nLIMIT 10000`,
        applied: true,
      });
    }
  });

  it("does not splice on a table named settings", () => {
    const sql = "SELECT * FROM settings s WHERE s.k = 'v'";
    expect(applyAutoLimit(sql)).toEqual({
      sql: `${sql}\nLIMIT 10000`,
      applied: true,
    });
  });

  it("still caps a SELECT with columns named offset / fetch / limit", () => {
    for (const sql of [
      "SELECT offset, payload FROM kafka_events",
      "SELECT topic, partition, offset FROM chunks WHERE topic = 'orders'",
      "SELECT fetch FROM t",
      "SELECT x FROM t GROUP BY offset",
    ]) {
      expect(applyAutoLimit(sql)).toEqual({
        sql: `${sql}\nLIMIT 10000`,
        applied: true,
      });
    }
  });

  it("treats `LIMIT n BY col` as unbounded and still appends the cap", () => {
    const sql = "SELECT * FROM events ORDER BY ts DESC LIMIT 3 BY user_id";
    expect(applyAutoLimit(sql)).toEqual({
      sql: `${sql}\nLIMIT 10000`,
      applied: true,
    });
  });

  it("treats `LIMIT off, n BY col` as unbounded too", () => {
    const r = applyAutoLimit("SELECT * FROM events LIMIT 1, 3 BY user_id");
    expect(r.applied).toBe(true);
  });

  it("respects a real LIMIT after a LIMIT BY", () => {
    const sql = "SELECT * FROM events LIMIT 3 BY user_id LIMIT 500";
    expect(applyAutoLimit(sql)).toEqual({ sql, applied: false });
  });

  it("recognizes `LIMIT off, n` and `LIMIT n OFFSET m` as bounded", () => {
    for (const sql of [
      "SELECT * FROM t LIMIT 5, 10",
      "SELECT * FROM t LIMIT 10 OFFSET 5",
    ]) {
      expect(applyAutoLimit(sql)).toEqual({ sql, applied: false });
    }
  });
});
