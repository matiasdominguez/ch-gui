use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures::StreamExt;
use klickhouse::{LogEntry, Progress};
use serde::{Deserialize, Serialize};
use tokio::time::timeout;

use crate::error::{AppError, AppResult};

use super::tls::build_client_config;
use super::value::{convert_typed, CellValue};

pub type LogCallback = Box<dyn Fn(LogEvent) + Send + Sync>;
pub type ProgressCallback = Box<dyn Fn(ProgressSnapshot) + Send + Sync>;

pub enum LogEvent {
    Lines(Vec<LogEntry>),
    Unavailable,
}

/// ClickHouse Progress packets hold deltas. This struct holds the totals.
#[derive(Debug, Default, Clone, Copy, Serialize)]
pub struct ProgressSnapshot {
    pub read_rows: u64,
    pub read_bytes: u64,
    pub total_rows_to_read: u64,
    pub written_rows: u64,
    pub written_bytes: u64,
}

impl ProgressSnapshot {
    fn accumulate(&mut self, delta: Progress) {
        self.read_rows += delta.read_rows;
        self.read_bytes += delta.read_bytes;
        self.total_rows_to_read += delta.new_total_rows_to_read;
        if let Some(w) = delta.new_written_rows {
            self.written_rows += w;
        }
        if let Some(b) = delta.new_written_bytes {
            self.written_bytes += b;
        }
    }
}

const ALLOWED_LOG_LEVELS: &[&str] = &[
    "none",
    "fatal",
    "error",
    "warning",
    "information",
    "debug",
    "trace",
    "test",
];

#[derive(Clone, Deserialize, Serialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub secure: bool,
    pub default_database: Option<String>,
    pub custom_ca_pem: Option<String>,
    pub cluster_name: Option<String>,
    /// `clusterAllReplicas` requires the `REMOTE` grant, which not every user has.
    #[serde(default = "default_cluster_fanout")]
    pub cluster_fanout: bool,
}

fn default_cluster_fanout() -> bool {
    true
}

impl ConnectionConfig {
    /// Leaves out `id` and `cluster_fanout`. A 497 flips `cluster_fanout` in
    /// place and persists it, and hashing it would then reconnect both pools.
    pub fn fingerprint(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (
            &self.host,
            self.port,
            &self.user,
            &self.password,
            self.secure,
            &self.default_database,
            &self.custom_ca_pem,
            &self.cluster_name,
        )
            .hash(&mut h);
        h.finish()
    }
}

#[derive(Debug, Serialize)]
pub struct ColumnMeta {
    pub name: String,
    pub r#type: String,
}

#[derive(Debug, Serialize)]
pub struct QueryStats {
    pub rows: usize,
    pub elapsed_ms: u128,
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<CellValue>>,
    pub stats: QueryStats,
}

#[derive(Debug, Default, Serialize)]
pub struct DependencyGraph {
    pub root_db: String,
    pub root_table: String,
    pub nodes: Vec<DependencyNode>,
    pub edges: Vec<DependencyEdge>,
    pub truncated: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct DependencyNode {
    pub database: String,
    pub table: String,
    pub engine: String,
    pub kind: NodeKind,
}

#[derive(Debug, Default, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    #[default]
    Table,
    Dictionary,
}

#[derive(Debug, Default, Serialize)]
pub struct DependencyEdge {
    pub from_db: String,
    pub from_table: String,
    pub to_db: String,
    pub to_table: String,
    pub kind: EdgeKind,
}

#[derive(Debug, Default, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    #[default]
    Primary,
    Secondary,
    Dict,
}

#[derive(Debug, Default, Serialize)]
pub struct ColumnStats {
    pub database: String,
    pub table: String,
    pub column: String,
    pub type_str: String,
    pub total: Option<u64>,
    pub nulls: Option<u64>,
    pub uniq_approx: Option<u64>,
    pub min: String,
    pub max: String,
}

#[derive(Debug, Serialize)]
pub struct HistogramBucket {
    pub lower: f64,
    pub upper: f64,
    pub count: u64,
}

