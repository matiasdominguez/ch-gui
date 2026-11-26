import { invoke } from "@tauri-apps/api/core";

import type {
  ActiveMerge,
  ChangedSetting,
  ColumnDistribution,
  ColumnInfo,
  ColumnStats,
  ConnectionConfigPayload,
  DbInfo,
  DependencyGraph,
  ErrorPulse,
  FunctionsResult,
  KafkaConsumersResult,
  KafkaPulse,
  KafkaTablesResult,
  LogLevel,
  MvFailuresResult,
  PartsSummaryResult,
  PendingMutationsResult,
  ProfileSnapshot,
  QueryResult,
  ReplicaQueueResult,
  RunningQuery,
  ServerError,
  ServerHistoryEntry,
  ServerHistoryFilters,
  ServerHistoryGroup,
  TableDetails,
  TableInfo,
} from "../types";

export function testConnection(cfg: ConnectionConfigPayload): Promise<void> {
  return invoke("test_connection", { cfg });
}

export function runQuery(
  cfg: ConnectionConfigPayload,
  sql: string,
  queryId: string,
  logLevel?: LogLevel,
): Promise<QueryResult> {
  return invoke("run_query", { cfg, sql, queryId, logLevel });
}

export function cancelQuery(
  cfg: ConnectionConfigPayload,
  queryId: string,
): Promise<void> {
  return invoke("cancel_query", { cfg, queryId });
}

export function cancelScan(
  cfg: ConnectionConfigPayload,
  queryId: string,
): Promise<void> {
  return invoke("cancel_scan", { cfg, queryId });
}

/** Resolves to `null` when the row never reaches `system.query_log`. */
export function fetchQueryProfile(
  cfg: ConnectionConfigPayload,
  queryId: string,
): Promise<ProfileSnapshot | null> {
  return invoke("fetch_query_profile", { cfg, queryId });
}

export function fetchColumnStats(
  cfg: ConnectionConfigPayload,
  database: string,
  table: string,
  column: string,
  queryId: string,
): Promise<ColumnStats> {
  return invoke("fetch_column_stats", {
    cfg,
    database,
    table,
    column,
    queryId,
  });
}

export function fetchColumnDistribution(
  cfg: ConnectionConfigPayload,
  database: string,
  table: string,
  column: string,
  queryId: string,
): Promise<ColumnDistribution> {
  return invoke("fetch_column_distribution", {
    cfg,
    database,
    table,
    column,
    queryId,
  });
}

export function fetchDependencyGraph(
  cfg: ConnectionConfigPayload,
  database: string,
  table: string,
  maxDepth: number,
  maxNodes: number,
): Promise<DependencyGraph> {
  return invoke("fetch_dependency_graph", {
    cfg,
    database,
    table,
    maxDepth,
    maxNodes,
  });
}

export function fetchPartsSummary(
  cfg: ConnectionConfigPayload,
  database: string,
  table: string,
): Promise<PartsSummaryResult> {
  return invoke("fetch_parts_summary", { cfg, database, table });
}

export function fetchActiveMerges(
  cfg: ConnectionConfigPayload,
  database: string,
  table: string,
): Promise<ActiveMerge[]> {
  return invoke("fetch_active_merges", { cfg, database, table });
}

/** A fresh connection lets this open while a user query holds the pool. */
export function fetchTableDetails(
  cfg: ConnectionConfigPayload,
  database: string,
  table: string,
): Promise<TableDetails> {
  return invoke("fetch_table_details", { cfg, database, table });
}

export function listServerHistory(
  cfg: ConnectionConfigPayload,
  limit: number,
  filters: ServerHistoryFilters = {},
): Promise<ServerHistoryEntry[]> {
  return invoke("list_server_history", { cfg, limit, filters });
}

