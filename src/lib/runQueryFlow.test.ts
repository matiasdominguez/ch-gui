import { notifications } from "@mantine/notifications";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabs, type QueryTab } from "../state/tabs";
import type { ConnectionConfigPayload, QueryResult } from "../types";
import { recordHistory } from "./db";
import {
  cancelTab,
  cancelTabQuietly,
  executeTab,
  type RunQueryContext,
} from "./runQueryFlow";
import { cancelQuery, fetchQueryProfile, runQuery } from "./tauri";

vi.mock("./tauri", () => ({
  runQuery: vi.fn(),
  cancelQuery: vi.fn().mockResolvedValue(undefined),
  fetchQueryProfile: vi.fn().mockResolvedValue(null),
}));

vi.mock("./db", () => ({
  recordHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn(), hide: vi.fn() },
}));

const PAYLOAD: ConnectionConfigPayload = {
  id: "conn-1",
  host: "localhost",
  port: 9000,
  user: "default",
  password: "",
  secure: false,
  default_database: null,
  custom_ca_pem: null,
  cluster_name: null,
  cluster_fanout: false,
};

function makeTab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    id: "tab-1",
    title: "Test",
    sql: "SELECT 1",
    savedQueryId: null,
    result: null,
    error: null,
    runningQueryId: null,
    runConn: null,
    profileQueryId: null,
    cancelRequested: false,
    batch: null,
    logLevel: "none",
    autoLimit: true,
    guardWrites: false,
    autoLimitHit: false,
    logs: [],
    logsUnavailable: false,
    progress: null,
    profile: null,
    profileLoading: false,
    profileError: null,
    paramValues: {},
    chart: { type: "bar", xCol: null, yCol: null },
    ...overrides,
  };
}

function makeCtx(overrides: Partial<RunQueryContext> = {}): RunQueryContext & {
  patch: ReturnType<typeof vi.fn>;
  queryClient: { invalidateQueries: ReturnType<typeof vi.fn> };
} {
  const ctx = {
    payload: PAYLOAD as ConnectionConfigPayload | null,
    // executeTab compares the live tab's run id, so a bare vi.fn() would make
    // every run look superseded.
    patch: vi.fn((id: string, u: Partial<QueryTab>) =>
      useTabs.getState().patch(id, u),
    ),
    queryClient: { invalidateQueries: vi.fn() },
    ...overrides,
  };
  return ctx as RunQueryContext & {
    patch: ReturnType<typeof vi.fn>;
    queryClient: { invalidateQueries: ReturnType<typeof vi.fn> };
  };
}

function okResult(rows = 1): QueryResult {
  return {
    columns: [{ name: "x", type: "UInt8" }],
    rows: Array.from({ length: rows }, (_, i) => [
      { t: "Int", v: i + 1 } as const,
    ]),
    stats: { rows, elapsed_ms: 10 },
  };
}

function lastResultPatch(patch: ReturnType<typeof vi.fn>) {
  const results = patch.mock.calls
    .map((c) => c[1] as Partial<QueryTab>)
    .filter((u) => u.result != null);
  return results[results.length - 1];
}

