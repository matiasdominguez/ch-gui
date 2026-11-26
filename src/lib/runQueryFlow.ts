import type { QueryClient } from "@tanstack/react-query";
import { v4 as uuid } from "uuid";

import { useConnections } from "../state/connections";
import { useTabs, type QueryTab } from "../state/tabs";
import type { ConnectionConfigPayload } from "../types";
import { applyAutoLimit, AUTO_LIMIT_ROWS } from "./autoLimit";
import { recordHistory } from "./db";
import { notifyError } from "./notify";
import { substituteParams } from "./params";
import { splitStatements } from "./sqlSplit";
import { cancelQuery, fetchQueryProfile, runQuery } from "./tauri";

export interface RunQueryContext {
  payload: ConnectionConfigPayload | null;
  patch: (id: string, update: Partial<QueryTab>) => void;
  queryClient: QueryClient;
}

const RUN_IDLE = {
  runningQueryId: null,
  runConn: null,
  cancelRequested: false,
  batch: null,
  autoLimitHit: false,
  runStartedAt: undefined,
} satisfies Partial<QueryTab>;

export async function executeTab(
  t: QueryTab,
  ctx: RunQueryContext,
  sqlOverride?: string,
  opts: { noLimit?: boolean; raw?: boolean } = {},
): Promise<void> {
  const sourceSql = sqlOverride ?? t.sql;
  if (!sourceSql.trim()) return;
  // Monaco's Cmd+Enter binding still fires while the Run button shows Cancel.
  const live = useTabs.getState().tabs.find((x) => x.id === t.id);
  if (live?.runningQueryId) return;
  const conn = ctx.payload;
  if (!conn) {
    const picked = useConnections.getState().activeId !== null;
    notifyError(
      picked ? "Connection not ready" : "No connection",
      picked
        ? "The connection is loading or failed to load. The connection picker shows any error."
        : "Pick a connection before running a query.",
    );
    return;
  }

  const resolvedSql = opts.raw
    ? sourceSql
    : substituteParams(sourceSql, t.paramValues);

  const statements = splitStatements(resolvedSql);
  if (statements.length === 0) return;

  const autoLimitOn = !opts.noLimit && (live?.autoLimit ?? t.autoLimit);

  let lastResult: Awaited<ReturnType<typeof runQuery>> | null = null;
  let lastQueryId: string | null = null;
  let lastAutoLimited = false;
  let lastStmt = "";
  for (let idx = 0; idx < statements.length; idx++) {
    const stmt = statements[idx];
    const { sql: wireSql, applied: autoLimited } = autoLimitOn
      ? applyAutoLimit(stmt)
      : { sql: stmt, applied: false };
    lastStmt = stmt;
    const queryId = uuid();
    lastQueryId = queryId;
    lastAutoLimited = autoLimited;
    ctx.patch(t.id, {
      runningQueryId: queryId,
      runConn: conn,
      profileQueryId: null,
      // Resetting this per statement would wipe a Cancel at a boundary.
      ...(idx === 0
        ? { cancelRequested: false, runStartedAt: Date.now() }
        : null),
      batch:
        statements.length > 1
          ? { idx: idx + 1, total: statements.length }
          : null,
      error: null,
      logs: [],
      logsUnavailable: false,
      progress: null,
      profile: null,
      profileLoading: false,
      profileError: null,
    });
    const startedAt = performance.now();
    try {
      const result = await runQuery(conn, wireSql, queryId, t.logLevel);
      lastResult = result;
      // A local SQLite failure must not mark a successful query as failed.
      await recordHistory({
        connectionId: conn.id,
        sql: stmt,
        durationMs: result.stats.elapsed_ms,
        rowsReturned: result.stats.rows,
        error: null,
      }).catch(() => {});
    } catch (err: unknown) {
      const e = err as { kind?: string; message?: string };
      const message = e.message ?? String(err);
      const liveTab = useTabs.getState().tabs.find((x) => x.id === t.id);
      if (!liveTab || liveTab.runningQueryId !== queryId) {
        await recordHistory({
          connectionId: conn.id,
          sql: stmt,
          durationMs: Math.round(performance.now() - startedAt),
          rowsReturned: null,
          error: liveTab ? message : "Cancelled",
        }).catch(() => {});
        ctx.queryClient.invalidateQueries({ queryKey: ["history", conn.id] });
        return;
      }
      const cancelled = liveTab.cancelRequested;
      const display = cancelled
        ? "Query cancelled"
        : statements.length > 1
          ? `Statement ${idx + 1} of ${statements.length}: ${message}`
          : message;
      ctx.patch(t.id, {
        ...RUN_IDLE,
        result: null,
        resultOf: undefined,
        error: {
          kind: cancelled ? "cancelled" : (e.kind ?? "error"),
          message: display,
          detail:
            cancelled || e.kind === "connect"
              ? undefined
              : {
                  sql: wireSql,
                  queryId,
                  message,
                  statement:
                    statements.length > 1
                      ? { idx: idx + 1, total: statements.length }
                      : null,
                  conn,
                },
        },
      });
      await recordHistory({
        connectionId: conn.id,
        sql: stmt,
        durationMs: Math.round(performance.now() - startedAt),
        rowsReturned: null,
        error: cancelled ? "Cancelled" : message,
      }).catch(() => {});
      ctx.queryClient.invalidateQueries({ queryKey: ["history", conn.id] });
      return;
    }

    // A KILL can miss a query that already finished, so honor the cancel here.
    if (idx < statements.length - 1) {
      const cur = useTabs.getState().tabs.find((x) => x.id === t.id);
      if (!cur) return;
      if (cur.cancelRequested) {
        ctx.patch(t.id, {
          ...RUN_IDLE,
          result: null,
          resultOf: undefined,
          error: {
            kind: "cancelled",
            message: `Cancelled after statement ${idx + 1} of ${statements.length}`,
          },
        });
        ctx.queryClient.invalidateQueries({ queryKey: ["history", conn.id] });
        return;
      }
    }
  }

  // Fetching one more row would fail if server max_result_rows equals the cap.
  const capped =
    lastAutoLimited && (lastResult?.stats.rows ?? 0) >= AUTO_LIMIT_ROWS;
  ctx.patch(t.id, {
    ...RUN_IDLE,
    result: lastResult,
    resultOf:
      statements.length > 1
        ? { idx: statements.length, total: statements.length }
        : undefined,
    autoLimitHit: capped,
    cappedSql: capped ? lastStmt : undefined,
    profileLoading: lastQueryId != null,
    profileQueryId: lastQueryId,
  });
  ctx.queryClient.invalidateQueries({ queryKey: ["history", conn.id] });

  if (lastQueryId) {
    const targetTabId = t.id;
    const qid = lastQueryId;
    fetchQueryProfile(conn, qid)
      .then((profile) => {
        const cur = useTabs.getState().tabs.find((x) => x.id === targetTabId);
        if (!cur || cur.profileQueryId !== qid) return;
        ctx.patch(targetTabId, {
          profile,
          profileLoading: false,
          profileError: null,
        });
      })
      .catch((err: unknown) => {
        const cur = useTabs.getState().tabs.find((x) => x.id === targetTabId);
        if (!cur || cur.profileQueryId !== qid) return;
        const e = err as { message?: string };
        ctx.patch(targetTabId, {
          profileLoading: false,
          profileError: e.message ?? String(err),
        });
      });
  }
}

