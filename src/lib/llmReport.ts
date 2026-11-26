import type { ConnectionConfigPayload, MvFailure, ServerError } from "../types";

export interface ErrorDetail {
  /** The statement as sent, with params bound and auto-LIMIT applied. */
  sql: string;
  /** ch-gui's run id, sent as a `-- chgui:<id>` comment on the query. */
  queryId: string;
  /** The server's message, without the "Statement N of M" prefix. */
  message: string;
  statement: { idx: number; total: number } | null;
  conn: ConnectionConfigPayload;
}

export interface Versions {
  server?: string;
  app?: string;
}

function fence(text: string): string {
  // Spreading every run into Math.max can exceed the argument limit.
  let longest = 0;
  let run = 0;
  for (const ch of text) {
    run = ch === "`" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

export function llmReport(d: ErrorDetail, v: Versions): string {
  const sql = d.sql.trim();
  const message = d.message.trim();
  const sqlFence = fence(sql);
  const errFence = fence(message);
  return [
    "A ClickHouse query failed. Explain the error and fix the query.",
    "",
    `ClickHouse server: ${v.server ?? "unknown"}`,
    `Client: ch-gui ${v.app ?? "unknown"}`,
    ...(d.statement
      ? [`Failed at statement ${d.statement.idx} of ${d.statement.total}.`]
      : []),
    `In system.query_log: WHERE query LIKE '%chgui:${d.queryId}%'`,
    "",
    "SQL:",
    `${sqlFence}sql`,
    sql,
    sqlFence,
    "",
    "Error:",
    errFence,
    message,
    errFence,
  ].join("\n");
}

export function serverErrorReport(
  e: ServerError,
  v: Versions,
  conn: Pick<ConnectionConfigPayload, "cluster_fanout" | "cluster_name">,
): string {
  const message = (e.last_error_message || "(no message)").trim();
  const msgFence = fence(message);
  // With fan-out on, the error may come from any replica's query_log.
  const cluster = queryLogCluster(conn);
  const lookup = [
    cluster
      ? "SELECT hostName() AS host, event_time, query_id, user, query, exception"
      : "SELECT event_time, query_id, user, query, exception",
    cluster
      ? `FROM clusterAllReplicas('${cluster}', system.query_log)`
      : "FROM system.query_log",
    `WHERE exception_code = ${e.code} AND event_date >= today() - 7`,
    "ORDER BY event_time DESC",
    "LIMIT 20",
  ].join("\n");
  return [
    "A ClickHouse server logged this error. Explain what it means and its likely causes, then suggest how to investigate it, with diagnostic queries against the system tables.",
    "",
    `ClickHouse server: ${v.server ?? "unknown"}`,
    `Client: ch-gui ${v.app ?? "unknown"}`,
    "",
    `Error: ${e.name} (code ${e.code})`,
    cluster
      ? `Count: ${e.count}, summed over replicas since each server started (system.errors)`
      : `Count: ${e.count} since the server started (system.errors)`,
    `Last seen: ${e.last_error_time} (UTC)`,
    ...(e.remote
      ? ["Received from a remote server, as in a distributed query."]
      : []),
    "",
    "Last message:",
    msgFence,
    message,
    msgFence,
    "",
    "Queries that failed with this code in the last 7 days, if any:",
    "```sql",
    lookup,
    "```",
    ...(cluster
      ? [
          "clusterAllReplicas needs the REMOTE grant; without it, run the query on each replica against system.query_log.",
        ]
      : []),
  ].join("\n");
}

function queryLogCluster(
  conn: Pick<ConnectionConfigPayload, "cluster_fanout" | "cluster_name">,
): string | null {
  if (!conn.cluster_fanout) return null;
  const name = conn.cluster_name ?? "";
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : "{cluster}";
}

const INSERT_CAP = 4000;

function sqlString(v: string): string {
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function mvFailureReport(
  f: MvFailure,
  v: Versions,
  conn: Pick<ConnectionConfigPayload, "cluster_fanout" | "cluster_name">,
): string {
  const exception = (f.exception || "(no exception text)").trim();
  const excFence = fence(exception);
  const insertFull = f.initial_query.trim();
  const insert =
    insertFull.length > INSERT_CAP
      ? `${insertFull.slice(0, INSERT_CAP)}\n… (cut; ${insertFull.length} characters in all)`
      : insertFull;
  const insertFence = fence(insert);
  const cluster = queryLogCluster(conn);
  const onReplicas = (table: string) =>
    cluster ? `clusterAllReplicas('${cluster}', ${table})` : table;
  // Database and view names can contain dots, so the name can't be split.
  const definition = [
    cluster
      ? "SELECT hostName() AS host, create_table_query"
      : "SELECT create_table_query",
    `FROM ${onReplicas("system.tables")}`,
    `WHERE concat(database, '.', name) = ${sqlString(f.view_name)}`,
  ].join("\n");
  return [
    "A ClickHouse materialized view failed while processing an INSERT, so its target table missed those rows. Explain the error and its likely cause, and suggest how to fix the view or the data.",
    "",
    `ClickHouse server: ${v.server ?? "unknown"}`,
    `Client: ch-gui ${v.app ?? "unknown"}`,
    "",
    `View: ${f.view_name} (${f.view_type || "unknown type"})`,
    `Status: ${f.status}`,
    `When: ${f.event_time} (UTC)`,
    ...(f.initial_query_id ? [`INSERT query_id: ${f.initial_query_id}`] : []),
    "",
    "Exception:",
    excFence,
    exception,
    excFence,
    "",
    ...(insert
      ? [
          "The INSERT that triggered it:",
          `${insertFence}sql`,
          insert,
          insertFence,
        ]
      : ["The triggering INSERT isn't in query_log yet."]),
    "",
    "The view's definition:",
    "```sql",
    definition,
    "```",
    "",
    "Its failures in the last 7 days:",
    "```sql",
    [
      cluster
        ? "SELECT hostName() AS host, event_time, status, exception, initial_query_id"
        : "SELECT event_time, status, exception, initial_query_id",
      `FROM ${onReplicas("system.query_views_log")}`,
      `WHERE view_name = ${sqlString(f.view_name)} AND status != 'QueryFinish' AND event_time > now() - INTERVAL 7 DAY`,
      "ORDER BY event_time DESC",
      "LIMIT 20",
    ].join("\n"),
    "```",
    ...(cluster
      ? [
          "clusterAllReplicas needs the REMOTE grant; without it, run these queries on each replica against the local system tables.",
        ]
      : []),
  ].join("\n");
}