describe("executeTab", () => {
  beforeEach(() => {
    vi.mocked(runQuery).mockReset();
    vi.mocked(recordHistory).mockReset().mockResolvedValue(undefined);
    vi.mocked(fetchQueryProfile).mockReset().mockResolvedValue(null);
    vi.mocked(notifications.show).mockReset();
    useTabs.setState({ tabs: [makeTab()], activeId: "tab-1", closedStack: [] });
  });

  it("runs a single statement and patches the result on success", async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(1));
    const ctx = makeCtx();

    await executeTab(makeTab(), ctx);

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "SELECT 1", error: null }),
    );
    expect(lastResultPatch(ctx.patch)).toMatchObject({
      runningQueryId: null,
      profileLoading: true,
      result: expect.objectContaining({ stats: { rows: 1, elapsed_ms: 10 } }),
    });
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["history", PAYLOAD.id],
    });
  });

  it("prefixes mid-batch errors with 'Statement N of M:' and skips remaining statements", async () => {
    vi.mocked(runQuery)
      .mockResolvedValueOnce(okResult(1))
      .mockRejectedValueOnce({
        kind: "server",
        message: "Table doesn't exist",
      });
    const ctx = makeCtx();

    await executeTab(
      makeTab({ sql: "SELECT 1 AS a; SELECT * FROM nope; SELECT 3" }),
      ctx,
    );

    expect(runQuery).toHaveBeenCalledTimes(2);

    const errorPatch = ctx.patch.mock.calls.find(
      ([, update]) => update?.error,
    )?.[1];
    expect(errorPatch).toMatchObject({
      runningQueryId: null,
      error: {
        kind: "server",
        message: "Statement 2 of 3: Table doesn't exist",
      },
    });

    const resultPatch = ctx.patch.mock.calls.find(
      ([, update]) => update?.result != null,
    );
    expect(resultPatch).toBeUndefined();

    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["history", PAYLOAD.id],
    });
  });

  it("does not prefix the error when there's only one statement", async () => {
    vi.mocked(runQuery).mockRejectedValueOnce(
      new Error("syntax error at position 7"),
    );
    const ctx = makeCtx();

    await executeTab(makeTab(), ctx);

    const errorPatch = ctx.patch.mock.calls.find(
      ([, update]) => update?.error,
    )?.[1];
    expect(errorPatch?.error?.message).toBe("syntax error at position 7");
  });

  it("keeps what the LLM report needs: the SQL as sent, the run id, the raw error", async () => {
    vi.mocked(runQuery)
      .mockResolvedValueOnce(okResult(1))
      .mockRejectedValueOnce(new Error("Unknown identifier foo"));
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "SELECT 1; SELECT foo FROM t" }), ctx);

    const detail = ctx.patch.mock.calls.find(([, u]) => u?.error)?.[1]?.error
      ?.detail;
    const [conn, sentSql, sentId] = vi.mocked(runQuery).mock.calls[1];
    expect(detail).toEqual({
      sql: sentSql,
      queryId: sentId,
      message: "Unknown identifier foo",
      statement: { idx: 2, total: 2 },
      conn,
    });
    expect(detail?.sql).toMatch(/LIMIT 10000/);
  });

  it("drops a previous error and its LLM report as soon as the next run starts", async () => {
    let finish: (r: QueryResult) => void = () => {};
    vi.mocked(runQuery).mockReturnValueOnce(
      new Promise<QueryResult>((r) => (finish = r)),
    );
    const failed = makeTab({
      error: {
        kind: "clickhouse",
        message: "Unknown identifier foo",
        detail: {
          sql: "SELECT foo",
          queryId: "q-old",
          message: "Unknown identifier foo",
          statement: null,
          conn: PAYLOAD,
        },
      },
    });
    useTabs.setState({ tabs: [failed], activeId: failed.id, closedStack: [] });
    const ctx = makeCtx();

    const run = executeTab(failed, ctx);
    await vi.waitFor(() =>
      expect(useTabs.getState().tabs[0].runningQueryId).not.toBeNull(),
    );
    expect(useTabs.getState().tabs[0].error).toBeNull();

    finish(okResult(1));
    await run;
    expect(useTabs.getState().tabs[0].error).toBeNull();
    expect(useTabs.getState().tabs[0].result?.rows).toHaveLength(1);
  });

  it("leaves no LLM report detail when the connection failed", async () => {
    vi.mocked(runQuery).mockRejectedValueOnce({
      kind: "connect",
      message: "Authentication failed",
    });
    const ctx = makeCtx();

    await executeTab(makeTab(), ctx);

    const error = ctx.patch.mock.calls.find(([, u]) => u?.error)?.[1]?.error;
    expect(error?.message).toBe("Authentication failed");
    expect(error?.detail).toBeUndefined();
  });

  it("leaves no LLM report detail on a cancel", async () => {
    vi.mocked(runQuery).mockImplementationOnce(async () => {
      useTabs.setState((s) => ({
        tabs: s.tabs.map((t) => ({ ...t, cancelRequested: true })),
      }));
      throw new Error("Query was cancelled");
    });
    const ctx = makeCtx();

    await executeTab(makeTab(), ctx);

    const error = ctx.patch.mock.calls.find(([, u]) => u?.error)?.[1]?.error;
    expect(error?.kind).toBe("cancelled");
    expect(error?.detail).toBeUndefined();
  });

  it("shows 'No connection' notification and no-ops when no payload is available", async () => {
    const ctx = makeCtx({ payload: null });

    await executeTab(makeTab(), ctx);

    expect(runQuery).not.toHaveBeenCalled();
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No connection", color: "red" }),
    );
  });

  it("always runs against the active connection's payload", async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(1));
    const other: ConnectionConfigPayload = { ...PAYLOAD, id: "conn-2" };
    const ctx = makeCtx({ payload: other });

    await executeTab(makeTab(), ctx);

    expect(runQuery).toHaveBeenCalledWith(
      other,
      "SELECT 1\nLIMIT 10000",
      expect.any(String),
      "none",
    );
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["history", "conn-2"],
    });
  });

  it("no-ops when the live tab already has a query in flight", async () => {
    useTabs.setState({
      tabs: [makeTab({ runningQueryId: "in-flight-uuid" })],
      activeId: "tab-1",
      closedStack: [],
    });
    const ctx = makeCtx();

    await executeTab(makeTab(), ctx);

    expect(runQuery).not.toHaveBeenCalled();
    expect(ctx.patch).not.toHaveBeenCalled();
    useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
  });

  it("returns early without patching when sql is blank", async () => {
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "   \n\t" }), ctx);

    expect(runQuery).not.toHaveBeenCalled();
    expect(ctx.patch).not.toHaveBeenCalled();
  });

  it("runs every statement in a multi-statement batch when they all succeed", async () => {
    vi.mocked(runQuery)
      .mockResolvedValueOnce(okResult(1))
      .mockResolvedValueOnce(okResult(2))
      .mockResolvedValueOnce(okResult(3));
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "SELECT 1; SELECT 2; SELECT 3" }), ctx);

    expect(runQuery).toHaveBeenCalledTimes(3);
    expect(lastResultPatch(ctx.patch)?.result).toMatchObject({
      stats: { rows: 3 },
    });
  });

  it("runs the sqlOverride instead of the whole tab when provided", async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(2));
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "SELECT 1; SELECT 2" }), ctx, "SELECT 2");

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(
      PAYLOAD,
      "SELECT 2\nLIMIT 10000",
      expect.any(String),
      "none",
    );
  });

  it("keeps the original SQL in history while rewriting the wire SQL", async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(1));
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "SELECT * FROM t" }), ctx);

    expect(runQuery).toHaveBeenCalledWith(
      PAYLOAD,
      "SELECT * FROM t\nLIMIT 10000",
      expect.any(String),
      "none",
    );
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "SELECT * FROM t" }),
    );
  });

  it("re-runs only the capped statement, as sent, without the limit", async () => {
    vi.mocked(runQuery)
      .mockResolvedValueOnce(okResult(0))
      .mockResolvedValueOnce(okResult(10000))
      .mockResolvedValueOnce(okResult(12000));
    const ctx = makeCtx();
    const tab = makeTab({
      sql: "INSERT INTO t VALUES (1); SELECT * FROM t WHERE k = {#k}",
      paramValues: { k: "1" },
    });

    await executeTab(tab, ctx);
    const live = useTabs.getState().tabs[0];
    expect(live.autoLimitHit).toBe(true);
    expect(live.cappedSql).toBe("SELECT * FROM t WHERE k = 1");

    useTabs.getState().patch("tab-1", { paramValues: { k: "2" } });
    await executeTab(useTabs.getState().tabs[0], ctx, live.cappedSql, {
      noLimit: true,
      raw: true,
    });

    expect(vi.mocked(runQuery).mock.calls.map((c) => c[1])).toEqual([
      "INSERT INTO t VALUES (1)",
      "SELECT * FROM t WHERE k = 1\nLIMIT 10000",
      "SELECT * FROM t WHERE k = 1",
    ]);
    const after = useTabs.getState().tabs[0];
    expect(after.autoLimitHit).toBe(false);
    expect(after.cappedSql).toBeUndefined();
    expect(after.autoLimit).toBe(true);
  });

  it("does not rewrite when the tab's autoLimit toggle is off", async () => {
    useTabs.setState({
      tabs: [makeTab({ autoLimit: false })],
      activeId: "tab-1",
      closedStack: [],
    });
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(1));
    const ctx = makeCtx();

    await executeTab(makeTab({ autoLimit: false }), ctx);

    expect(runQuery).toHaveBeenCalledWith(
      PAYLOAD,
      "SELECT 1",
      expect.any(String),
      "none",
    );
  });

  it("sets autoLimitHit only when the appended LIMIT actually filled up", async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(3));
    const ctx = makeCtx();
    await executeTab(makeTab(), ctx);
    expect(lastResultPatch(ctx.patch)).toMatchObject({ autoLimitHit: false });

    useTabs.setState({ tabs: [makeTab()], activeId: "tab-1", closedStack: [] });
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(10000));
    const ctx2 = makeCtx();
    await executeTab(makeTab(), ctx2);
    expect(lastResultPatch(ctx2.patch)).toMatchObject({ autoLimitHit: true });
  });

  it("does not set autoLimitHit when the statement already had a LIMIT", async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(10000));
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "SELECT * FROM t LIMIT 10000" }), ctx);

    expect(runQuery).toHaveBeenCalledWith(
      PAYLOAD,
      "SELECT * FROM t LIMIT 10000",
      expect.any(String),
      "none",
    );
    expect(lastResultPatch(ctx.patch)).toMatchObject({ autoLimitHit: false });
  });

  it("splits a multi-statement override and ignores the tab's own sql", async () => {
    vi.mocked(runQuery)
      .mockResolvedValueOnce(okResult(1))
      .mockResolvedValueOnce(okResult(2));
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "SELECT 9" }), ctx, "SELECT 1; SELECT 2");

    expect(vi.mocked(runQuery).mock.calls.map((c) => c[1])).toEqual([
      "SELECT 1\nLIMIT 10000",
      "SELECT 2\nLIMIT 10000",
    ]);
  });

  it("early-returns when the override is blank", async () => {
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "SELECT 1" }), ctx, "   ");

    expect(runQuery).not.toHaveBeenCalled();
    expect(ctx.patch).not.toHaveBeenCalled();
  });

  it("renders a user-requested cancel as neutral 'cancelled', not a red error", async () => {
    useTabs.setState({ tabs: [makeTab()], activeId: "tab-1", closedStack: [] });
    const ctx = makeCtx({
      patch: (id: string, u: Partial<QueryTab>) =>
        useTabs.getState().patch(id, u),
    });
    let rejectRun!: (e: unknown) => void;
    vi.mocked(runQuery).mockImplementationOnce(
      () => new Promise((_res, rej) => (rejectRun = rej)),
    );

    const done = executeTab(makeTab(), ctx);
    useTabs.getState().patch("tab-1", { cancelRequested: true });
    rejectRun({ kind: "server", message: "Code: 394. Query was cancelled" });
    await done;

    const tab = useTabs.getState().tabs[0];
    expect(tab.error).toEqual({
      kind: "cancelled",
      message: "Query cancelled",
    });
    expect(tab.runningQueryId).toBeNull();
    expect(tab.cancelRequested).toBe(false);
    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Cancelled" }),
    );
    useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
  });

  it("keeps the red error path when no cancel was requested", async () => {
    useTabs.setState({ tabs: [makeTab()], activeId: "tab-1", closedStack: [] });
    const ctx = makeCtx({
      patch: (id: string, u: Partial<QueryTab>) =>
        useTabs.getState().patch(id, u),
    });
    vi.mocked(runQuery).mockRejectedValueOnce({
      kind: "server",
      message: "Code: 394. Query was cancelled",
    });

    await executeTab(makeTab(), ctx);

    const tab = useTabs.getState().tabs[0];
    expect(tab.error?.kind).toBe("server");
    useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
  });

  it("reports batch position for multi-statement runs and clears it at the end", async () => {
    vi.mocked(runQuery)
      .mockResolvedValueOnce(okResult(1))
      .mockResolvedValueOnce(okResult(2))
      .mockResolvedValueOnce(okResult(3));
    const ctx = makeCtx();

    await executeTab(makeTab({ sql: "SELECT 1; SELECT 2; SELECT 3" }), ctx);

    const batches = ctx.patch.mock.calls
      .map((c) => c[1] as Partial<QueryTab>)
      .filter((u) => u.runningQueryId)
      .map((u) => u.batch);
    expect(batches).toEqual([
      { idx: 1, total: 3 },
      { idx: 2, total: 3 },
      { idx: 3, total: 3 },
    ]);
    expect(lastResultPatch(ctx.patch)?.batch).toBeNull();
  });

  it("keeps the previous result during a run and labels a batch's result", async () => {
    const old = okResult(7);
    useTabs.setState({ tabs: [makeTab({ result: old })] });
    let resolveLast!: (r: QueryResult) => void;
    vi.mocked(runQuery)
      .mockResolvedValueOnce(okResult(1))
      .mockImplementationOnce(
        () =>
          new Promise((res) => (resolveLast = res as (r: QueryResult) => void)),
      );
    const ctx = makeCtx();

    const done = executeTab(
      makeTab({ result: old, sql: "SELECT 1; SELECT 2" }),
      ctx,
    );
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledTimes(2));
    const running = useTabs.getState().tabs[0];
    expect(running.result).toBe(old);
    expect(running.runStartedAt).toEqual(expect.any(Number));

    resolveLast(okResult(2));
    await done;
    const tab = useTabs.getState().tabs[0];
    expect(tab.result?.stats.rows).toBe(2);
    expect(tab.resultOf).toEqual({ idx: 2, total: 2 });
    expect(tab.runStartedAt).toBeUndefined();
  });

  it("leaves no batch label on a single-statement result", async () => {
    useTabs.setState({
      tabs: [makeTab({ resultOf: { idx: 3, total: 3 } })],
    });
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(1));

    await executeTab(makeTab(), makeCtx());

    expect(useTabs.getState().tabs[0].resultOf).toBeUndefined();
  });

  it("drops the previous result when the run fails", async () => {
    useTabs.setState({
      tabs: [makeTab({ result: okResult(7), resultOf: { idx: 2, total: 2 } })],
    });
    vi.mocked(runQuery).mockRejectedValueOnce({
      kind: "server",
      message: "boom",
    });

    await executeTab(makeTab({ result: okResult(7) }), makeCtx());

    const tab = useTabs.getState().tabs[0];
    expect(tab.error?.message).toBe("boom");
    expect(tab.result).toBeNull();
    expect(tab.resultOf).toBeUndefined();
  });

  it("passes null batch for single-statement runs", async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(1));
    const ctx = makeCtx();

    await executeTab(makeTab(), ctx);

    const startPatch = ctx.patch.mock.calls
      .map((c) => c[1] as Partial<QueryTab>)
      .find((u) => u.runningQueryId);
    expect(startPatch?.batch).toBeNull();
  });

  it("stops a multi-statement batch at the boundary when cancel was requested", async () => {
    const ctx = makeCtx();
    let resolveRun!: (r: QueryResult) => void;
    vi.mocked(runQuery).mockImplementationOnce(
      () =>
        new Promise((res) => (resolveRun = res as (r: QueryResult) => void)),
    );

    const done = executeTab(makeTab({ sql: "SELECT 1; SELECT 2" }), ctx);
    useTabs.getState().patch("tab-1", { cancelRequested: true });
    resolveRun(okResult(1));
    await done;

    expect(runQuery).toHaveBeenCalledTimes(1);
    const tab = useTabs.getState().tabs[0];
    expect(tab.error).toEqual({
      kind: "cancelled",
      message: "Cancelled after statement 1 of 2",
    });
    expect(tab.runningQueryId).toBeNull();
    expect(tab.batch).toBeNull();
    expect(tab.cancelRequested).toBe(false);
  });

  it("records a Cancelled history row when the tab was closed mid-run", async () => {
    const ctx = makeCtx();
    let rejectRun!: (e: unknown) => void;
    vi.mocked(runQuery).mockImplementationOnce(
      () => new Promise((_res, rej) => (rejectRun = rej)),
    );

    const done = executeTab(makeTab(), ctx);
    useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
    rejectRun({ kind: "server", message: "Code: 394. Query was cancelled" });
    await done;

    expect(recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Cancelled" }),
    );
  });

  it("lands the profile only when the tab's profileQueryId still matches the run", async () => {
    useTabs.setState({ tabs: [makeTab()], activeId: "tab-1", closedStack: [] });
    const ctx = makeCtx({
      patch: (id: string, u: Partial<QueryTab>) =>
        useTabs.getState().patch(id, u),
    });
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(1));

    let resolveProfile!: (p: unknown) => void;
    vi.mocked(fetchQueryProfile).mockImplementationOnce(
      () =>
        new Promise((res) => (resolveProfile = res as (p: unknown) => void)),
    );

    await executeTab(makeTab(), ctx);

    useTabs.getState().patch("tab-1", { profileQueryId: "newer-run" });

    resolveProfile({ query_duration_ms: 1 });
    await Promise.resolve();
    await Promise.resolve();

    const tab = useTabs.getState().tabs[0];
    expect(tab.profile).toBeNull();
    expect(tab.profileQueryId).toBe("newer-run");
    useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
  });

  it("lands the profile when no newer run intervened", async () => {
    useTabs.setState({ tabs: [makeTab()], activeId: "tab-1", closedStack: [] });
    const ctx = makeCtx({
      patch: (id: string, u: Partial<QueryTab>) =>
        useTabs.getState().patch(id, u),
    });
    vi.mocked(runQuery).mockResolvedValueOnce(okResult(1));
    const profile = { query_duration_ms: 42 };
    vi.mocked(fetchQueryProfile).mockResolvedValueOnce(
      profile as unknown as Awaited<ReturnType<typeof fetchQueryProfile>>,
    );

    await executeTab(makeTab(), ctx);
    await Promise.resolve();
    await Promise.resolve();

    const tab = useTabs.getState().tabs[0];
    expect(tab.profile).toEqual(profile);
    expect(tab.profileLoading).toBe(false);
    useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
  });
});