#[derive(Debug, Serialize)]
pub struct TopKValue {
    pub label: String,
    pub count: u64,
    pub is_null: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ColumnDistribution {
    Histogram {
        buckets: Vec<HistogramBucket>,
        notes: Vec<String>,
    },
    HistogramTime {
        buckets: Vec<HistogramBucket>,
        notes: Vec<String>,
    },
    TopK {
        values: Vec<TopKValue>,
        more: bool,
        notes: Vec<String>,
    },
    None {
        reason: String,
    },
}

#[derive(Debug, Default, Serialize)]
pub struct TableDetails {
    pub database: String,
    pub table: String,
    pub engine: String,
    pub engine_full: String,
    pub partition_key: String,
    pub sorting_key: String,
    pub primary_key: String,
    pub sampling_key: String,
    pub total_rows: Option<u64>,
    pub total_bytes: Option<u64>,
    pub comment: String,
    pub create_table_query: String,
    pub partitions: Vec<PartitionSummary>,
    pub columns: Vec<ColumnDetail>,
    pub skip_indexes: Vec<SkipIndex>,
    pub dependencies: Vec<String>,
    pub projections: Vec<Projection>,
}

#[derive(Debug, Default, Serialize)]
pub struct PartitionSummary {
    pub partition: String,
    pub rows: u64,
    pub bytes: u64,
    pub parts: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct ColumnDetail {
    pub name: String,
    pub type_str: String,
    pub default_kind: String,
    pub default_expression: String,
    pub compression_codec: String,
    pub comment: String,
}

#[derive(Debug, Default, Serialize)]
pub struct SkipIndex {
    pub name: String,
    pub type_str: String,
    pub expr: String,
    pub granularity: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct Projection {
    pub name: String,
    pub proj_type: String,
    pub expression: String,
}

#[derive(Debug, Default, Serialize)]
pub struct PartsSummary {
    pub active_count: u64,
    pub inactive_count: u64,
    pub total_active_bytes: u64,
    pub biggest_active_bytes: u64,
    pub oldest_active_modified_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PartsSummaryResult {
    Disabled,
    Enabled { summary: PartsSummary },
}

#[derive(Debug, Default, Serialize)]
pub struct ActiveMerge {
    pub elapsed_s: f64,
    pub progress: f64,
    pub result_part_name: String,
    pub num_parts: u64,
    pub rows_read: u64,
    pub bytes_read_uncompressed: u64,
    pub is_mutation: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct ServerHistoryEntry {
    pub query_id: String,
    pub event_time: String,
    pub query_duration_ms: Option<u64>,
    pub read_rows: Option<u64>,
    pub read_bytes: Option<u64>,
    pub memory_usage: Option<u64>,
    pub result_rows: Option<u64>,
    pub user: String,
    pub query: String,
    pub exception: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct ServerHistoryFilters {
    #[serde(default)]
    pub min_duration_ms: Option<u64>,
    #[serde(default)]
    pub min_memory_bytes: Option<u64>,
    #[serde(default)]
    pub exception_only: bool,
}

/// The hash is a string because JavaScript numbers round a UInt64 above 2^53.
#[derive(Debug, Default, Serialize)]
pub struct ServerHistoryGroup {
    pub normalized_query_hash: String,
    pub count: u64,
    pub avg_duration_ms: f64,
    pub max_duration_ms: u64,
    pub sum_read_bytes: u64,
    pub sum_memory: u64,
    pub sample_query: String,
    pub sample_query_id: String,
    pub first_seen: String,
    pub last_seen: String,
}

#[derive(Debug, Default, Serialize)]
pub struct RunningQuery {
    pub query_id: String,
    pub user: String,
    pub elapsed_s: f64,
    pub read_rows: Option<u64>,
    pub read_bytes: Option<u64>,
    pub memory_usage: Option<u64>,
    pub query: String,
}

const NEW_WINDOW: &str = "INTERVAL 5 MINUTE";

const USER_ERROR_CODES: &str = "(16, 36, 42, 43, 46, 47, 53, 60, 62, 81, 179, 184, 215, 386, 394)";

#[derive(Debug, Default, Serialize)]
pub struct ServerError {
    pub name: String,
    pub code: i64,
    pub count: u64,
    pub last_error_time: String,
    pub last_error_message: String,
    pub remote: bool,
    pub recent: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct MvFailure {
    pub event_time: String,
    pub view_name: String,
    pub view_type: String,
    pub status: String,
    pub exception: String,
    pub initial_query_id: String,
    pub initial_query: String,
    pub recent: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MvFailuresResult {
    Disabled,
    Enabled { rows: Vec<MvFailure> },
}

#[derive(Debug, Default, Serialize)]
pub struct FunctionDoc {
    pub name: String,
    pub description: String,
    pub is_aggregate: bool,
    pub case_insensitive: bool,
    pub syntax: String,
    pub arguments: String,
    pub returned_value: String,
    pub categories: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum FunctionsResult {
    Disabled,
    Enabled { rows: Vec<FunctionDoc> },
}

#[derive(Debug, Default, Serialize)]
pub struct ErrorPulse {
    pub errors_recent: u64,
    pub mv_failures_recent: u64,
    pub pending_mutations: u64,
    pub max_replica_queue: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct ChangedSetting {
    pub name: String,
    pub value: String,
    pub default_value: String,
    pub description: String,
}

#[derive(Debug, Default, Serialize)]
pub struct PendingMutation {
    pub database: String,
    pub table: String,
    pub mutation_id: String,
    pub command: String,
    pub create_time: String,
    pub parts_to_do: u64,
    pub latest_fail_reason: String,
}

#[derive(Debug, Default, Serialize)]
pub struct ReplicaQueueEntry {
    pub database: String,
    pub table: String,
    pub queue_size: u64,
    pub absolute_delay: u64,
    pub is_session_expired: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PendingMutationsResult {
    Disabled,
    Enabled { rows: Vec<PendingMutation> },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ReplicaQueueResult {
    Disabled,
    Enabled { rows: Vec<ReplicaQueueEntry> },
}

/// `engine_full` stays unparsed because its format varies (positional or `SETTINGS`).
#[derive(Debug, Default, Serialize)]
pub struct KafkaTableSummary {
    pub database: String,
    pub table: String,
    pub engine_full: String,
    pub num_consumers: u64,
    pub last_poll_time: Option<String>,
    pub messages_read: u64,
    pub num_rebalances: u64,
    pub last_exception: String,
    pub is_stuck: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum KafkaTablesResult {
    Disabled,
    Enabled { rows: Vec<KafkaTableSummary> },
}

#[derive(Debug, Default, Serialize)]
pub struct KafkaConsumer {
    pub database: String,
    pub table: String,
    pub consumer_id: String,
    pub assignments: String,
    pub last_poll_time: String,
    pub num_messages_read: u64,
    pub num_commits: u64,
    pub num_rebalance_revocations: u64,
    pub last_exception: String,
    pub last_used: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum KafkaConsumersResult {
    Disabled,
    Enabled { rows: Vec<KafkaConsumer> },
}

#[derive(Debug, Default, Serialize)]
pub struct KafkaPulse {
    pub kafka_tables: u64,
    pub kafka_stuck: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct ProfileSnapshot {
    pub query_duration_ms: Option<u64>,
    pub read_rows: Option<u64>,
    pub read_bytes: Option<u64>,
    pub written_rows: Option<u64>,
    pub written_bytes: Option<u64>,
    pub result_rows: Option<u64>,
    pub result_bytes: Option<u64>,
    pub memory_usage: Option<u64>,
    pub thread_count: Option<u64>,
    pub used_aggregate_functions: Vec<String>,
    pub used_dictionaries: Vec<String>,
    pub selected_parts: Option<u64>,
    pub selected_ranges: Option<u64>,
    pub selected_marks: Option<u64>,
    pub selected_rows: Option<u64>,
    pub compressed_read_blocks: Option<u64>,
    pub compressed_read_bytes: Option<u64>,
    pub uncompressed_cache_hits: Option<u64>,
    pub mark_cache_hits: Option<u64>,
    pub network_send_us: Option<u64>,
}

const GUARDRAIL_SETS: &[(&str, &str)] = &[
    ("max_result_rows", "1000000"),
    ("max_execution_time", "300"),
];
const JSON_COMPAT_SETS: &[(&str, &str)] = &[
    ("output_format_native_write_json_as_string", "1"),
    ("input_format_binary_read_json_as_string", "1"),
    ("output_format_binary_write_json_as_string", "1"),
];

fn set_statement(pairs: &[(&str, &str)]) -> String {
    let body = pairs
        .iter()
        .map(|(n, v)| format!("{n}={v}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("SET {body}")
}

async fn fanout_fallback<T, F, Fut>(
    fanout: &AtomicBool,
    disabled_flag: &AtomicBool,
    run: F,
) -> AppResult<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = AppResult<T>>,
{
    // Read the flag before running, not with `swap(false)` after. Monitor commands
    // run together, and with `swap` the others would show the raw error for one poll.
    let fanout_was_on = fanout.load(Ordering::Relaxed);
    match run().await {
        Ok(v) => Ok(v),
        Err(e) if fanout_was_on && e.is_remote_access_denied() => {
            fanout.store(false, Ordering::Relaxed);
            disabled_flag.store(true, Ordering::Relaxed);
            run().await
        }
        Err(e) => Err(e),
    }
}

pub fn client_name(lane: Option<&str>) -> String {
    let base = concat!("ch-gui ", env!("CARGO_PKG_VERSION"));
    match lane {
        Some(lane) => format!("{base} ({lane})"),
        None => base.to_string(),
    }
}

pub struct Client {
    inner: klickhouse::Client,
    /// The pool shares one `Arc<Client>`. Without this lock, two editor tabs would
    /// subscribe to the same log and progress broadcasts and read each other's packets.
    run_lock: tokio::sync::Mutex<()>,
    config_fingerprint: u64,
    connection_id: String,
    cluster_name: Option<String>,
    cluster_fanout: AtomicBool,
    fanout_disabled_this_session: AtomicBool,
    fanout_disabled_notified: AtomicBool,
    server_version: tokio::sync::OnceCell<String>,
}

impl Client {
    pub async fn connect(cfg: ConnectionConfig) -> AppResult<Self> {
        Self::connect_in_lane(cfg, None).await
    }

    /// `client_name`, `os_user`, and `client_hostname` are ClientInfo fields, not
    /// settings, so readonly=1 profiles accept them.
    pub async fn connect_in_lane(cfg: ConnectionConfig, lane: Option<&str>) -> AppResult<Self> {
        let config_fingerprint = cfg.fingerprint();
        let addr = format!("{}:{}", cfg.host, cfg.port);
        let connection_id = cfg.id.clone();
        let cluster_name = cfg.cluster_name.clone();
        let cluster_fanout = cfg.cluster_fanout;
        let options = klickhouse::ClientOptions {
            username: cfg.user,
            password: cfg.password,
            default_database: cfg.default_database.unwrap_or_default(),
            client_name: Some(client_name(lane)),
            os_user: whoami::fallible::username().unwrap_or_default(),
            client_hostname: whoami::fallible::hostname()
                .unwrap_or_else(|_| "localhost".to_string()),
            ..Default::default()
        };

        let inner = if cfg.secure {
            let tls_config = build_client_config(cfg.custom_ca_pem.as_deref())?;
            let connector = tokio_rustls::TlsConnector::from(tls_config);
            let server_name: rustls_pki_types::ServerName<'static> = cfg
                .host
                .try_into()
                .map_err(|e| AppError::Tls(format!("invalid TLS server name: {e}")))?;
            klickhouse::Client::connect_tls(addr, options, server_name, &connector).await?
        } else {
            klickhouse::Client::connect(addr, options).await?
        };

        // This is a session SET because `SETTINGS` appended to user SQL must precede
        // `FORMAT`. readonly=1 profiles reject it with code 164 and connect under their
        // own limits.
        let _ = inner.execute(set_statement(GUARDRAIL_SETS)).await;

        // The vendored klickhouse decodes JSON columns as String, which works only
        // when the server sends them as Strings in the Native format. Older servers
        // reject these settings, which is safe because they send no JSON columns.
        let _ = inner.execute(set_statement(JSON_COMPAT_SETS)).await;

        Ok(Self {
            inner,
            run_lock: tokio::sync::Mutex::new(()),
            config_fingerprint,
            connection_id,
            cluster_name,
            cluster_fanout: AtomicBool::new(cluster_fanout),
            fanout_disabled_this_session: AtomicBool::new(false),
            fanout_disabled_notified: AtomicBool::new(false),
            server_version: tokio::sync::OnceCell::new(),
        })
    }

    fn cluster_table_expr(&self, table: &str) -> String {
        if !self.cluster_fanout.load(Ordering::Relaxed) {
            return table.to_string();
        }
        let cluster = self
            .cluster_name
            .as_deref()
            .filter(|c| {
                !c.is_empty()
                    && c.chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
            })
            .unwrap_or("{cluster}");
        format!("clusterAllReplicas('{cluster}', {table})")
    }

    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }

    pub fn take_fanout_disabled_notice(&self) -> bool {
        self.fanout_disabled_this_session.load(Ordering::Relaxed)
            && !self.fanout_disabled_notified.swap(true, Ordering::Relaxed)
    }

    /// `build_sql` must take its table from [`Self::cluster_table_expr`] so the
    /// retry after a 497 reads the local table.
    async fn run_fanout_query(
        &self,
        tag: &str,
        build_sql: impl Fn() -> String,
    ) -> AppResult<QueryResult> {
        fanout_fallback(
            &self.cluster_fanout,
            &self.fanout_disabled_this_session,
            || async {
                self.run_query_inner(&build_sql(), tag, None, None, None)
                    .await
            },
        )
        .await
    }

    pub fn config_fingerprint(&self) -> u64 {
        self.config_fingerprint
    }

    /// A 497 earlier this session overrides `want == true`, so a stale payload
    /// cannot turn back on the fan-out the server refused.
    pub fn sync_cluster_fanout(&self, want: bool) {
        if !want {
            self.cluster_fanout.store(false, Ordering::Relaxed);
        } else if !self.fanout_disabled_this_session.load(Ordering::Relaxed) {
            self.cluster_fanout.store(true, Ordering::Relaxed);
        }
    }

    pub async fn server_version(&self) -> AppResult<String> {
        self.server_version
            .get_or_try_init(|| async {
                let res = self
                    .run_query_inner("SELECT version()", "chgui-version", None, None, None)
                    .await?;
                Ok(cell_to_str(res.rows.first().and_then(|r| r.first())))
            })
            .await
            .cloned()
    }

    pub fn is_closed(&self) -> bool {
        self.inner.is_closed()
    }

    pub async fn ping(&self) -> AppResult<()> {
        let fut = self.inner.execute("SELECT 1");
        timeout(Duration::from_secs(5), fut).await.map_err(|_| {
            AppError::ClickHouse("the connection test timed out after 5 seconds".into())
        })??;
        Ok(())
    }

    pub async fn run_query(
        &self,
        sql: &str,
        query_id: &str,
        on_progress: Option<ProgressCallback>,
    ) -> AppResult<QueryResult> {
        self.run_query_inner(sql, query_id, None, None, on_progress)
            .await
    }

    /// `system.tables.dependencies_*` omits a view's write target, so that edge
    /// comes from the `TO` clause of `create_table_query`.
    pub async fn fetch_dependency_graph(
        &self,
        database: &str,
        table: &str,
        max_depth: u32,
        max_nodes: u32,
    ) -> AppResult<DependencyGraph> {
        let mut out = DependencyGraph {
            root_db: database.to_string(),
            root_table: table.to_string(),
            ..Default::default()
        };

        use std::collections::{HashMap, HashSet};
        let mut visited: HashSet<(String, String)> = HashSet::new();
        let mut engines: HashMap<(String, String), String> = HashMap::new();
        let mut node_kinds: HashMap<(String, String), NodeKind> = HashMap::new();
        let mut predecessor: HashMap<(String, String), (String, String)> = HashMap::new();
        let root_key = (database.to_string(), table.to_string());
        visited.insert(root_key.clone());
        node_kinds.insert(root_key.clone(), NodeKind::Table);

        let mut frontier: Vec<(String, String)> = vec![root_key];
        let mut depth = 0u32;

        while !frontier.is_empty() && depth < max_depth {
            if (visited.len() as u32) >= max_nodes {
                out.truncated = true;
                break;
            }

            let tuples: Vec<String> = frontier
                .iter()
                .map(|(d, t)| format!("({}, {})", sql_string_literal(d), sql_string_literal(t),))
                .collect();
            let in_list = tuples.join(", ");
            // Older servers leave dictionaries out of `loading_dependencies_*`, so
            // `dict_refs` extracts them from `dict*('name', ...)` calls in the CREATE.
            let sql = format!(
                "SELECT \
                    database, name, engine, \
                    arrayStringConcat(\
                        arrayMap((d, t) -> concat(d, '.', t), \
                            dependencies_database, dependencies_table\
                        ), '||'\
                    ) AS deps, \
                    if(engine = 'MaterializedView', \
                       extract(create_table_query, \
                               '^CREATE\\\\s+(?:OR REPLACE\\\\s+)?\
                                MATERIALIZED VIEW\\\\s+\
                                (?:IF NOT EXISTS\\\\s+)?.+? TO ([^ (]+)'), \
                       ''\
                    ) AS to_target, \
                    if(engine = 'MaterializedView', \
                       arrayStringConcat(\
                           arrayMap((d, t) -> concat(d, '.', t), \
                               loading_dependencies_database, \
                               loading_dependencies_table\
                           ), '||'\
                       ), ''\
                    ) AS loading_deps, \
                    if(engine = 'MaterializedView', \
                       arrayStringConcat(\
                           extractAll(create_table_query, \
                               'dict[A-Za-z]*\\\\(\\\\s*''([^'']+)'''), \
                           '||'\
                       ), ''\
                    ) AS dict_refs \
                FROM system.tables \
                WHERE (database, name) IN ({in_list})"
            );

            let res = self
                .run_query_inner(&sql, "chgui-dep-level", None, None, None)
                .await?;
            let mut next_frontier: Vec<(String, String)> = Vec::new();
            for row in &res.rows {
                let db = cell_to_str(row.first());
                let tbl = cell_to_str(row.get(1));
                let engine = cell_to_str(row.get(2));
                engines.insert((db.clone(), tbl.clone()), engine.clone());

                let deps_str = cell_to_str(row.get(3));
                let to_target = cell_to_str(row.get(4));
                let loading_deps_str = cell_to_str(row.get(5));
                let dict_refs_str = cell_to_str(row.get(6));

                if !deps_str.is_empty() {
                    for dep in deps_str.split("||") {
                        if dep.is_empty() {
                            continue;
                        }
                        let (dep_db, dep_tbl) = match dep.split_once('.') {
                            Some((d, t)) => (d.to_string(), t.to_string()),
                            None => continue,
                        };
                        out.edges.push(DependencyEdge {
                            from_db: db.clone(),
                            from_table: tbl.clone(),
                            to_db: dep_db.clone(),
                            to_table: dep_tbl.clone(),
                            kind: EdgeKind::Primary,
                        });
                        let key = (dep_db, dep_tbl);
                        predecessor
                            .entry(key.clone())
                            .or_insert_with(|| (db.clone(), tbl.clone()));
                        if !visited.contains(&key) {
                            if (visited.len() as u32) >= max_nodes {
                                out.truncated = true;
                                break;
                            }
                            visited.insert(key.clone());
                            node_kinds.insert(key.clone(), NodeKind::Table);
                            next_frontier.push(key);
                        }
                    }
                }
                if out.truncated {
                    break;
                }

                let mut primary_refs: HashSet<(String, String)> = HashSet::new();
                if let Some(pred) = predecessor.get(&(db.clone(), tbl.clone())).cloned() {
                    primary_refs.insert(pred);
                }
                if engine == "MaterializedView" && !to_target.is_empty() {
                    if let Some((to_db, to_tbl)) = parse_mv_target(&to_target, &db) {
                        primary_refs.insert((to_db.clone(), to_tbl.clone()));
                        out.edges.push(DependencyEdge {
                            from_db: db.clone(),
                            from_table: tbl.clone(),
                            to_db: to_db.clone(),
                            to_table: to_tbl.clone(),
                            kind: EdgeKind::Primary,
                        });
                        let key = (to_db, to_tbl);
                        predecessor
                            .entry(key.clone())
                            .or_insert_with(|| (db.clone(), tbl.clone()));
                        if !visited.contains(&key) {
                            if (visited.len() as u32) >= max_nodes {
                                out.truncated = true;
                                break;
                            }
                            visited.insert(key.clone());
                            node_kinds.insert(key.clone(), NodeKind::Table);
                            next_frontier.push(key);
                        }
                    }
                }

                if engine == "MaterializedView" && !loading_deps_str.is_empty() {
                    for dep in loading_deps_str.split("||") {
                        if dep.is_empty() {
                            continue;
                        }
                        let (dep_db, dep_tbl) = match dep.split_once('.') {
                            Some((d, t)) => (d.to_string(), t.to_string()),
                            None => continue,
                        };
                        let key = (dep_db.clone(), dep_tbl.clone());
                        if primary_refs.contains(&key) {
                            continue;
                        }
                        // An MV's `loading_dependencies_*` can include itself on some servers.
                        if key == (db.clone(), tbl.clone()) {
                            continue;
                        }
                        out.edges.push(DependencyEdge {
                            from_db: db.clone(),
                            from_table: tbl.clone(),
                            to_db: dep_db,
                            to_table: dep_tbl,
                            kind: EdgeKind::Secondary,
                        });
                        if !visited.contains(&key) {
                            if (visited.len() as u32) >= max_nodes {
                                out.truncated = true;
                                break;
                            }
                            visited.insert(key.clone());
                            // Secondary nodes are not traversed, so they stay out of `next_frontier`.
                            node_kinds.entry(key).or_insert(NodeKind::Table);
                        }
                    }
                }
                if out.truncated {
                    break;
                }

                if engine == "MaterializedView" && !dict_refs_str.is_empty() {
                    for raw in dict_refs_str.split("||") {
                        if raw.is_empty() {
                            continue;
                        }
                        let (d_db, d_name) = match split_qualified(raw, &db) {
                            Some(pair) => pair,
                            None => continue,
                        };
                        let key = (d_db.clone(), d_name.clone());
                        out.edges.push(DependencyEdge {
                            from_db: db.clone(),
                            from_table: tbl.clone(),
                            to_db: d_db,
                            to_table: d_name,
                            kind: EdgeKind::Dict,
                        });
                        if !visited.contains(&key) {
                            if (visited.len() as u32) >= max_nodes {
                                out.truncated = true;
                                break;
                            }
                            visited.insert(key.clone());
                            node_kinds.insert(key, NodeKind::Dictionary);
                        }
                    }
                }
                if out.truncated {
                    break;
                }
            }

            frontier = next_frontier;
            depth += 1;
            if depth >= max_depth && !frontier.is_empty() {
                out.truncated = true;
            }
        }

        // Dictionaries are skipped because they live in `system.dictionaries`, not `system.tables`.
        let missing_nodes: Vec<(String, String)> = visited
            .iter()
            .filter(|k| {
                !engines.contains_key(*k)
                    && node_kinds.get(*k).copied().unwrap_or(NodeKind::Table)
                        != NodeKind::Dictionary
            })
            .cloned()
            .collect();
        if !missing_nodes.is_empty() {
            let tuples: Vec<String> = missing_nodes
                .iter()
                .map(|(d, t)| format!("({}, {})", sql_string_literal(d), sql_string_literal(t),))
                .collect();
            let in_list = tuples.join(", ");
            let sql = format!(
                "SELECT database, name, engine FROM system.tables \
                 WHERE (database, name) IN ({in_list})"
            );
            if let Ok(res) = self
                .run_query_inner(&sql, "chgui-dep-engines", None, None, None)
                .await
            {
                for row in &res.rows {
                    let db = cell_to_str(row.first());
                    let tbl = cell_to_str(row.get(1));
                    let engine = cell_to_str(row.get(2));
                    engines.insert((db, tbl), engine);
                }
            }
        }

        for (db, tbl) in visited {
            let engine = engines
                .get(&(db.clone(), tbl.clone()))
                .cloned()
                .unwrap_or_default();
            let kind = node_kinds
                .get(&(db.clone(), tbl.clone()))
                .copied()
                .unwrap_or(NodeKind::Table);
            out.nodes.push(DependencyNode {
                database: db,
                table: tbl,
                engine,
                kind,
            });
        }
        out.nodes.sort_by(|a, b| {
            let a_is_root = a.database == out.root_db && a.table == out.root_table;
            let b_is_root = b.database == out.root_db && b.table == out.root_table;
            b_is_root
                .cmp(&a_is_root)
                .then(a.database.cmp(&b.database))
                .then(a.table.cmp(&b.table))
        });

        let node_keys: std::collections::HashSet<(String, String)> = out
            .nodes
            .iter()
            .map(|n| (n.database.clone(), n.table.clone()))
            .collect();
        out.edges.retain(|e| {
            node_keys.contains(&(e.from_db.clone(), e.from_table.clone()))
                && node_keys.contains(&(e.to_db.clone(), e.to_table.clone()))
        });

        Ok(out)
    }

    /// `readonly=1` profiles refuse every setting change, `SETTINGS` clauses
    /// included (code 164). On that refusal the query runs again without the cap,
    /// under the same `query_id`, so `cancel_query` is the only limit left.
    async fn run_capped(&self, sql: &str, query_id: &str) -> AppResult<QueryResult> {
        const READONLY: i32 = 164;
        let capped = format!("{sql} SETTINGS max_execution_time = 60");
        match self
            .run_query_inner(&capped, query_id, None, None, None)
            .await
        {
            Err(e) if e.clickhouse_code() == Some(READONLY) => {
                self.run_query_inner(sql, query_id, None, None, None).await
            }
            other => other,
        }
    }

    pub async fn fetch_column_stats(
        &self,
        database: &str,
        table: &str,
        column: &str,
        query_id: &str,
    ) -> AppResult<ColumnStats> {
        let qualified = format!("{}.{}", quote_ident(database), quote_ident(table));
        let col_ident = quote_ident(column);

        let type_sql = format!(
            "SELECT type FROM system.columns \
             WHERE database = {db} AND table = {tbl} AND name = {col}",
            db = sql_string_literal(database),
            tbl = sql_string_literal(table),
            col = sql_string_literal(column),
        );
        let type_str = match self
            .run_query_inner(&type_sql, "chgui-column-type", None, None, None)
            .await
        {
            Ok(r) => r
                .rows
                .first()
                .and_then(|row| row.first())
                .map(|c| cell_to_str(Some(c)))
                .unwrap_or_default(),
            Err(e) => {
                tracing::warn!(target: "ch_gui_lib", error = %e, "column type lookup failed");
                String::new()
            }
        };

        // This query and the distribution queries use no aliases. ClickHouse resolves a
        // bare name to a SELECT alias before a column, so `count() AS total` turns
        // `uniq(total)` into a nested aggregate (code 184). Results are read by position.
        let stats_sql = format!(
            "SELECT \
                count(), \
                countIf({col} IS NULL), \
                uniq({col}), \
                toString(min({col})), \
                toString(max({col})) \
            FROM {qualified}",
            col = col_ident,
        );
        let res = self.run_capped(&stats_sql, query_id).await?;
        let mut out = ColumnStats {
            database: database.to_string(),
            table: table.to_string(),
            column: column.to_string(),
            type_str,
            ..Default::default()
        };
        if let Some(row) = res.rows.first() {
            out.total = row.first().and_then(cell_to_u64);
            out.nulls = row.get(1).and_then(cell_to_u64);
            out.uniq_approx = row.get(2).and_then(cell_to_u64);
            out.min = cell_to_str(row.get(3));
            out.max = cell_to_str(row.get(4));
        }
        Ok(out)
    }

    pub async fn fetch_column_distribution(
        &self,
        database: &str,
        table: &str,
        column: &str,
        query_id: &str,
    ) -> AppResult<ColumnDistribution> {
        let qualified = format!("{}.{}", quote_ident(database), quote_ident(table));
        let col_ident = quote_ident(column);

        let meta_sql = format!(
            "SELECT type, default_kind FROM system.columns \
             WHERE database = {db} AND table = {tbl} AND name = {col}",
            db = sql_string_literal(database),
            tbl = sql_string_literal(table),
            col = sql_string_literal(column),
        );
        let (type_str, default_kind) = match self
            .run_query_inner(&meta_sql, "chgui-column-dist-meta", None, None, None)
            .await
        {
            Ok(r) => r
                .rows
                .first()
                .map(|row| (cell_to_str(row.first()), cell_to_str(row.get(1))))
                .unwrap_or_default(),
            Err(e) => {
                tracing::warn!(target: "ch_gui_lib", error = %e, "column type lookup failed");
                (String::new(), String::new())
            }
        };

        if type_str.is_empty() {
            return Ok(ColumnDistribution::None {
                reason: "Column type not found.".into(),
            });
        }
        if default_kind.eq_ignore_ascii_case("ALIAS") {
            return Ok(ColumnDistribution::None {
                reason: "Alias columns have no distribution view. It would recompute the alias for every row.".into(),
            });
        }

        let inner = strip_type_wrappers(&type_str);
        if is_numeric_type(inner) {
            return self
                .run_histogram(&qualified, &col_ident, false, query_id)
                .await;
        }
        if is_time_type(inner) {
            return self
                .run_histogram(&qualified, &col_ident, true, query_id)
                .await;
        }
        if is_string_type(inner) {
            return self.run_top_k(&qualified, &col_ident, query_id).await;
        }
        Ok(ColumnDistribution::None {
            reason: format!("No distribution view for type {type_str}."),
        })
    }

    async fn run_histogram(
        &self,
        qualified: &str,
        col_ident: &str,
        is_time: bool,
        query_id: &str,
    ) -> AppResult<ColumnDistribution> {
        // `histogram` rejects Decimal (code 43), so numeric input is cast to Float64.
        let source_expr = if is_time {
            format!("toUnixTimestamp({col_ident})")
        } else {
            format!("toFloat64({col_ident})")
        };
        let sql =
            format!("SELECT untuple(arrayJoin(histogram(10)({source_expr}))) FROM {qualified}");
        let res = self.run_capped(&sql, query_id).await?;
        let mut buckets: Vec<HistogramBucket> = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            let lower = row.first().and_then(cell_to_f64);
            let upper = row.get(1).and_then(cell_to_f64);
            let count = row.get(2).and_then(cell_to_u64);
            if let (Some(lo), Some(hi), Some(c)) = (lower, upper, count) {
                buckets.push(HistogramBucket {
                    lower: lo,
                    upper: hi,
                    count: c,
                });
            }
        }
        let notes = vec!["Leaves out NULLs.".into(), "Scans the full column.".into()];
        Ok(if is_time {
            ColumnDistribution::HistogramTime { buckets, notes }
        } else {
            ColumnDistribution::Histogram { buckets, notes }
        })
    }

    async fn run_top_k(
        &self,
        qualified: &str,
        col_ident: &str,
        query_id: &str,
    ) -> AppResult<ColumnDistribution> {
        // Grouping by `is_null` keeps NULLs apart from real empty strings, because
        // both have an empty label.
        let is_null = format!("{col_ident} IS NULL");
        let label =
            format!("if({col_ident} IS NULL, '', substring(CAST({col_ident} AS String), 1, 40))");
        let sql = format!(
            "SELECT {is_null}, {label}, count() \
             FROM {qualified} \
             GROUP BY {is_null}, {label} \
             ORDER BY count() DESC \
             LIMIT 11"
        );
        let res = self.run_capped(&sql, query_id).await?;
        let more = res.rows.len() > 10;
        let mut values: Vec<TopKValue> = Vec::with_capacity(res.rows.len().min(10));
        for row in res.rows.iter().take(10) {
            let is_null = row
                .first()
                .and_then(cell_to_u64)
                .map(|n| n != 0)
                .unwrap_or(false);
            let label = cell_to_str(row.get(1));
            let count = row.get(2).and_then(cell_to_u64).unwrap_or(0);
            values.push(TopKValue {
                label,
                count,
                is_null,
            });
        }
        let notes = vec![
            "Shows NULLs as a separate bucket.".into(),
            "Scans the full column.".into(),
        ];
        Ok(ColumnDistribution::TopK {
            values,
            more,
            notes,
        })
    }

    pub async fn fetch_table_details(
        &self,
        database: &str,
        table: &str,
    ) -> AppResult<TableDetails> {
        let db_lit = sql_string_literal(database);
        let tbl_lit = sql_string_literal(table);
        let mut out = TableDetails {
            database: database.to_string(),
            table: table.to_string(),
            ..Default::default()
        };

        let overview_sql = format!(
            "SELECT \
                engine, engine_full, \
                partition_key, sorting_key, primary_key, sampling_key, \
                total_rows, total_bytes, \
                comment, create_table_query, \
                arrayStringConcat(\
                    arrayMap((d, t) -> concat(d, '.', t), \
                        dependencies_database, dependencies_table\
                    ), '||'\
                ) AS dependencies_s \
            FROM system.tables \
            WHERE database = {db_lit} AND name = {tbl_lit}"
        );
        let overview = self
            .run_query_inner(&overview_sql, "chgui-table-overview", None, None, None)
            .await?;
        if let Some(row) = overview.rows.first() {
            out.engine = cell_to_str(row.first());
            out.engine_full = cell_to_str(row.get(1));
            out.partition_key = cell_to_str(row.get(2));
            out.sorting_key = cell_to_str(row.get(3));
            out.primary_key = cell_to_str(row.get(4));
            out.sampling_key = cell_to_str(row.get(5));
            out.total_rows = row.get(6).and_then(cell_to_u64);
            out.total_bytes = row.get(7).and_then(cell_to_u64);
            out.comment = cell_to_str(row.get(8));
            out.create_table_query = cell_to_str(row.get(9));
            let deps_str = cell_to_str(row.get(10));
            if !deps_str.is_empty() {
                out.dependencies = deps_str
                    .split("||")
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect();
            }
        }

        let parts_sql = format!(
            "SELECT \
                partition, \
                sum(rows) AS rows, \
                sum(bytes_on_disk) AS bytes, \
                count() AS parts \
            FROM system.parts \
            WHERE active AND database = {db_lit} AND table = {tbl_lit} \
            GROUP BY partition \
            ORDER BY partition"
        );
        if let Ok(res) = self
            .run_query_inner(&parts_sql, "chgui-table-parts", None, None, None)
            .await
        {
            for row in &res.rows {
                out.partitions.push(PartitionSummary {
                    partition: cell_to_str(row.first()),
                    rows: row.get(1).and_then(cell_to_u64).unwrap_or(0),
                    bytes: row.get(2).and_then(cell_to_u64).unwrap_or(0),
                    parts: row.get(3).and_then(cell_to_u64).unwrap_or(0),
                });
            }
        }

        let cols_sql = format!(
            "SELECT \
                name, type, \
                default_kind, default_expression, \
                compression_codec, comment \
            FROM system.columns \
            WHERE database = {db_lit} AND table = {tbl_lit} \
            ORDER BY position"
        );
        if let Ok(res) = self
            .run_query_inner(&cols_sql, "chgui-table-columns", None, None, None)
            .await
        {
            for row in &res.rows {
                out.columns.push(ColumnDetail {
                    name: cell_to_str(row.first()),
                    type_str: cell_to_str(row.get(1)),
                    default_kind: cell_to_str(row.get(2)),
                    default_expression: cell_to_str(row.get(3)),
                    compression_codec: cell_to_str(row.get(4)),
                    comment: cell_to_str(row.get(5)),
                });
            }
        }

        let idx_sql = format!(
            "SELECT name, type_full AS type_str, expr, granularity \
            FROM system.data_skipping_indices \
            WHERE database = {db_lit} AND table = {tbl_lit}"
        );
        if let Ok(res) = self
            .run_query_inner(&idx_sql, "chgui-table-indexes", None, None, None)
            .await
        {
            for row in &res.rows {
                out.skip_indexes.push(SkipIndex {
                    name: cell_to_str(row.first()),
                    type_str: cell_to_str(row.get(1)),
                    expr: cell_to_str(row.get(2)),
                    granularity: row.get(3).and_then(cell_to_u64).unwrap_or(0),
                });
            }
        }

        let proj_sql = format!(
            "SELECT name, type, query AS expression \
            FROM system.projections \
            WHERE database = {db_lit} AND table = {tbl_lit}"
        );
        if let Ok(res) = self
            .run_query_inner(&proj_sql, "chgui-table-projections", None, None, None)
            .await
        {
            for row in &res.rows {
                out.projections.push(Projection {
                    name: cell_to_str(row.first()),
                    proj_type: cell_to_str(row.get(1)),
                    expression: cell_to_str(row.get(2)),
                });
            }
        }

        Ok(out)
    }

    /// Not wrapped in `clusterAllReplicas` because parts are per-replica.
    pub async fn fetch_parts_summary(
        &self,
        database: &str,
        table: &str,
    ) -> AppResult<PartsSummaryResult> {
        let sql = format!(
            "SELECT \
                countIf(active) AS active_count, \
                countIf(NOT active) AS inactive_count, \
                sumIf(bytes_on_disk, active) AS total_active_bytes, \
                maxIf(bytes_on_disk, active) AS biggest_active_bytes, \
                toString(minIf(modification_time, active), 'UTC') AS oldest_active_modified_at \
            FROM system.parts \
            WHERE database = {db} AND table = {tbl}",
            db = sql_string_literal(database),
            tbl = sql_string_literal(table),
        );
        let res = match self
            .run_query_inner(&sql, "chgui-parts-summary", None, None, None)
            .await
        {
            Ok(r) => r,
            Err(_) => return Ok(PartsSummaryResult::Disabled),
        };
        let mut summary = PartsSummary::default();
        if let Some(row) = res.rows.first() {
            summary.active_count = row.first().and_then(cell_to_u64).unwrap_or(0);
            summary.inactive_count = row.get(1).and_then(cell_to_u64).unwrap_or(0);
            summary.total_active_bytes = row.get(2).and_then(cell_to_u64).unwrap_or(0);
            summary.biggest_active_bytes = row.get(3).and_then(cell_to_u64).unwrap_or(0);
            // `minIf` over zero rows returns the epoch DateTime. Matching the epoch string
            // instead of `active_count` would also hide a real 1970 `modification_time`.
            summary.oldest_active_modified_at = if summary.active_count == 0 {
                None
            } else {
                let s = cell_to_str(row.get(4));
                if s.is_empty() {
                    None
                } else {
                    Some(s)
                }
            };
        }
        Ok(PartsSummaryResult::Enabled { summary })
    }

    /// Not wrapped in `clusterAllReplicas` because merges are per-replica.
    pub async fn fetch_active_merges(
        &self,
        database: &str,
        table: &str,
    ) -> AppResult<Vec<ActiveMerge>> {
        let sql = format!(
            "SELECT \
                elapsed, progress, result_part_name, \
                length(source_part_names) AS num_parts, \
                rows_read, bytes_read_uncompressed, is_mutation \
            FROM system.merges \
            WHERE database = {db} AND table = {tbl} \
            ORDER BY progress DESC \
            LIMIT 200",
            db = sql_string_literal(database),
            tbl = sql_string_literal(table),
        );
        let res = self
            .run_query_inner(&sql, "chgui-active-merges", None, None, None)
            .await?;
        let mut out = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            let elapsed_s = match row.first() {
                Some(CellValue::Float(n)) => *n,
                Some(CellValue::Int(n)) => *n as f64,
                Some(CellValue::Decimal(s) | CellValue::BigInt(s)) => s.parse().unwrap_or(0.0),
                _ => 0.0,
            };
            let progress = match row.get(1) {
                Some(CellValue::Float(n)) => *n,
                Some(CellValue::Int(n)) => *n as f64,
                Some(CellValue::Decimal(s) | CellValue::BigInt(s)) => s.parse().unwrap_or(0.0),
                _ => 0.0,
            };
            out.push(ActiveMerge {
                elapsed_s,
                progress,
                result_part_name: cell_to_str(row.get(2)),
                num_parts: row.get(3).and_then(cell_to_u64).unwrap_or(0),
                rows_read: row.get(4).and_then(cell_to_u64).unwrap_or(0),
                bytes_read_uncompressed: row.get(5).and_then(cell_to_u64).unwrap_or(0),
                is_mutation: match row.get(6) {
                    Some(CellValue::Int(n)) => *n != 0,
                    _ => false,
                },
            });
        }
        Ok(out)
    }

    pub async fn list_server_history(
        &self,
        limit: u32,
        filters: &ServerHistoryFilters,
    ) -> AppResult<Vec<ServerHistoryEntry>> {
        let limit = limit.min(500);
        let extra_filters = build_history_filter_fragment(filters);
        // The alias is `event_time_s` because reusing `event_time` shadows the column
        // in WHERE and ORDER BY, which would then compare a String to a DateTime.
        let sql = format!(
            "SELECT \
                query_id, \
                toString(event_time, 'UTC') AS event_time_s, \
                query_duration_ms, \
                read_rows, read_bytes, \
                memory_usage, \
                result_rows, \
                initial_user AS user, \
                query, \
                exception \
            FROM system.query_log \
            WHERE type != 'QueryStart' \
              AND event_time > now() - INTERVAL 7 DAY\
              {extra_filters} \
            ORDER BY event_time DESC \
            LIMIT {limit}"
        );
        let res = self
            .run_query_inner(&sql, "chgui-server-history", None, None, None)
            .await?;
        let mut out = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            let query_id = match row.first() {
                Some(CellValue::Str(s)) => s.clone(),
                _ => continue,
            };
            let event_time = match row.get(1) {
                Some(CellValue::Str(s) | CellValue::DateTime(s)) => s.clone(),
                _ => String::new(),
            };
            let query_duration_ms = row.get(2).and_then(cell_to_u64);
            let read_rows = row.get(3).and_then(cell_to_u64);
            let read_bytes = row.get(4).and_then(cell_to_u64);
            let memory_usage = row.get(5).and_then(cell_to_u64);
            let result_rows = row.get(6).and_then(cell_to_u64);
            let user = match row.get(7) {
                Some(CellValue::Str(s)) => s.clone(),
                _ => String::new(),
            };
            let query = match row.get(8) {
                Some(CellValue::Str(s)) => s.clone(),
                _ => String::new(),
            };
            let exception = match row.get(9) {
                Some(CellValue::Str(s)) => s.clone(),
                _ => String::new(),
            };
            out.push(ServerHistoryEntry {
                query_id,
                event_time,
                query_duration_ms,
                read_rows,
                read_bytes,
                memory_usage,
                result_rows,
                user,
                query,
                exception,
            });
        }
        Ok(out)
    }

    pub async fn list_server_history_grouped(
        &self,
        limit: u32,
        filters: &ServerHistoryFilters,
    ) -> AppResult<Vec<ServerHistoryGroup>> {
        let limit = limit.clamp(1, 20);
        let extra_filters = build_history_filter_fragment(filters);
        let sql = format!(
            "SELECT \
                toString(normalized_query_hash) AS hash_str, \
                count() AS cnt, \
                avg(query_duration_ms) AS avg_dur, \
                max(query_duration_ms) AS max_dur, \
                sum(read_bytes) AS sum_read_bytes, \
                sum(memory_usage) AS sum_memory, \
                substring(any(query), 1, 200) AS sample_query, \
                any(query_id) AS sample_query_id, \
                toString(min(event_time), 'UTC') AS first_seen, \
                toString(max(event_time), 'UTC') AS last_seen \
            FROM system.query_log \
            WHERE type != 'QueryStart' \
              AND event_time > now() - INTERVAL 7 DAY\
              {extra_filters} \
            GROUP BY normalized_query_hash \
            ORDER BY cnt DESC \
            LIMIT {limit}"
        );
        let res = self
            .run_query_inner(&sql, "chgui-server-history-grouped", None, None, None)
            .await?;
        let mut out = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            let normalized_query_hash = cell_to_str(row.first());
            if normalized_query_hash.is_empty() {
                continue;
            }
            let count = row.get(1).and_then(cell_to_u64).unwrap_or(0);
            let avg_duration_ms = match row.get(2) {
                Some(CellValue::Float(n)) => *n,
                Some(CellValue::Int(n)) => *n as f64,
                Some(CellValue::Decimal(s) | CellValue::BigInt(s)) => s.parse().unwrap_or(0.0),
                _ => 0.0,
            };
            let max_duration_ms = row.get(3).and_then(cell_to_u64).unwrap_or(0);
            let sum_read_bytes = row.get(4).and_then(cell_to_u64).unwrap_or(0);
            let sum_memory = row.get(5).and_then(cell_to_u64).unwrap_or(0);
            let sample_query = cell_to_str(row.get(6));
            let sample_query_id = cell_to_str(row.get(7));
            let first_seen = cell_to_str(row.get(8));
            let last_seen = cell_to_str(row.get(9));
            out.push(ServerHistoryGroup {
                normalized_query_hash,
                count,
                avg_duration_ms,
                max_duration_ms,
                sum_read_bytes,
                sum_memory,
                sample_query,
                sample_query_id,
                first_seen,
                last_seen,
            });
        }
        Ok(out)
    }

    pub async fn list_running_queries(&self) -> AppResult<Vec<RunningQuery>> {
        // `run_query_inner` tags internal probes `chgui:chgui-...` and user queries
        // `chgui:{uuid}`. The LIKE hides the probes from this panel.
        let sql = "SELECT \
                query_id, \
                initial_user, \
                elapsed, \
                read_rows, \
                read_bytes, \
                memory_usage, \
                query \
            FROM system.processes \
            WHERE query_id != '' \
              AND query NOT LIKE '%-- chgui:chgui-%' \
            ORDER BY elapsed DESC \
            LIMIT 200";
        let res = self
            .run_query_inner(sql, "chgui-processes", None, None, None)
            .await?;
        let mut out = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            let query_id = match row.first() {
                Some(CellValue::Str(s)) => s.clone(),
                _ => continue,
            };
            let user = match row.get(1) {
                Some(CellValue::Str(s)) => s.clone(),
                _ => String::new(),
            };
            let elapsed_s = match row.get(2) {
                Some(CellValue::Float(n)) => *n,
                Some(CellValue::Int(n)) => *n as f64,
                Some(CellValue::Decimal(s) | CellValue::BigInt(s)) => s.parse().unwrap_or(0.0),
                _ => 0.0,
            };
            let read_rows = row.get(3).and_then(cell_to_u64);
            let read_bytes = row.get(4).and_then(cell_to_u64);
            let memory_usage = row.get(5).and_then(cell_to_u64);
            let query = match row.get(6) {
                Some(CellValue::Str(s)) => s.clone(),
                _ => String::new(),
            };
            out.push(RunningQuery {
                query_id,
                user,
                elapsed_s,
                read_rows,
                read_bytes,
                memory_usage,
                query,
            });
        }
        Ok(out)
    }

    /// `SHOW GRANTS FINAL` includes granted roles, and readonly users may run it.
    pub async fn can_kill_others(&self) -> AppResult<bool> {
        let res = self
            .run_query_inner("SHOW GRANTS FINAL", "chgui-grants", None, None, None)
            .await?;
        Ok(grants_allow_kill(res.rows.iter().filter_map(
            |r| match r.first() {
                Some(CellValue::Str(s)) => Some(s.as_str()),
                _ => None,
            },
        )))
    }

    /// `system.query_log` flushes on a timer, so the row can appear seconds late.
    pub async fn fetch_query_profile(&self, query_id: &str) -> AppResult<Option<ProfileSnapshot>> {
        // `CellValue` holds arrays as rendered text in `Other`, so the SQL joins array
        // entries with `||` for `cell_to_string_list` to split.
        let sql = format!(
            "SELECT
                query_duration_ms,
                read_rows, read_bytes,
                written_rows, written_bytes,
                result_rows, result_bytes,
                memory_usage,
                length(thread_ids) AS thread_count,
                arrayStringConcat(used_aggregate_functions, '||') AS used_aggregate_functions_s,
                arrayStringConcat(used_dictionaries, '||') AS used_dictionaries_s,
                ProfileEvents['SelectedParts']                   AS selected_parts,
                ProfileEvents['SelectedRanges']                  AS selected_ranges,
                ProfileEvents['SelectedMarks']                   AS selected_marks,
                ProfileEvents['SelectedRows']                    AS selected_rows,
                ProfileEvents['CompressedReadBufferBlocks']      AS compressed_read_blocks,
                ProfileEvents['CompressedReadBufferBytes']       AS compressed_read_bytes,
                ProfileEvents['UncompressedCacheHits']           AS uncompressed_cache_hits,
                ProfileEvents['MarkCacheHits']                   AS mark_cache_hits,
                ProfileEvents['NetworkSendElapsedMicroseconds']  AS network_send_us
            FROM system.query_log
            WHERE query_id = {}
              AND type != 'QueryStart'
            ORDER BY event_time DESC
            LIMIT 1",
            sql_string_literal(query_id),
        );

        let delays_ms = [0u64, 2000, 4000, 8000];
        for (attempt, delay_ms) in delays_ms.iter().enumerate() {
            if *delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(*delay_ms)).await;
            }
            let probe_id = format!("chgui-profile-{}-{}", query_id, attempt);
            let res = self
                .run_query_inner(&sql, &probe_id, None, None, None)
                .await?;
            if let Some(row) = res.rows.first() {
                return Ok(Some(row_to_profile(row)));
            }
        }
        Ok(None)
    }

    pub async fn run_query_with_logs(
        &self,
        sql: &str,
        query_id: &str,
        log_level: &str,
        on_log: LogCallback,
        on_progress: Option<ProgressCallback>,
    ) -> AppResult<QueryResult> {
        self.run_query_inner(sql, query_id, Some(log_level), Some(on_log), on_progress)
            .await
    }

    async fn run_query_inner(
        &self,
        sql: &str,
        query_id: &str,
        log_level: Option<&str>,
        on_log: Option<LogCallback>,
        on_progress: Option<ProgressCallback>,
    ) -> AppResult<QueryResult> {
        let _run_guard = self.run_lock.lock().await;
        let started = std::time::Instant::now();

        // Subscribe before issuing any command so the first log batch cannot be missed.
        // `_qid` is ignored because klickhouse does not expose its per-dispatch UUID, and
        // `run_lock` makes every packet between subscribe and abort belong to this query.
        // Only `Closed` ends the loop. `Lagged` is recoverable, and exiting on it would
        // stop log streaming for the rest of the query.
        let on_log = on_log.map(std::sync::Arc::new);
        let forwarder = on_log.clone().map(|cb| {
            let mut rx = self.inner.subscribe_logs();
            AbortOnDrop(tokio::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok((_qid, entries)) => cb(LogEvent::Lines(entries)),
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            }))
        });

        let progress_forwarder = on_progress.map(|cb| {
            let mut rx = self.inner.subscribe_progress();
            AbortOnDrop(tokio::spawn(async move {
                let mut snapshot = ProgressSnapshot::default();
                loop {
                    match rx.recv().await {
                        Ok((_qid, delta)) => {
                            snapshot.accumulate(delta);
                            cb(snapshot);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            }))
        });

        let log_level_set = if let Some(l) = log_level {
            let lower = l.to_ascii_lowercase();
            if !ALLOWED_LOG_LEVELS.contains(&lower.as_str()) {
                return Err(AppError::Invalid(format!("invalid log level: {l}")));
            }
            // readonly=1 profiles reject SET, so the query runs without server logs. The
            // callback gets that error because the Logs panel would otherwise wait forever.
            let ok = self
                .inner
                .execute(format!("SET send_logs_level='{lower}'"))
                .await
                .is_ok();
            if !ok {
                if let Some(cb) = &on_log {
                    cb(LogEvent::Unavailable);
                }
            }
            ok
        } else {
            false
        };

        // `cancel_query` finds the running query by this tag.
        let wrapped = format!("-- chgui:{query_id}\n{sql}");
        let result: AppResult<(Vec<ColumnMeta>, Vec<Vec<CellValue>>)> = async {
            let mut stream = self.inner.query_raw(wrapped).await?;
            let mut rows: Vec<Vec<CellValue>> = Vec::new();
            let mut columns: Vec<ColumnMeta> = Vec::new();
            while let Some(block) = stream.next().await {
                let block = block?;
                if columns.is_empty() {
                    columns = block
                        .column_types
                        .iter()
                        .map(|(name, ty)| ColumnMeta {
                            name: name.clone(),
                            r#type: ty.to_string(),
                        })
                        .collect();
                }
                for row in block.iter_rows() {
                    let mut cells = Vec::with_capacity(columns.len());
                    for ((_name, value), (_, ty)) in row.into_iter().zip(block.column_types.iter())
                    {
                        cells.push(convert_typed(value, ty));
                    }
                    rows.push(cells);
                }
            }
            Ok((columns, rows))
        }
        .await;

        if log_level_set {
            let _ = self.inner.execute("SET send_logs_level='none'").await;
        }
        drop(forwarder);
        drop(progress_forwarder);

        let (columns, rows) = match result {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(
                    target: "ch_gui_lib",
                    query_id,
                    error = %e,
                    "run_query_inner failed",
                );
                return Err(e);
            }
        };
        let n = rows.len();
        Ok(QueryResult {
            columns,
            rows,
            stats: QueryStats {
                rows: n,
                elapsed_ms: started.elapsed().as_millis(),
            },
        })
    }

    pub async fn list_server_errors(&self) -> AppResult<Vec<ServerError>> {
        // This SELECT does not alias a column to its source name. A ClickHouse alias also
        // applies in WHERE and ORDER BY, which would then compare a String to a DateTime.
        let res = self
            .run_fanout_query("chgui-server-errors", || {
                let cluster_table = self.cluster_table_expr("system.errors");
                format!(
                    "SELECT \
                        name, \
                        code, \
                        value, \
                        toString(last_error_time, 'UTC'), \
                        last_error_message, \
                        remote, \
                        last_error_time > now() - {NEW_WINDOW} \
                          AND code NOT IN {USER_ERROR_CODES} \
                    FROM {cluster_table} \
                    WHERE value > 0 \
                      AND last_error_time > now() - INTERVAL 7 DAY \
                    ORDER BY last_error_time DESC \
                    LIMIT 200"
                )
            })
            .await?;
        let mut out = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            let name = match row.first() {
                Some(CellValue::Str(s)) => s.clone(),
                _ => continue,
            };
            let code = match row.get(1) {
                Some(CellValue::Int(n)) => *n,
                _ => 0,
            };
            let count = row.get(2).and_then(cell_to_u64).unwrap_or(0);
            let last_error_time = cell_to_str(row.get(3));
            let last_error_message = cell_to_str(row.get(4));
            let remote = matches!(row.get(5), Some(CellValue::Int(n)) if *n != 0);
            let recent = matches!(row.get(6), Some(CellValue::Int(n)) if *n != 0);
            out.push(ServerError {
                name,
                code,
                count,
                last_error_time,
                last_error_message,
                remote,
                recent,
            });
        }
        Ok(out)
    }

    pub async fn list_mv_failures(&self, view_name: Option<&str>) -> AppResult<MvFailuresResult> {
        let probe = self
            .run_query_inner(
                "SELECT count() FROM system.tables \
                 WHERE database = 'system' AND name = 'query_views_log'",
                "chgui-mv-probe",
                None,
                None,
                None,
            )
            .await?;
        let exists = first_u64(&probe) > 0;
        if !exists {
            return Ok(MvFailuresResult::Disabled);
        }

        let view_filter = match view_name {
            Some(v) => format!("AND view_name = {}", sql_string_literal(v)),
            None => String::new(),
        };
        // This uses two queries because a JOIN reads 7 days of `query_log` into server
        // memory to return at most 200 rows.
        let res = self
            .run_fanout_query("chgui-mv-failures", || {
                let views_log = self.cluster_table_expr("system.query_views_log");
                format!(
                    "SELECT \
                        toString(event_time, 'UTC') AS event_time_s, \
                        view_name, \
                        toString(view_type) AS view_type_s, \
                        toString(status) AS status_s, \
                        exception, \
                        initial_query_id, \
                        event_time > now() - {NEW_WINDOW} \
                    FROM {views_log} \
                    WHERE status != 'QueryFinish' \
                      AND event_time > now() - INTERVAL 7 DAY \
                      {view_filter} \
                    ORDER BY event_time DESC \
                    LIMIT 200"
                )
            })
            .await?;
        let mut rows = Vec::with_capacity(res.rows.len());
        let mut ids_for_lookup: Vec<String> = Vec::new();
        for row in &res.rows {
            let event_time = cell_to_str(row.first());
            let view_name = cell_to_str(row.get(1));
            if view_name.is_empty() {
                continue;
            }
            let view_type = cell_to_str(row.get(2));
            let status = cell_to_str(row.get(3));
            let exception = cell_to_str(row.get(4));
            let initial_query_id = cell_to_str(row.get(5));
            let recent = matches!(row.get(6), Some(CellValue::Int(n)) if *n != 0);
            if !initial_query_id.is_empty() {
                ids_for_lookup.push(initial_query_id.clone());
            }
            rows.push(MvFailure {
                event_time,
                view_name,
                view_type,
                status,
                exception,
                initial_query_id,
                initial_query: String::new(),
                recent,
            });
        }

        if !ids_for_lookup.is_empty() {
            let ids_list = dedup_sorted_ids(&mut ids_for_lookup)
                .iter()
                .map(|id| sql_string_literal(id))
                .collect::<Vec<_>>()
                .join(",");
            let query_log = self.cluster_table_expr("system.query_log");
            let lookup_sql = format!(
                "SELECT query_id, query FROM {query_log} \
                 WHERE query_id IN ({ids_list}) \
                   AND type = 'QueryFinish' \
                   AND event_time > now() - INTERVAL 7 DAY"
            );
            if let Ok(lookup_res) = self
                .run_query_inner(&lookup_sql, "chgui-mv-insert-lookup", None, None, None)
                .await
            {
                let pairs: Vec<(String, String)> = lookup_res
                    .rows
                    .iter()
                    .map(|row| (cell_to_str(row.first()), cell_to_str(row.get(1))))
                    .collect();
                merge_initial_queries(&mut rows, &pairs);
            }
        }
        Ok(MvFailuresResult::Enabled { rows })
    }

    /// Older servers lack some of these columns, so a probe picks which to select.
    /// Not wrapped in `clusterAllReplicas` because functions come with the server build.
    pub async fn list_functions(&self) -> AppResult<FunctionsResult> {
        let probe_sql = "SELECT name FROM system.columns \
            WHERE database = 'system' AND table = 'functions' \
              AND name IN ('description','syntax','arguments','returned_value','categories')";
        let probe = self
            .run_query_inner(probe_sql, "chgui-functions-probe", None, None, None)
            .await?;
        let mut has_description = false;
        let mut has_syntax = false;
        let mut has_arguments = false;
        let mut has_returned_value = false;
        let mut has_categories = false;
        for row in &probe.rows {
            match cell_to_str(row.first()).as_str() {
                "description" => has_description = true,
                "syntax" => has_syntax = true,
                "arguments" => has_arguments = true,
                "returned_value" => has_returned_value = true,
                "categories" => has_categories = true,
                _ => {}
            }
        }
        let pick = |name: &str, present: bool| -> String {
            if present {
                format!("coalesce({name}, '') AS {name}")
            } else {
                format!("'' AS {name}")
            }
        };
        let sql = format!(
            "SELECT \
                name, \
                {desc}, \
                is_aggregate, \
                case_insensitive, \
                {syn}, \
                {args}, \
                {ret}, \
                {cat} \
            FROM system.functions \
            ORDER BY name",
            desc = pick("description", has_description),
            syn = pick("syntax", has_syntax),
            args = pick("arguments", has_arguments),
            ret = pick("returned_value", has_returned_value),
            cat = pick("categories", has_categories),
        );
        let res = match self
            .run_query_inner(&sql, "chgui-functions", None, None, None)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    target: "ch_gui_lib",
                    error = %e,
                    "list_functions data query failed; falling back to bundle"
                );
                return Ok(FunctionsResult::Disabled);
            }
        };
        let mut rows = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            let name = cell_to_str(row.first());
            if name.is_empty() {
                continue;
            }
            rows.push(FunctionDoc {
                name,
                description: cell_to_str(row.get(1)),
                is_aggregate: matches!(row.get(2), Some(CellValue::Int(n)) if *n != 0),
                case_insensitive: matches!(row.get(3), Some(CellValue::Int(n)) if *n != 0),
                syntax: cell_to_str(row.get(4)),
                arguments: cell_to_str(row.get(5)),
                returned_value: cell_to_str(row.get(6)),
                categories: cell_to_str(row.get(7)),
            });
        }
        Ok(FunctionsResult::Enabled { rows })
    }

