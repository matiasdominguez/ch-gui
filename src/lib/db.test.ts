import { beforeEach, describe, expect, it, vi } from "vitest";

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load } }));

function makeFakeDb() {
  return {
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 }),
  };
}

async function freshModule() {
  vi.resetModules();
  return await import("./db");
}

beforeEach(() => {
  load.mockReset();
});

describe("escapeLike", () => {
  it("escapes %, _ and backslash; leaves plain text alone", async () => {
    const { escapeLike } = await freshModule();
    expect(escapeLike("plain text")).toBe("plain text");
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });
});

describe("getDb retry", () => {
  it("does not cache a failed Database.load — the next call retries", async () => {
    const db = await freshModule();
    load.mockRejectedValueOnce(new Error("database is locked"));
    await expect(db.listConnections()).rejects.toThrow("database is locked");

    const fake = makeFakeDb();
    load.mockResolvedValueOnce(fake);
    await expect(db.listConnections()).resolves.toEqual([]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("recordHistory", () => {
  const entry = {
    connectionId: "c1",
    sql: "SELECT 1",
    durationMs: 5,
    rowsReturned: 1,
    error: null,
  };

  it("updates the latest row in place when the same SQL is re-run", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);
    fake.select.mockResolvedValueOnce([
      { id: 7, sql: "SELECT 1", error: null, pinned: 0 },
    ]);

    await db.recordHistory(entry);

    expect(fake.execute).toHaveBeenCalledTimes(1);
    const [sql, args] = fake.execute.mock.calls[0];
    expect(sql).toContain("UPDATE query_history");
    expect(args).toEqual([5, 1, null, 7]);
  });

  it("never dedupes onto a pinned row — pinning preserves the snapshot", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);
    fake.select.mockResolvedValueOnce([
      { id: 7, sql: "SELECT 1", error: null, pinned: 1 },
    ]);

    await db.recordHistory(entry);

    const sqls = fake.execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("UPDATE query_history"))).toBe(false);
    expect(sqls.some((s) => s.includes("INSERT INTO query_history"))).toBe(
      true,
    );
  });

  it("does not let a failure overwrite a successful run of the same SQL", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);
    fake.select.mockResolvedValueOnce([
      { id: 7, sql: "SELECT 1", error: null, pinned: 0 },
    ]);

    await db.recordHistory({
      ...entry,
      error: "Code: 394. Query was cancelled",
    });

    const sqls = fake.execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("UPDATE query_history"))).toBe(false);
    expect(sqls.some((s) => s.includes("INSERT INTO query_history"))).toBe(
      true,
    );
  });

  it("does not let a success erase the failure it recovered from", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);
    fake.select.mockResolvedValueOnce([
      { id: 7, sql: "SELECT 1", error: "syntax error", pinned: 0 },
    ]);

    await db.recordHistory(entry);

    const sqls = fake.execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("UPDATE query_history"))).toBe(false);
    expect(sqls.some((s) => s.includes("INSERT INTO query_history"))).toBe(
      true,
    );
  });

  it("inserts when the latest row has different SQL, pruning once per session", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);
    fake.select.mockResolvedValue([{ id: 7, sql: "SELECT 2" }]);

    await db.recordHistory(entry);
    await db.recordHistory({ ...entry, sql: "SELECT 3" });

    const sqls = fake.execute.mock.calls.map((c) => String(c[0]));
    expect(
      sqls.filter((s) => s.includes("INSERT INTO query_history")),
    ).toHaveLength(2);
    expect(
      sqls.filter((s) => s.includes("DELETE FROM query_history")),
    ).toHaveLength(1);
    expect(sqls.find((s) => s.includes("DELETE"))).toContain("pinned = 0");
  });

  it("inserts when history is empty", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);

    await db.recordHistory(entry);

    const sqls = fake.execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("INSERT INTO query_history"))).toBe(
      true,
    );
  });
});

describe("search escaping and NULL-connection visibility", () => {
  it("listHistory escapes LIKE wildcards and uses ESCAPE", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);

    await db.listHistory("c1", "100%_done");

    const [sql, args] = fake.select.mock.calls[0];
    expect(sql).toContain("ESCAPE");
    expect(args).toEqual(["c1", "%100\\%\\_done%", 200]);
  });

  it("listSavedQueries includes connection_id IS NULL rows in both branches", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);

    await db.listSavedQueries("c1", "");
    await db.listSavedQueries("c1", "top_10");

    const [noSearchSql] = fake.select.mock.calls[0];
    const [searchSql, searchArgs] = fake.select.mock.calls[1];
    expect(noSearchSql).toContain("connection_id IS NULL");
    expect(searchSql).toContain("connection_id IS NULL");
    expect(searchSql).toContain("ESCAPE");
    expect(searchArgs).toEqual(["c1", "%top\\_10%", 200]);
  });
});

describe("deleteConnection", () => {
  it("deletes children before the connection row", async () => {
    const db = await freshModule();
    const fake = makeFakeDb();
    load.mockResolvedValue(fake);

    await db.deleteConnection("c1");

    const sqls = fake.execute.mock.calls.map((c) => String(c[0]));
    expect(sqls).toHaveLength(3);
    expect(sqls[0]).toContain("query_history");
    expect(sqls[1]).toContain("saved_queries");
    expect(sqls[2]).toContain("FROM connections");
  });
});
