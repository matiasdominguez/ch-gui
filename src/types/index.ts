export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  secure: boolean;
  defaultDatabase: string | null;
  customCaPem: string | null;
  /** When null, the backend uses the `{cluster}` macro. */
  clusterName: string | null;
  clusterFanout: boolean;
}

export interface ConnectionConfigPayload {
  id: string;
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  default_database: string | null;
  custom_ca_pem: string | null;
  cluster_name: string | null;
  cluster_fanout: boolean;
}

export type CellValue =
  | { t: "Null" }
  | { t: "Int"; v: number }
  | { t: "Float"; v: number }
  | { t: "BigInt"; v: string }
  | { t: "Decimal"; v: string }
  | { t: "Str"; v: string }
  | { t: "DateTime"; v: string }
  | { t: "Other"; v: string };

export interface ColumnMeta {
  name: string;
  type: string;
}

export interface QueryStats {
  rows: number;
  elapsed_ms: number;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: CellValue[][];
  stats: QueryStats;
}

export interface DbInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  engine: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface AppError {
  kind: string;
  message: string;
  code?: number;
}

export interface HistoryEntry {
  id: number;
  connection_id: string;
  sql: string;
  executed_at: string;
  duration_ms: number | null;
  rows_returned: number | null;
  error: string | null;
  /** 0 is unpinned and 1 is pinned. */
  pinned: number;
}

export interface SavedQuery {
  id: number;
  connection_id: string | null;
  name: string;
  sql: string;
  created_at: string;
  updated_at: string;
}

export type LogLevel =
  "none" | "fatal" | "error" | "warning" | "information" | "debug" | "trace";

export interface LogEntry {
  event_time: string | null;
  host_name: string;
  query_id: string;
  thread_id: number;
  /** The Poco values are 1 Fatal, 3 Error, 4 Warning, 6 Info, 7 Debug, 8 Trace. */
  priority: number;
  source: string;
  text: string;
}

export interface LogEventPayload {
  queryId: string;
  entries: LogEntry[];
}

/** The server refuses `send_logs_level` for readonly users. */
export interface LogsUnavailablePayload {
  queryId: string;
}

/** These values are absolute, because the backend sums the delta packets. */
export interface ProgressSnapshot {
  read_rows: number;
  read_bytes: number;
  total_rows_to_read: number;
  written_rows: number;
  written_bytes: number;
}

export interface ProgressEventPayload extends ProgressSnapshot {
  queryId: string;
}

export interface TableDetails {
  database: string;
  table: string;
  engine: string;
  engine_full: string;
  partition_key: string;
  sorting_key: string;
  primary_key: string;
  sampling_key: string;
  total_rows: number | null;
  total_bytes: number | null;
  comment: string;
  create_table_query: string;
  partitions: PartitionSummary[];
  columns: ColumnDetail[];
  skip_indexes: SkipIndex[];
  dependencies: string[];
  projections: Projection[];
}

export interface Projection {
  name: string;
  proj_type: string;
  expression: string;
}

export interface DependencyGraph {
  root_db: string;
  root_table: string;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  truncated: boolean;
}

export interface DependencyNode {
  database: string;
  table: string;
  engine: string;
  kind: "table" | "dictionary";
}

export interface DependencyEdge {
  from_db: string;
  from_table: string;
  to_db: string;
  to_table: string;
  kind: "primary" | "secondary" | "dict";
}

export interface PartitionSummary {
  partition: string;
  rows: number;
  bytes: number;
  parts: number;
}

export interface ColumnDetail {
  name: string;
  type_str: string;
  default_kind: string;
  default_expression: string;
  compression_codec: string;
  comment: string;
}

export interface SkipIndex {
  name: string;
  type_str: string;
  expr: string;
  granularity: number;
}

export interface ColumnStats {
  database: string;
  table: string;
  column: string;
  type_str: string;
  total: number | null;
  nulls: number | null;
  uniq_approx: number | null;
  min: string;
  max: string;
}

export interface HistogramBucket {
  lower: number;
  upper: number;
  count: number;
}

export interface TopKValue {
  label: string;
  count: number;
  is_null: boolean;
}

/** `histogram_time` bucket edges are unix seconds. */
export type ColumnDistribution =
  | { kind: "histogram"; buckets: HistogramBucket[]; notes: string[] }
  | { kind: "histogram_time"; buckets: HistogramBucket[]; notes: string[] }
  | { kind: "top_k"; values: TopKValue[]; more: boolean; notes: string[] }
  | { kind: "none"; reason: string };

export interface PartsSummary {
  active_count: number;
  inactive_count: number;
  total_active_bytes: number;
  biggest_active_bytes: number;
  /** Formatted as "YYYY-MM-DD HH:MM:SS" in UTC, and null with no active parts. */
  oldest_active_modified_at: string | null;
}