    /// Runs separate counts because one combined SELECT would fail whole when any
    /// system table is missing or ungranted.
    pub async fn error_pulse(&self) -> AppResult<ErrorPulse> {
        // A 497 on this first query turns fan-out off, so the later queries read the
        // local tables too.
        let errors_res = self
            .run_fanout_query("chgui-pulse-errors", || {
                let errors_table = self.cluster_table_expr("system.errors");
                format!(
                    "SELECT uniqExact(name) FROM {errors_table} \
                     WHERE last_error_time > now() - {NEW_WINDOW} \
                       AND code NOT IN {USER_ERROR_CODES}"
                )
            })
            .await?;
        let errors_recent = first_u64(&errors_res);

        let views_log_table = self.cluster_table_expr("system.query_views_log");
        let mv_sql = format!(
            "SELECT uniqExact(view_name) FROM {views_log_table} \
             WHERE status != 'QueryFinish' \
               AND event_time > now() - {NEW_WINDOW}"
        );
        let mv_failures_recent = self.count_or_zero(&mv_sql, "chgui-pulse-mv").await;

        let mutations_table = self.cluster_table_expr("system.mutations");
        let mutations_sql = format!("SELECT count() FROM {mutations_table} WHERE is_done = 0");
        let pending_mutations = self.count_or_zero(&mutations_sql, "chgui-pulse-mut").await;

        let replicas_table = self.cluster_table_expr("system.replicas");
        let replicas_sql =
            format!("SELECT coalesce(toUInt64(max(queue_size)), 0) FROM {replicas_table}");
        let max_replica_queue = self.count_or_zero(&replicas_sql, "chgui-pulse-rep").await;

        Ok(ErrorPulse {
            errors_recent,
            mv_failures_recent,
            pending_mutations,
            max_replica_queue,
        })
    }