const kills = new Map<string, { pending: number; landed: boolean }>();

export async function cancelTab(
  t: QueryTab,
  ctx: Pick<RunQueryContext, "payload" | "patch">,
): Promise<void> {
  const live = useTabs.getState().tabs.find((x) => x.id === t.id) ?? t;
  if (!live.runningQueryId) return;
  const conn = live.runConn ?? ctx.payload;
  if (!conn) return;
  // executeTab's catch reads this flag when the KILL rejects, so set it first.
  ctx.patch(t.id, { cancelRequested: true });
  const qid = live.runningQueryId;
  for (const [id, k] of kills)
    if (id !== qid && k.pending === 0) kills.delete(id);
  const k = kills.get(qid) ?? { pending: 0, landed: false };
  kills.set(qid, k);
  k.pending += 1;
  try {
    await cancelQuery(conn, qid);
    k.landed = true;
    // Leave the state alone. Clearing runningQueryId would let a second run
    // start, and the killed run's late rejection would overwrite its state.
  } catch (err: unknown) {
    const current = useTabs.getState().tabs.find((x) => x.id === t.id);
    if (k.pending === 1 && !k.landed && current?.runningQueryId === qid) {
      ctx.patch(t.id, { cancelRequested: false });
    }
    const e = err as { message?: string };
    notifyError("Cancel failed", e.message ?? String(err));
  } finally {
    k.pending -= 1;
    if (k.pending === 0 && !k.landed) kills.delete(qid);
  }
}

export function cancelTabQuietly(t: QueryTab): void {
  if (t.runningQueryId && t.runConn) {
    cancelQuery(t.runConn, t.runningQueryId).catch(() => {});
  }
}