export type PartsSummaryResult =
  { status: "disabled" } | { status: "enabled"; summary: PartsSummary };

/** `progress` runs from 0 to 1. */
export interface ActiveMerge {
  elapsed_s: number;
  progress: number;
  result_part_name: string;
  num_parts: number;
  rows_read: number;
  bytes_read_uncompressed: number;
  is_mutation: boolean;
}

export interface ServerHistoryEntry {
  query_id: string;
  event_time: string;
  query_duration_ms: number | null;
  read_rows: number | null;
  read_bytes: number | null;
  memory_usage: number | null;
  result_rows: number | null;
  user: string;
  query: string;
  exception: string;
}

export interface ServerHistoryFilters {
  min_duration_ms?: number;
  min_memory_bytes?: number;
  exception_only?: boolean;
}

/** The hash is a string because a UInt64 exceeds JS number precision. */
export interface ServerHistoryGroup {
  normalized_query_hash: string;
  count: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  sum_read_bytes: number;
  sum_memory: number;
  sample_query: string;
  sample_query_id: string;
  first_seen: string;
  last_seen: string;
}

export interface ServerError {
  name: string;
  code: number;
  count: number;
  last_error_time: string;
  last_error_message: string;
  remote: boolean;
  /** True when it fired in the last 5 minutes and is not a user's own mistake. */
  recent: boolean;
}

/** `initial_query` is empty when `query_log` has no row for the INSERT yet. */
export interface MvFailure {
  event_time: string;
  view_name: string;
  view_type: string;
  status: string;
  exception: string;
  initial_query_id: string;
  initial_query: string;
  recent: boolean;
}

export type MvFailuresResult =
  { status: "disabled" } | { status: "enabled"; rows: MvFailure[] };

export interface ErrorPulse {
  errors_recent: number;
  mv_failures_recent: number;
  pending_mutations: number;
  max_replica_queue: number;
}

export interface PendingMutation {
  database: string;
  table: string;
  mutation_id: string;
  command: string;
  create_time: string;
  parts_to_do: number;
  latest_fail_reason: string;
}

export interface ReplicaQueueEntry {
  database: string;
  table: string;
  queue_size: number;
  absolute_delay: number;
  is_session_expired: boolean;
}

export type PendingMutationsResult =
  { status: "disabled" } | { status: "enabled"; rows: PendingMutation[] };

export type ReplicaQueueResult =
  { status: "disabled" } | { status: "enabled"; rows: ReplicaQueueEntry[] };

export interface FunctionDoc {
  name: string;
  description: string;
  is_aggregate: boolean;
  case_insensitive: boolean;
  syntax: string;
  arguments: string;
  returned_value: string;
  categories: string;
}

export type FunctionsResult =
  { status: "disabled" } | { status: "enabled"; rows: FunctionDoc[] };

export interface ChangedSetting {
  name: string;
  value: string;
  default_value: string;
  description: string;
}

export interface KafkaTableSummary {
  database: string;
  table: string;
  engine_full: string;
  num_consumers: number;
  last_poll_time: string | null;
  messages_read: number;
  num_rebalances: number;
  last_exception: string;
  is_stuck: boolean;
}

export type KafkaTablesResult =
  { status: "disabled" } | { status: "enabled"; rows: KafkaTableSummary[] };

/** `assignments` has the format `"topic/partition@offset, …"`. */
export interface KafkaConsumer {
  database: string;
  table: string;
  consumer_id: string;
  assignments: string;
  last_poll_time: string;
  num_messages_read: number;
  num_commits: number;
  num_rebalance_revocations: number;
  last_exception: string;
  last_used: string;
}

export type KafkaConsumersResult =
  { status: "disabled" } | { status: "enabled"; rows: KafkaConsumer[] };

export interface KafkaPulse {
  kafka_tables: number;
  kafka_stuck: number;
}

export interface RunningQuery {
  query_id: string;
  user: string;
  elapsed_s: number;
  read_rows: number | null;
  read_bytes: number | null;
  memory_usage: number | null;
  query: string;
}

export interface ProfileSnapshot {
  query_duration_ms: number | null;
  read_rows: number | null;
  read_bytes: number | null;
  written_rows: number | null;
  written_bytes: number | null;
  result_rows: number | null;
  result_bytes: number | null;
  memory_usage: number | null;
  thread_count: number | null;
  used_aggregate_functions: string[];
  used_dictionaries: string[];
  selected_parts: number | null;
  selected_ranges: number | null;
  selected_marks: number | null;
  selected_rows: number | null;
  compressed_read_blocks: number | null;
  compressed_read_bytes: number | null;
  uncompressed_cache_hits: number | null;
  mark_cache_hits: number | null;
  network_send_us: number | null;
}