    async fn count_or_zero(&self, sql: &str, tag: &str) -> u64 {
        match self.run_query_inner(sql, tag, None, None, None).await {
            Ok(res) => first_u64(&res),
            Err(e) => {
                tracing::warn!(target: "ch_gui_lib", tag, error = %e, "pulse sub-query failed; counting 0");
                0
            }
        }
    }

    pub async fn list_pending_mutations(&self) -> AppResult<PendingMutationsResult> {
        let res = match self
            .run_fanout_query("chgui-pending-mutations", || {
                let mutations_table = self.cluster_table_expr("system.mutations");
                format!(
                    "SELECT \
                        database, \
                        table, \
                        mutation_id, \
                        substring(command, 1, 200) AS command, \
                        toString(create_time, 'UTC') AS create_time, \
                        parts_to_do, \
                        latest_fail_reason \
                    FROM {mutations_table} \
                    WHERE is_done = 0 \
                    ORDER BY create_time ASC \
                    LIMIT 200"
                )
            })
            .await
        {
            Ok(r) => r,
            Err(_) => return Ok(PendingMutationsResult::Disabled),
        };
        let mut rows = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            rows.push(PendingMutation {
                database: cell_to_str(row.first()),
                table: cell_to_str(row.get(1)),
                mutation_id: cell_to_str(row.get(2)),
                command: cell_to_str(row.get(3)),
                create_time: cell_to_str(row.get(4)),
                parts_to_do: row.get(5).and_then(cell_to_u64).unwrap_or(0),
                latest_fail_reason: cell_to_str(row.get(6)),
            });
        }
        Ok(PendingMutationsResult::Enabled { rows })
    }