export function listServerHistoryGrouped(
  cfg: ConnectionConfigPayload,
  limit: number,
  filters: ServerHistoryFilters = {},
): Promise<ServerHistoryGroup[]> {
  return invoke("list_server_history_grouped", { cfg, limit, filters });
}

export function listRunningQueries(
  cfg: ConnectionConfigPayload,
): Promise<RunningQuery[]> {
  return invoke("list_running_queries", { cfg });
}

export function listServerErrors(
  cfg: ConnectionConfigPayload,
): Promise<ServerError[]> {
  return invoke("list_server_errors", { cfg });
}

export function listMvFailures(
  cfg: ConnectionConfigPayload,
  viewName?: string,
): Promise<MvFailuresResult> {
  return invoke("list_mv_failures", { cfg, viewName: viewName ?? null });
}

export function errorPulse(cfg: ConnectionConfigPayload): Promise<ErrorPulse> {
  return invoke("error_pulse", { cfg });
}

export function listFunctions(
  cfg: ConnectionConfigPayload,
): Promise<FunctionsResult> {
  return invoke("list_functions", { cfg });
}

export function versionInfo(
  cfg: ConnectionConfigPayload,
): Promise<{ server: string; app: string }> {
  return invoke("version_info", { cfg });
}

/** The backend filters out the SETs ch-gui issues on connect. */
export function listChangedSettings(
  cfg: ConnectionConfigPayload,
): Promise<ChangedSetting[]> {
  return invoke("list_changed_settings", { cfg });
}

export function listPendingMutations(
  cfg: ConnectionConfigPayload,
): Promise<PendingMutationsResult> {
  return invoke("list_pending_mutations", { cfg });
}

export function listReplicaQueue(
  cfg: ConnectionConfigPayload,
): Promise<ReplicaQueueResult> {
  return invoke("list_replica_queue", { cfg });
}

export function listKafkaTables(
  cfg: ConnectionConfigPayload,
): Promise<KafkaTablesResult> {
  return invoke("list_kafka_tables", { cfg });
}

export function listKafkaConsumers(
  cfg: ConnectionConfigPayload,
  database: string,
  table: string,
): Promise<KafkaConsumersResult> {
  return invoke("list_kafka_consumers", { cfg, database, table });
}

export function kafkaPulse(cfg: ConnectionConfigPayload): Promise<KafkaPulse> {
  return invoke("kafka_pulse", { cfg });
}

export function canKillOthers(cfg: ConnectionConfigPayload): Promise<boolean> {
  return invoke("can_kill_others", { cfg });
}

/** Takes a raw `query_id` from `system.processes`. `cancelQuery` only targets
 * queries tagged `chgui:`. */
export function killRunningQuery(
  cfg: ConnectionConfigPayload,
  queryId: string,
): Promise<string | null> {
  return invoke("kill_running_query", { cfg, queryId });
}

export function introspectDatabases(
  cfg: ConnectionConfigPayload,
): Promise<DbInfo[]> {
  return invoke("introspect_databases", { cfg });
}

export function introspectTables(
  cfg: ConnectionConfigPayload,
  database: string,
): Promise<TableInfo[]> {
  return invoke("introspect_tables", { cfg, database });
}

export function introspectColumns(
  cfg: ConnectionConfigPayload,
  database: string,
  table: string,
): Promise<ColumnInfo[]> {
  return invoke("introspect_columns", { cfg, database, table });
}

/** Throws without server `formatQuery()`. Callers then use sql-formatter. */
export function formatSqlServer(
  cfg: ConnectionConfigPayload,
  sql: string,
): Promise<string> {
  return invoke("format_sql", { cfg, sql });
}

export function savePassword(
  connectionId: string,
  password: string,
): Promise<void> {
  return invoke("save_password", { connectionId, password });
}

export function loadPassword(connectionId: string): Promise<string | null> {
  return invoke("load_password", { connectionId });
}

export function deletePassword(connectionId: string): Promise<void> {
  return invoke("delete_password", { connectionId });
}