describe("cancelTab", () => {
  beforeEach(() => {
    vi.mocked(cancelQuery).mockReset().mockResolvedValue(undefined);
    vi.mocked(notifications.show).mockReset();
  });

  it("no-ops when the tab has no runningQueryId", async () => {
    const ctx = makeCtx();
    await cancelTab(makeTab(), ctx);
    expect(cancelQuery).not.toHaveBeenCalled();
    expect(ctx.patch).not.toHaveBeenCalled();
  });

  it("invokes cancelQuery and leaves terminal cleanup to the run flow", async () => {
    const ctx = makeCtx();
    await cancelTab(makeTab({ runningQueryId: "qid-1" }), ctx);
    expect(cancelQuery).toHaveBeenCalledWith(PAYLOAD, "qid-1");
    expect(ctx.patch).toHaveBeenCalledTimes(1);
    expect(ctx.patch).toHaveBeenCalledWith("tab-1", { cancelRequested: true });
  });

  it("KILLs on the connection the run started on, not the current payload", async () => {
    const runConn: ConnectionConfigPayload = { ...PAYLOAD, id: "conn-1" };
    const switched: ConnectionConfigPayload = { ...PAYLOAD, id: "conn-2" };
    useTabs.setState({
      tabs: [makeTab({ runningQueryId: "qid-1", runConn })],
      activeId: "tab-1",
      closedStack: [],
    });
    const ctx = makeCtx({ payload: switched });

    await cancelTab(makeTab({ runningQueryId: "qid-1" }), ctx);

    expect(cancelQuery).toHaveBeenCalledWith(runConn, "qid-1");
    useTabs.setState({ tabs: [], activeId: null, closedStack: [] });
  });

  it("shows a red notification when cancelQuery throws", async () => {
    vi.mocked(cancelQuery).mockRejectedValueOnce(new Error("boom"));
    await cancelTab(makeTab({ runningQueryId: "qid-1" }), makeCtx());
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        color: "red",
        title: "Cancel failed",
        message: "boom",
      }),
    );
  });

  it("keeps the cancel intent when a retry fails after an earlier KILL landed", async () => {
    useTabs.setState({ tabs: [makeTab({ runningQueryId: "qid-1" })] });
    vi.mocked(cancelQuery)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("timeout"));
    const ctx = makeCtx();
    const tab = makeTab({ runningQueryId: "qid-1" });

    await cancelTab(tab, ctx);
    await cancelTab(tab, ctx);
    expect(useTabs.getState().tabs[0].cancelRequested).toBe(true);
  });

  it("lets a later run's failed cancel clear its flag despite an old pending KILL", async () => {
    useTabs.setState({ tabs: [makeTab({ runningQueryId: "qid-a" })] });
    let finishOld!: () => void;
    vi.mocked(cancelQuery)
      .mockImplementationOnce(() => new Promise((r) => (finishOld = r)))
      .mockRejectedValueOnce(new Error("timeout"));
    const ctx = makeCtx();

    const old = cancelTab(makeTab({ runningQueryId: "qid-a" }), ctx);
    useTabs
      .getState()
      .patch("tab-1", { runningQueryId: "qid-b", cancelRequested: false });
    await cancelTab(makeTab({ runningQueryId: "qid-b" }), ctx);
    expect(useTabs.getState().tabs[0].cancelRequested).toBe(false);

    finishOld();
    await old;
  });

  it("keeps the cancel intent when a retry fails while the first KILL is pending", async () => {
    useTabs.setState({ tabs: [makeTab({ runningQueryId: "qid-1" })] });
    let finishFirst!: () => void;
    vi.mocked(cancelQuery)
      .mockImplementationOnce(() => new Promise((r) => (finishFirst = r)))
      .mockRejectedValueOnce(new Error("timeout"));
    const ctx = makeCtx();
    const tab = makeTab({ runningQueryId: "qid-1" });

    const first = cancelTab(tab, ctx);
    await cancelTab(tab, ctx);
    expect(useTabs.getState().tabs[0].cancelRequested).toBe(true);

    finishFirst();
    await first;
    expect(useTabs.getState().tabs[0].cancelRequested).toBe(true);
  });

  it("flags cancelRequested before the KILL round trip", async () => {
    const ctx = makeCtx();
    await cancelTab(makeTab({ runningQueryId: "qid-1" }), ctx);
    expect(ctx.patch.mock.calls[0]).toEqual([
      "tab-1",
      { cancelRequested: true },
    ]);
  });
});

describe("cancelTabQuietly", () => {
  beforeEach(() => {
    vi.mocked(cancelQuery).mockReset().mockResolvedValue(undefined);
  });

  it("fires a KILL on the run's connection", () => {
    cancelTabQuietly(makeTab({ runningQueryId: "qid-1", runConn: PAYLOAD }));
    expect(cancelQuery).toHaveBeenCalledWith(PAYLOAD, "qid-1");
  });

  it("no-ops when the tab is idle or has no recorded connection", () => {
    cancelTabQuietly(makeTab());
    cancelTabQuietly(makeTab({ runningQueryId: "qid-1" }));
    expect(cancelQuery).not.toHaveBeenCalled();
  });
});