    /// Excludes the pairs `connect` SETs on every session. The match is on exact
    /// (name, value), so a profile that sets a different value still shows.
    pub async fn list_changed_settings(&self) -> AppResult<Vec<ChangedSetting>> {
        let exclusions = GUARDRAIL_SETS
            .iter()
            .chain(JSON_COMPAT_SETS)
            .map(|(n, v)| format!("AND NOT (name = '{n}' AND value = '{v}') "))
            .collect::<String>();
        let query_with = |default_col: &str| {
            format!(
                "SELECT name, value, {default_col}, description \
                 FROM system.settings \
                 WHERE changed = 1 {exclusions} \
                 ORDER BY name"
            )
        };
        let res = match self
            .run_query_inner(
                &query_with("`default`"),
                "chgui-changed-settings",
                None,
                None,
                None,
            )
            .await
        {
            Ok(res) => res,
            // Older servers have no `system.settings.default`.
            Err(e) if e.to_string().contains("default") => {
                self.run_query_inner(
                    &query_with("'' AS default_value"),
                    "chgui-changed-settings",
                    None,
                    None,
                    None,
                )
                .await?
            }
            Err(e) => return Err(e),
        };
        let mut rows = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            rows.push(ChangedSetting {
                name: cell_to_str(row.first()),
                value: cell_to_str(row.get(1)),
                default_value: cell_to_str(row.get(2)),
                description: cell_to_str(row.get(3)),
            });
        }
        Ok(rows)
    }

    pub async fn list_replica_queue(&self) -> AppResult<ReplicaQueueResult> {
        let res = match self
            .run_fanout_query("chgui-replica-queue", || {
                let replicas_table = self.cluster_table_expr("system.replicas");
                format!(
                    "SELECT \
                        database, \
                        table, \
                        toUInt64(queue_size) AS queue_size, \
                        toUInt64(absolute_delay) AS absolute_delay, \
                        is_session_expired \
                    FROM {replicas_table} \
                    WHERE queue_size > 0 OR is_session_expired = 1 \
                    ORDER BY queue_size DESC \
                    LIMIT 200"
                )
            })
            .await
        {
            Ok(r) => r,
            Err(_) => return Ok(ReplicaQueueResult::Disabled),
        };
        let mut rows = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            rows.push(ReplicaQueueEntry {
                database: cell_to_str(row.first()),
                table: cell_to_str(row.get(1)),
                queue_size: row.get(2).and_then(cell_to_u64).unwrap_or(0),
                absolute_delay: row.get(3).and_then(cell_to_u64).unwrap_or(0),
                is_session_expired: match row.get(4) {
                    Some(CellValue::Int(n)) => *n != 0,
                    _ => false,
                },
            });
        }
        Ok(ReplicaQueueResult::Enabled { rows })
    }

    /// This uses two queries and a rollup in Rust because a LEFT JOIN would depend on
    /// `join_use_nulls` (default-filled or NULL columns on unmatched rows).
    pub async fn list_kafka_tables(&self) -> AppResult<KafkaTablesResult> {
        let probe = self
            .run_query_inner(
                "SELECT count() FROM system.tables \
                 WHERE database = 'system' AND name = 'kafka_consumers'",
                "chgui-kafka-probe",
                None,
                None,
                None,
            )
            .await?;
        let exists = first_u64(&probe) > 0;
        if !exists {
            return Ok(KafkaTablesResult::Disabled);
        }

        // Not wrapped in `clusterAllReplicas` because the table list barely varies by replica.
        let tables_sql = "SELECT \
                database, \
                name, \
                substring(engine_full, 1, 2000) \
            FROM system.tables \
            WHERE engine LIKE 'Kafka%' \
            ORDER BY database, name"
            .to_string();
        let tables_res = self
            .run_query_inner(&tables_sql, "chgui-kafka-tables", None, None, None)
            .await?;
        if tables_res.rows.is_empty() {
            return Ok(KafkaTablesResult::Enabled { rows: vec![] });
        }

        // The WHERE leaves out never-started consumer slots that the server can pre-create.
        // `exceptions.*` arrays are not guaranteed newest-last, which rules out `[-1]`.
        // Broker-connection failures (DNS, auth) go only to the server log, not this column.
        let consumer_rows = match self
            .run_fanout_query("chgui-kafka-consumers-all", || {
                let consumers_tbl = self.cluster_table_expr("system.kafka_consumers");
                format!(
                    "SELECT \
                        database, \
                        table, \
                        consumer_id, \
                        toString(last_poll_time, 'UTC'), \
                        toInt64(dateDiff('second', last_poll_time, now())), \
                        toUInt64(num_messages_read), \
                        toUInt64(num_rebalance_revocations), \
                        if(length(exceptions.text) > 0, \
                            substring(exceptions.text[indexOf(exceptions.time, arrayMax(exceptions.time))], 1, 2000), \
                            ''), \
                        if(length(exceptions.time) > 0, toInt64(dateDiff('second', arrayMax(exceptions.time), now())), toInt64(-1)) \
                    FROM {consumers_tbl} \
                    WHERE last_poll_time > toDateTime('1970-01-02') \
                       OR length(exceptions.text) > 0"
                )
            })
            .await
        {
            Ok(r) => r.rows,
            Err(_) => Vec::new(),
        };

        let parsed_rows = consumer_rows
            .iter()
            .filter_map(|row| parse_kafka_consumer_row(row))
            .collect::<Vec<_>>();
        let mut map = aggregate_kafka_consumers(parsed_rows);

        let mut out = Vec::with_capacity(tables_res.rows.len());
        for row in &tables_res.rows {
            let database = match row.first() {
                Some(CellValue::Str(s)) => s.clone(),
                _ => continue,
            };
            let table = match row.get(1) {
                Some(CellValue::Str(s)) => s.clone(),
                _ => continue,
            };
            let engine_full = cell_to_str(row.get(2));
            let agg = map
                .remove(&(database.clone(), table.clone()))
                .unwrap_or_default();
            let last_poll_time = if agg.freshest_poll_time.is_empty() {
                None
            } else {
                Some(agg.freshest_poll_time)
            };
            let is_stuck =
                !agg.last_exception.is_empty() || agg.freshest_age.is_none_or(|age| age > 300);
            out.push(KafkaTableSummary {
                database,
                table,
                engine_full,
                num_consumers: agg.consumer_ids.len() as u64,
                last_poll_time,
                messages_read: agg.messages_read,
                num_rebalances: agg.num_rebalances,
                last_exception: agg.last_exception,
                is_stuck,
            });
        }
        out.sort_by(|a, b| {
            b.is_stuck
                .cmp(&a.is_stuck)
                .then_with(|| a.database.cmp(&b.database))
                .then_with(|| a.table.cmp(&b.table))
        });
        Ok(KafkaTablesResult::Enabled { rows: out })
    }

    pub async fn list_kafka_consumers(
        &self,
        database: &str,
        table: &str,
    ) -> AppResult<KafkaConsumersResult> {
        let probe = self
            .run_query_inner(
                "SELECT count() FROM system.tables \
                 WHERE database = 'system' AND name = 'kafka_consumers'",
                "chgui-kafka-consumers-probe",
                None,
                None,
                None,
            )
            .await?;
        let exists = first_u64(&probe) > 0;
        if !exists {
            return Ok(KafkaConsumersResult::Disabled);
        }

        let db_lit = sql_string_literal(database);
        let tbl_lit = sql_string_literal(table);
        // The probe confirmed the table exists, so an error here has another cause.
        // `Disabled` would misreport it as an unsupported server.
        let res = self
            .run_fanout_query("chgui-kafka-consumers", || {
                let consumers_tbl = self.cluster_table_expr("system.kafka_consumers");
                // `assignments.*` are parallel Nested arrays, not an Array(Tuple). A zero
                // `last_used` means the consumer never received a message.
                format!(
                    "SELECT \
                        database, \
                        table, \
                        consumer_id, \
                        arrayStringConcat( \
                            arrayMap( \
                                (topic, part, offset) -> concat(topic, '/', toString(part), '@', toString(offset)), \
                                assignments.topic, \
                                assignments.partition_id, \
                                assignments.current_offset \
                            ), \
                            ', ' \
                        ), \
                        toString(last_poll_time, 'UTC'), \
                        toUInt64(num_messages_read), \
                        toUInt64(num_commits), \
                        toUInt64(num_rebalance_revocations), \
                        substring( \
                            if(length(exceptions.text) > 0, \
                               exceptions.text[indexOf(exceptions.time, arrayMax(exceptions.time))], \
                               ''), \
                            1, 4000 \
                        ), \
                        if(last_used > 0, toString(last_used, 'UTC'), '') \
                    FROM {consumers_tbl} \
                    WHERE database = {db_lit} AND table = {tbl_lit} \
                    ORDER BY last_poll_time DESC \
                    LIMIT 200"
                )
            })
            .await?;
        let mut rows = Vec::with_capacity(res.rows.len());
        for row in &res.rows {
            rows.push(KafkaConsumer {
                database: cell_to_str(row.first()),
                table: cell_to_str(row.get(1)),
                consumer_id: cell_to_str(row.get(2)),
                assignments: cell_to_str(row.get(3)),
                last_poll_time: cell_to_str(row.get(4)),
                num_messages_read: row.get(5).and_then(cell_to_u64).unwrap_or(0),
                num_commits: row.get(6).and_then(cell_to_u64).unwrap_or(0),
                num_rebalance_revocations: row.get(7).and_then(cell_to_u64).unwrap_or(0),
                last_exception: cell_to_str(row.get(8)),
                last_used: cell_to_str(row.get(9)),
            });
        }
        Ok(KafkaConsumersResult::Enabled { rows })
    }

    pub async fn kafka_pulse(&self) -> AppResult<KafkaPulse> {
        let kafka_tables = self
            .count_or_zero(
                "SELECT count() FROM system.tables WHERE engine LIKE 'Kafka%'",
                "chgui-kafka-pulse-tables",
            )
            .await;
        if kafka_tables == 0 {
            return Ok(KafkaPulse {
                kafka_tables: 0,
                kafka_stuck: 0,
            });
        }

        // The 24-hour window must match the `86_400` check in `aggregate_kafka_consumers`,
        // or a table marked stuck in the list would not count toward the badge.
        // A table with no consumer rows joins to NULL under `join_use_nulls=1` and to
        // the epoch otherwise. Both conditions count it as stuck.
        let kafka_stuck = match self
            .run_fanout_query("chgui-kafka-pulse-stuck", || {
                let consumers_tbl = self.cluster_table_expr("system.kafka_consumers");
                format!(
                    "WITH kafka_tables AS ( \
                        SELECT database, name AS table \
                        FROM system.tables \
                        WHERE engine LIKE 'Kafka%' \
                    ), \
                    consumer_stats AS ( \
                        SELECT \
                            database, \
                            table, \
                            max(last_poll_time) AS max_poll, \
                            max(arrayMax(arrayConcat([toDateTime(0)], exceptions.time))) AS max_exc_time \
                        FROM {consumers_tbl} \
                        GROUP BY database, table \
                    ) \
                    SELECT count() \
                    FROM kafka_tables t \
                    LEFT JOIN consumer_stats c ON c.database = t.database AND c.table = t.table \
                    WHERE c.max_exc_time > now() - INTERVAL 24 HOUR \
                       OR c.max_poll IS NULL \
                       OR c.max_poll < now() - INTERVAL 5 MINUTE \
                       OR c.max_poll = toDateTime('1970-01-01')"
                )
            })
            .await
        {
            Ok(r) => first_u64(&r),
            Err(_) => 0,
        };

        Ok(KafkaPulse {
            kafka_tables,
            kafka_stuck,
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct KafkaConsumerRowIn {
    pub database: String,
    pub table: String,
    pub consumer_id: String,
    pub last_poll_time_s: String,
    pub last_poll_age_s: Option<i64>,
    pub messages_read: u64,
    pub num_rebalances: u64,
    pub exception_text: String,
    pub exception_age_s: Option<i64>,
}

#[derive(Debug, Default, Clone)]
pub(crate) struct KafkaConsumerAgg {
    pub consumer_ids: std::collections::HashSet<String>,
    pub freshest_age: Option<i64>,
    pub freshest_poll_time: String,
    pub messages_read: u64,
    pub num_rebalances: u64,
    pub last_exception: String,
    pub last_exception_age: Option<i64>,
}

fn parse_kafka_consumer_row(row: &[CellValue]) -> Option<KafkaConsumerRowIn> {
    let database = cell_to_str(row.first());
    let table = cell_to_str(row.get(1));
    if database.is_empty() || table.is_empty() {
        return None;
    }
    Some(KafkaConsumerRowIn {
        database,
        table,
        consumer_id: cell_to_str(row.get(2)),
        last_poll_time_s: cell_to_str(row.get(3)),
        last_poll_age_s: match row.get(4) {
            Some(CellValue::Int(n)) => Some(*n),
            _ => None,
        },
        messages_read: row.get(5).and_then(cell_to_u64).unwrap_or(0),
        num_rebalances: row.get(6).and_then(cell_to_u64).unwrap_or(0),
        exception_text: cell_to_str(row.get(7)),
        exception_age_s: match row.get(8) {
            Some(CellValue::Int(n)) if *n >= 0 => Some(*n),
            _ => None,
        },
    })
}

/// The server emits empty ids for never-assigned consumers, which stay out of
/// the count. Negative poll ages come from clock skew and count as freshest.
pub(crate) fn aggregate_kafka_consumers(
    rows: Vec<KafkaConsumerRowIn>,
) -> std::collections::HashMap<(String, String), KafkaConsumerAgg> {
    use std::collections::HashMap;
    let mut map: HashMap<(String, String), KafkaConsumerAgg> = HashMap::new();
    for r in rows {
        let agg = map.entry((r.database, r.table)).or_default();
        if !r.consumer_id.is_empty() {
            agg.consumer_ids.insert(r.consumer_id);
        }
        if let Some(age) = r.last_poll_age_s {
            let take = match agg.freshest_age {
                Some(cur) => age < cur,
                None => true,
            };
            if take {
                agg.freshest_age = Some(age);
                agg.freshest_poll_time = r.last_poll_time_s;
            }
        }
        agg.messages_read = agg.messages_read.saturating_add(r.messages_read);
        agg.num_rebalances = agg.num_rebalances.saturating_add(r.num_rebalances);
        if !r.exception_text.is_empty() && r.exception_age_s.is_some_and(|age| age <= 86_400) {
            let take = match agg.last_exception_age {
                Some(cur) => r.exception_age_s.is_some_and(|a| a < cur),
                None => true,
            };
            if take {
                agg.last_exception = r.exception_text;
                agg.last_exception_age = r.exception_age_s;
            }
        }
    }
    map
}

fn dedup_sorted_ids(ids: &mut Vec<String>) -> &[String] {
    ids.sort();
    ids.dedup();
    ids.as_slice()
}

fn merge_initial_queries(rows: &mut [MvFailure], pairs: &[(String, String)]) {
    use std::collections::HashMap;
    let mut map: HashMap<&str, &str> = HashMap::new();
    for (qid, qtext) in pairs {
        if !qid.is_empty() && !qtext.is_empty() {
            map.entry(qid.as_str()).or_insert(qtext.as_str());
        }
    }
    for f in rows.iter_mut() {
        if let Some(qtext) = map.get(f.initial_query_id.as_str()) {
            f.initial_query = (*qtext).to_string();
        }
    }
}

/// The inputs are `u64` and `bool`, so nothing here needs SQL escaping.
fn build_history_filter_fragment(filters: &ServerHistoryFilters) -> String {
    let mut parts = Vec::new();
    if let Some(ms) = filters.min_duration_ms {
        parts.push(format!("query_duration_ms >= {ms}"));
    }
    if let Some(bytes) = filters.min_memory_bytes {
        parts.push(format!("memory_usage >= {bytes}"));
    }
    if filters.exception_only {
        parts.push("exception != ''".to_string());
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" AND {}", parts.join(" AND "))
    }
}

/// ClickHouse honors backslash escapes inside backtick-quoted identifiers. If only
/// backticks were escaped, a trailing backslash would escape the closing quote.
/// `quoteIdent` in src/lib/sqlIdent.ts must stay in sync.
fn quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('\\', "\\\\").replace('`', "\\`"))
}

/// ClickHouse honors backslash escapes in strings, so a name with a backslash could end the literal.
pub(crate) fn sql_string_literal(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// The `[^ (]+` regex in `fetch_dependency_graph` cuts a `TO` target at its first
/// space, so quoted names containing spaces arrive truncated.
fn split_qualified(raw: &str, fallback_db: &str) -> Option<(String, String)> {
    let cleaned = raw.trim().trim_matches('`').replace("`.`", ".");
    let cleaned = cleaned.trim_matches('`');
    if cleaned.is_empty() {
        return None;
    }
    match cleaned.split_once('.') {
        Some((d, t)) if !d.is_empty() && !t.is_empty() => Some((d.to_string(), t.to_string())),
        Some(_) => None,
        None => Some((fallback_db.to_string(), cleaned.to_string())),
    }
}

/// Views with implicit storage are written `TO INNER UUID '...'`, and the regex
/// captures `INNER`, which is not a named table.
fn parse_mv_target(raw: &str, fallback_db: &str) -> Option<(String, String)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("INNER") {
        return None;
    }
    split_qualified(trimmed, fallback_db)
}

fn cell_to_str(cell: Option<&CellValue>) -> String {
    match cell {
        Some(CellValue::Str(s) | CellValue::DateTime(s) | CellValue::Other(s)) => s.clone(),
        Some(CellValue::Int(n)) => n.to_string(),
        Some(CellValue::Float(n)) => n.to_string(),
        Some(CellValue::BigInt(s) | CellValue::Decimal(s)) => s.clone(),
        _ => String::new(),
    }
}

fn cell_to_f64(cell: &CellValue) -> Option<f64> {
    match cell {
        CellValue::Null => None,
        CellValue::Int(n) => Some(*n as f64),
        CellValue::Float(n) => {
            if n.is_finite() {
                Some(*n)
            } else {
                None
            }
        }
        CellValue::BigInt(s) | CellValue::Decimal(s) => s.parse().ok(),
        _ => None,
    }
}

fn strip_type_wrappers(type_str: &str) -> &str {
    let mut s = type_str.trim();
    loop {
        let lower = s.to_ascii_lowercase();
        let prefix_len = if lower.starts_with("nullable(") {
            9
        } else if lower.starts_with("lowcardinality(") {
            15
        } else {
            break;
        };
        if let Some(inner) = s[prefix_len..].strip_suffix(')') {
            s = inner.trim();
        } else {
            break;
        }
    }
    s
}

fn is_numeric_type(inner: &str) -> bool {
    let lower = inner.to_ascii_lowercase();
    let base = lower.split('(').next().unwrap_or(&lower);
    matches!(
        base,
        "int8"
            | "int16"
            | "int32"
            | "int64"
            | "int128"
            | "int256"
            | "uint8"
            | "uint16"
            | "uint32"
            | "uint64"
            | "uint128"
            | "uint256"
            | "float32"
            | "float64"
            | "decimal"
            | "decimal32"
            | "decimal64"
            | "decimal128"
            | "decimal256"
    )
}

fn is_time_type(inner: &str) -> bool {
    let lower = inner.to_ascii_lowercase();
    let base = lower.split('(').next().unwrap_or(&lower);
    matches!(base, "date" | "date32" | "datetime" | "datetime64")
}

/// Enums route here, not to `is_numeric_type`, because `CAST` to String returns
/// the label names. A histogram of the integer codes would mean nothing.
fn is_string_type(inner: &str) -> bool {
    let lower = inner.to_ascii_lowercase();
    let base = lower.split('(').next().unwrap_or(&lower);
    matches!(base, "string" | "fixedstring" | "enum8" | "enum16")
}

/// A caller future dropped mid-query (webview reload, a `timeout` wrapper) would
/// otherwise leave a subscriber forwarding the next query's packets.
struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

fn first_u64(res: &QueryResult) -> u64 {
    res.rows
        .first()
        .and_then(|r| r.first())
        .and_then(cell_to_u64)
        .unwrap_or(0)
}

fn cell_to_u64(cell: &CellValue) -> Option<u64> {
    match cell {
        CellValue::Null => None,
        CellValue::Int(n) => {
            if *n >= 0 {
                Some(*n as u64)
            } else {
                None
            }
        }
        CellValue::Float(n) => {
            if n.is_finite() && *n >= 0.0 {
                Some(*n as u64)
            } else {
                None
            }
        }
        CellValue::BigInt(s) | CellValue::Decimal(s) => s.parse().ok(),
        _ => None,
    }
}

fn cell_to_string_list(cell: &CellValue) -> Vec<String> {
    match cell {
        CellValue::Str(s) | CellValue::Other(s) => {
            if s.is_empty() {
                Vec::new()
            } else {
                s.split("||").map(|x| x.to_string()).collect()
            }
        }
        _ => Vec::new(),
    }
}

fn row_to_profile(row: &[CellValue]) -> ProfileSnapshot {
    ProfileSnapshot {
        query_duration_ms: row.first().and_then(cell_to_u64),
        read_rows: row.get(1).and_then(cell_to_u64),
        read_bytes: row.get(2).and_then(cell_to_u64),
        written_rows: row.get(3).and_then(cell_to_u64),
        written_bytes: row.get(4).and_then(cell_to_u64),
        result_rows: row.get(5).and_then(cell_to_u64),
        result_bytes: row.get(6).and_then(cell_to_u64),
        memory_usage: row.get(7).and_then(cell_to_u64),
        thread_count: row.get(8).and_then(cell_to_u64),
        used_aggregate_functions: row.get(9).map(cell_to_string_list).unwrap_or_default(),
        used_dictionaries: row.get(10).map(cell_to_string_list).unwrap_or_default(),
        selected_parts: row.get(11).and_then(cell_to_u64),
        selected_ranges: row.get(12).and_then(cell_to_u64),
        selected_marks: row.get(13).and_then(cell_to_u64),
        selected_rows: row.get(14).and_then(cell_to_u64),
        compressed_read_blocks: row.get(15).and_then(cell_to_u64),
        compressed_read_bytes: row.get(16).and_then(cell_to_u64),
        uncompressed_cache_hits: row.get(17).and_then(cell_to_u64),
        mark_cache_hits: row.get(18).and_then(cell_to_u64),
        network_send_us: row.get(19).and_then(cell_to_u64),
    }
}

/// `KILL QUERY` is global, so a grant on one database does not count. Role grants
/// have no `ON` and do not count, because `FINAL` has already expanded them.
fn grants_allow_kill<'a>(lines: impl IntoIterator<Item = &'a str>) -> bool {
    fn is_kill(p: &str) -> bool {
        p == "KILL QUERY" || p == "ALL" || p == "ALL PRIVILEGES"
    }
    fn privileges(line: &str, verb: &str) -> Option<Vec<String>> {
        let rest = line.trim().strip_prefix(verb)?;
        let (list, target) = rest.split_once(" ON ")?;
        if target.split_whitespace().next() != Some("*.*") {
            return Some(Vec::new());
        }
        Some(
            list.split(',')
                .map(|p| p.trim().to_ascii_uppercase())
                .collect(),
        )
    }
    let mut granted = false;
    for line in lines {
        if let Some(p) = privileges(line, "GRANT ") {
            granted |= p.iter().map(String::as_str).any(is_kill);
        } else if let Some(p) = privileges(line, "REVOKE ") {
            if p.iter().map(String::as_str).any(is_kill) {
                return false;
            }
        }
    }
    granted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_allow_kill_reads_show_grants() {
        assert!(grants_allow_kill([
            "GRANT CHECK, SHOW, SELECT, KILL QUERY, SOURCES ON *.* TO default WITH GRANT OPTION",
        ]));
        assert!(grants_allow_kill(["GRANT ALL ON *.* TO admin"]));
        assert!(grants_allow_kill([
            "GRANT SELECT, KILL QUERY ON *.* TO rk",
            "GRANT killer TO rk",
        ]));
        assert!(!grants_allow_kill(["GRANT SELECT ON *.* TO analyst"]));
        assert!(!grants_allow_kill(["GRANT ALL ON sales.* TO owner"]));
        assert!(!grants_allow_kill(["GRANT killer TO analyst"]));
        assert!(!grants_allow_kill([
            "GRANT ALL ON *.* TO a",
            "REVOKE KILL QUERY ON *.* FROM a",
        ]));
        assert!(!grants_allow_kill([
            "GRANT ALL ON *.* TO a",
            "REVOKE ALL ON *.* FROM a",
        ]));
        assert!(!grants_allow_kill(std::iter::empty()));
    }

    fn cfg() -> ConnectionConfig {
        ConnectionConfig {
            id: "c1".into(),
            host: "h".into(),
            port: 9440,
            user: "u".into(),
            password: "p".into(),
            secure: true,
            default_database: None,
            custom_ca_pem: None,
            cluster_name: None,
            cluster_fanout: true,
        }
    }

    #[test]
    fn fingerprint_tracks_connection_fields_not_id_or_fanout() {
        let base = cfg().fingerprint();
        let mut c = cfg();
        c.id = "other".into();
        assert_eq!(c.fingerprint(), base, "id must not affect the pool key");
        let mut c = cfg();
        c.cluster_fanout = false;
        assert_eq!(c.fingerprint(), base, "fan-out flips must not reconnect");
        type Mutate = Box<dyn Fn(&mut ConnectionConfig)>;
        let mutations: Vec<(&str, Mutate)> = vec![
            ("host", Box::new(|c| c.host = "x".into())),
            ("port", Box::new(|c| c.port = 1)),
            ("user", Box::new(|c| c.user = "x".into())),
            ("password", Box::new(|c| c.password = "x".into())),
            ("secure", Box::new(|c| c.secure = false)),
            (
                "default_database",
                Box::new(|c| c.default_database = Some("d".into())),
            ),
            (
                "custom_ca_pem",
                Box::new(|c| c.custom_ca_pem = Some("pem".into())),
            ),
            (
                "cluster_name",
                Box::new(|c| c.cluster_name = Some("cl".into())),
            ),
        ];
        for (name, mutate) in mutations {
            let mut c = cfg();
            mutate(&mut c);
            assert_ne!(c.fingerprint(), base, "{name} must change the fingerprint");
        }
    }
    use std::sync::atomic::AtomicUsize;

    const REMOTE_DENIED_MSG: &str =
        "server exception: 497 ACCESS_DENIED: Not enough privileges. READ ON REMOTE";

    async fn run_fallback(
        initial_fanout: bool,
        first_error: Option<(i32, &str)>,
    ) -> (AppResult<u32>, usize, bool, bool) {
        let fanout = AtomicBool::new(initial_fanout);
        let disabled = AtomicBool::new(false);
        let calls = AtomicUsize::new(0);
        let res = fanout_fallback(&fanout, &disabled, || async {
            let n = calls.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                match first_error {
                    Some((code, message)) => Err(AppError::ClickHouseServer {
                        code,
                        message: message.into(),
                    }),
                    None => Ok(42u32),
                }
            } else {
                Ok(42u32)
            }
        })
        .await;
        (
            res,
            calls.load(Ordering::SeqCst),
            fanout.load(Ordering::Relaxed),
            disabled.load(Ordering::Relaxed),
        )
    }

    #[tokio::test]
    async fn fanout_fallback_retries_locally_on_remote_denied() {
        let (res, calls, fanout_on, disabled) =
            run_fallback(true, Some((497, REMOTE_DENIED_MSG))).await;
        assert_eq!(res.unwrap(), 42);
        assert_eq!(calls, 2, "should retry exactly once");
        assert!(!fanout_on, "fan-out must be flipped off");
        assert!(disabled, "session flag must be set");
    }

    #[tokio::test]
    async fn fanout_fallback_passes_through_success() {
        let (res, calls, fanout_on, disabled) = run_fallback(true, None).await;
        assert_eq!(res.unwrap(), 42);
        assert_eq!(calls, 1, "no retry when the first call succeeds");
        assert!(fanout_on, "fan-out untouched on success");
        assert!(!disabled);
    }

    #[tokio::test]
    async fn fanout_fallback_no_retry_when_already_local() {
        let (res, calls, _fanout_on, disabled) =
            run_fallback(false, Some((497, REMOTE_DENIED_MSG))).await;
        assert!(res.is_err());
        assert_eq!(calls, 1, "must not retry when fan-out was already off");
        assert!(!disabled);
    }

    #[tokio::test]
    async fn fanout_fallback_propagates_non_497() {
        let (res, calls, fanout_on, disabled) =
            run_fallback(true, Some((241, "MEMORY_LIMIT_EXCEEDED"))).await;
        assert_eq!(res.unwrap_err().clickhouse_code(), Some(241));
        assert_eq!(calls, 1, "a non-497 error must not trigger a retry");
        assert!(fanout_on, "fan-out untouched on a non-497 error");
        assert!(!disabled);
    }

    #[tokio::test]
    async fn fanout_fallback_ignores_unrelated_497() {
        let (res, calls, fanout_on, disabled) = run_fallback(
            true,
            Some((
                497,
                "server exception: 497 ACCESS_DENIED: not enough privileges on system.mutations",
            )),
        )
        .await;
        assert!(res.is_err());
        assert_eq!(calls, 1, "an unrelated 497 must not trigger a retry");
        assert!(fanout_on, "fan-out must stay on for a non-REMOTE 497");
        assert!(!disabled);
    }

    #[test]
    fn quote_ident_escapes_backslashes_and_backticks() {
        assert_eq!(quote_ident("events"), "`events`");
        assert_eq!(quote_ident("we`ird"), "`we\\`ird`");
        assert_eq!(quote_ident("trail\\"), "`trail\\\\`");
        assert_eq!(quote_ident("a\\`b"), "`a\\\\\\`b`");
    }

    #[test]
    fn sql_string_literal_escapes_backslashes_and_quotes() {
        assert_eq!(sql_string_literal("events"), "'events'");
        assert_eq!(sql_string_literal("it's"), "'it\\'s'");
        assert_eq!(sql_string_literal("trail\\"), "'trail\\\\'");
        assert_eq!(sql_string_literal("a\\'b"), "'a\\\\\\'b'");
    }

    #[test]
    fn split_qualified_handles_common_shapes() {
        assert_eq!(
            split_qualified("db.tbl", "fb"),
            Some(("db".into(), "tbl".into()))
        );
        assert_eq!(
            split_qualified("`db`.`tbl`", "fb"),
            Some(("db".into(), "tbl".into()))
        );
        assert_eq!(
            split_qualified("bare", "fb"),
            Some(("fb".into(), "bare".into()))
        );
        assert_eq!(
            split_qualified("`bare`", "fb"),
            Some(("fb".into(), "bare".into()))
        );
        assert_eq!(
            split_qualified("  `db`.`tbl`  ", "fb"),
            Some(("db".into(), "tbl".into()))
        );
    }

    #[test]
    fn split_qualified_returns_none_on_garbage() {
        assert_eq!(split_qualified("", "fb"), None);
        assert_eq!(split_qualified("   ", "fb"), None);
        assert_eq!(split_qualified(".", "fb"), None);
        assert_eq!(split_qualified("db.", "fb"), None);
        assert_eq!(split_qualified(".tbl", "fb"), None);
    }

    #[test]
    fn parse_mv_target_filters_inner_storage() {
        assert_eq!(parse_mv_target("INNER", "fb"), None);
        assert_eq!(parse_mv_target("inner", "fb"), None);
        assert_eq!(parse_mv_target("   INNER   ", "fb"), None);
    }

    #[test]
    fn parse_mv_target_passes_normal_targets_through() {
        assert_eq!(
            parse_mv_target("db.target", "fb"),
            Some(("db".into(), "target".into()))
        );
        assert_eq!(
            parse_mv_target("`db`.`target`", "fb"),
            Some(("db".into(), "target".into()))
        );
        assert_eq!(
            parse_mv_target("bare_target", "src_db"),
            Some(("src_db".into(), "bare_target".into()))
        );
    }

    #[test]
    fn history_filter_fragment_empty_for_default() {
        let f = ServerHistoryFilters::default();
        assert_eq!(build_history_filter_fragment(&f), "");
    }

    #[test]
    fn history_filter_fragment_combines_knobs() {
        let f = ServerHistoryFilters {
            min_duration_ms: Some(500),
            min_memory_bytes: Some(1_048_576),
            exception_only: true,
        };
        assert_eq!(
            build_history_filter_fragment(&f),
            " AND query_duration_ms >= 500 AND memory_usage >= 1048576 AND exception != ''"
        );
    }

    #[test]
    fn history_filter_fragment_emits_single_clause() {
        let f = ServerHistoryFilters {
            min_duration_ms: Some(1000),
            ..Default::default()
        };
        assert_eq!(
            build_history_filter_fragment(&f),
            " AND query_duration_ms >= 1000"
        );
    }

    #[test]
    fn history_filter_fragment_exception_only() {
        let f = ServerHistoryFilters {
            exception_only: true,
            ..Default::default()
        };
        assert_eq!(build_history_filter_fragment(&f), " AND exception != ''");
    }

    #[test]
    fn dedup_sorted_ids_collapses_duplicates() {
        let mut ids = vec![
            "c".to_string(),
            "a".to_string(),
            "b".to_string(),
            "a".to_string(),
            "c".to_string(),
        ];
        assert_eq!(dedup_sorted_ids(&mut ids), &["a", "b", "c"]);
    }

    #[test]
    fn dedup_sorted_ids_handles_empty() {
        let mut ids: Vec<String> = Vec::new();
        assert!(dedup_sorted_ids(&mut ids).is_empty());
    }

    fn mv_failure_stub(id: &str) -> MvFailure {
        MvFailure {
            event_time: String::new(),
            view_name: "db.v".into(),
            view_type: String::new(),
            status: String::new(),
            exception: String::new(),
            initial_query_id: id.to_string(),
            initial_query: String::new(),
            recent: false,
        }
    }

    #[test]
    fn merge_initial_queries_fills_matching_rows() {
        let mut rows = vec![mv_failure_stub("q1"), mv_failure_stub("q2")];
        let pairs = vec![
            ("q1".to_string(), "INSERT INTO a".to_string()),
            ("q2".to_string(), "INSERT INTO b".to_string()),
        ];
        merge_initial_queries(&mut rows, &pairs);
        assert_eq!(rows[0].initial_query, "INSERT INTO a");
        assert_eq!(rows[1].initial_query, "INSERT INTO b");
    }

    #[test]
    fn merge_initial_queries_leaves_unmatched_alone() {
        let mut rows = vec![mv_failure_stub("q1"), mv_failure_stub("q_missing")];
        let pairs = vec![("q1".to_string(), "INSERT INTO a".to_string())];
        merge_initial_queries(&mut rows, &pairs);
        assert_eq!(rows[0].initial_query, "INSERT INTO a");
        assert_eq!(rows[1].initial_query, "");
    }

    #[test]
    fn merge_initial_queries_skips_empty_pairs() {
        let mut rows = vec![mv_failure_stub("q1")];
        let pairs = vec![
            ("q1".to_string(), "".to_string()),
            ("".to_string(), "INSERT INTO a".to_string()),
            ("q1".to_string(), "INSERT INTO real".to_string()),
        ];
        merge_initial_queries(&mut rows, &pairs);
        assert_eq!(rows[0].initial_query, "INSERT INTO real");
    }

    #[test]
    fn merge_initial_queries_dedups_on_first_non_empty() {
        let mut rows = vec![mv_failure_stub("q1")];
        let pairs = vec![
            ("q1".to_string(), "first".to_string()),
            ("q1".to_string(), "second".to_string()),
        ];
        merge_initial_queries(&mut rows, &pairs);
        assert_eq!(rows[0].initial_query, "first");
    }

    #[test]
    fn strip_type_wrappers_peels_common_shapes() {
        assert_eq!(strip_type_wrappers("UInt64"), "UInt64");
        assert_eq!(strip_type_wrappers("Nullable(UInt64)"), "UInt64");
        assert_eq!(strip_type_wrappers("LowCardinality(String)"), "String");
        assert_eq!(
            strip_type_wrappers("LowCardinality(Nullable(String))"),
            "String"
        );
        assert_eq!(
            strip_type_wrappers("Nullable(LowCardinality(String))"),
            "String"
        );
        assert_eq!(strip_type_wrappers("Nullable(UInt64"), "Nullable(UInt64");
        assert_eq!(
            strip_type_wrappers("nullable(DateTime64(3))"),
            "DateTime64(3)"
        );
        assert_eq!(strip_type_wrappers("DateTime64(3)"), "DateTime64(3)");
    }

    #[test]
    fn type_routing_classifies_correctly() {
        for t in &[
            "Int8",
            "Int16",
            "Int32",
            "Int64",
            "Int128",
            "Int256",
            "UInt8",
            "UInt16",
            "UInt32",
            "UInt64",
            "UInt128",
            "UInt256",
            "Float32",
            "Float64",
            "Decimal(18, 4)",
            "Decimal32(4)",
            "Decimal64(9)",
            "Decimal128(38)",
            "Decimal256(76)",
        ] {
            assert!(is_numeric_type(t), "{t} should be numeric");
            assert!(!is_time_type(t), "{t} should not be time");
            assert!(!is_string_type(t), "{t} should not be string");
        }

        for t in &[
            "Date",
            "Date32",
            "DateTime",
            "DateTime('UTC')",
            "DateTime64(3)",
        ] {
            assert!(is_time_type(t), "{t} should be time");
            assert!(!is_numeric_type(t), "{t} should not be numeric");
        }

        for t in &[
            "String",
            "FixedString(16)",
            "Enum8('a' = 1)",
            "Enum16('b' = 2)",
        ] {
            assert!(is_string_type(t), "{t} should be string");
            assert!(!is_numeric_type(t), "{t} should not be numeric");
            assert!(!is_time_type(t), "{t} should not be time");
        }

        for t in &[
            "UUID",
            "IPv4",
            "IPv6",
            "Array(UInt64)",
            "Map(String, UInt64)",
            "Tuple(UInt64, String)",
            "Nested(id UInt64)",
        ] {
            assert!(!is_numeric_type(t), "{t} should not be numeric");
            assert!(!is_time_type(t), "{t} should not be time");
            assert!(!is_string_type(t), "{t} should not be string");
        }
    }

    #[test]
    fn type_routing_handles_stripped_wrappers() {
        assert!(is_numeric_type(strip_type_wrappers("Nullable(UInt64)")));
        assert!(is_string_type(strip_type_wrappers(
            "LowCardinality(String)"
        )));
        assert!(is_time_type(strip_type_wrappers(
            "Nullable(LowCardinality(DateTime))"
        )));
    }

    fn mk_consumer_row(
        db: &str,
        table: &str,
        consumer_id: &str,
        last_poll_age_s: Option<i64>,
        messages: u64,
        exception_text: &str,
        exception_age_s: Option<i64>,
    ) -> KafkaConsumerRowIn {
        KafkaConsumerRowIn {
            database: db.into(),
            table: table.into(),
            consumer_id: consumer_id.into(),
            last_poll_time_s: if last_poll_age_s.is_some() {
                "2026-01-01 00:00:00".into()
            } else {
                String::new()
            },
            last_poll_age_s,
            messages_read: messages,
            num_rebalances: 0,
            exception_text: exception_text.into(),
            exception_age_s,
        }
    }

    #[test]
    fn aggregate_kafka_consumers_dedups_by_id_and_sums_counters() {
        let rows = vec![
            mk_consumer_row("db", "k", "c1", Some(10), 100, "", None),
            mk_consumer_row("db", "k", "c1", Some(12), 200, "", None),
            mk_consumer_row("db", "k", "", Some(30), 50, "", None),
        ];
        let map = aggregate_kafka_consumers(rows);
        let agg = map.get(&("db".into(), "k".into())).expect("agg present");
        assert_eq!(agg.consumer_ids.len(), 1, "empty id must not count");
        assert_eq!(agg.messages_read, 350, "summed across replicas");
    }

    #[test]
    fn aggregate_kafka_consumers_picks_freshest_poll_across_replicas() {
        let rows = vec![
            KafkaConsumerRowIn {
                last_poll_time_s: "replica-old".into(),
                ..mk_consumer_row("db", "k", "c", Some(60), 0, "", None)
            },
            KafkaConsumerRowIn {
                last_poll_time_s: "replica-fresh".into(),
                ..mk_consumer_row("db", "k", "c", Some(5), 0, "", None)
            },
            KafkaConsumerRowIn {
                last_poll_time_s: "replica-oldest".into(),
                ..mk_consumer_row("db", "k", "c", Some(120), 0, "", None)
            },
        ];
        let agg = aggregate_kafka_consumers(rows)
            .remove(&("db".into(), "k".into()))
            .unwrap();
        assert_eq!(agg.freshest_age, Some(5));
        assert_eq!(agg.freshest_poll_time, "replica-fresh");
    }

    #[test]
    fn aggregate_kafka_consumers_treats_negative_age_as_fresher() {
        let rows = vec![
            mk_consumer_row("db", "k", "c", Some(5), 0, "", None),
            mk_consumer_row("db", "k", "c", Some(-2), 0, "", None),
        ];
        let agg = aggregate_kafka_consumers(rows)
            .remove(&("db".into(), "k".into()))
            .unwrap();
        assert_eq!(agg.freshest_age, Some(-2));
    }

    #[test]
    fn aggregate_kafka_consumers_drops_stale_exceptions() {
        let rows = vec![mk_consumer_row(
            "db",
            "k",
            "c",
            Some(10),
            0,
            "stale parse error",
            Some(86_401),
        )];
        let agg = aggregate_kafka_consumers(rows)
            .remove(&("db".into(), "k".into()))
            .unwrap();
        assert_eq!(agg.last_exception, "", "2-day-old exception must drop");

        let rows = vec![mk_consumer_row(
            "db",
            "k",
            "c",
            Some(10),
            0,
            "recent parse error",
            Some(3600),
        )];
        let agg = aggregate_kafka_consumers(rows)
            .remove(&("db".into(), "k".into()))
            .unwrap();
        assert_eq!(agg.last_exception, "recent parse error");
    }

    #[test]
    fn aggregate_kafka_consumers_picks_freshest_exception() {
        let rows = vec![
            mk_consumer_row("db", "k", "c1", Some(5), 0, "older", Some(600)),
            mk_consumer_row("db", "k", "c2", Some(5), 0, "newer", Some(30)),
        ];
        let agg = aggregate_kafka_consumers(rows)
            .remove(&("db".into(), "k".into()))
            .unwrap();
        assert_eq!(agg.last_exception, "newer");
        assert_eq!(agg.last_exception_age, Some(30));
    }
}
