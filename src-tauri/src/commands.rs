use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::clickhouse::client::{sql_string_literal, LogEvent, ProgressSnapshot};
use crate::clickhouse::{Client, ConnectionConfig};
use crate::error::{AppError, AppResult};
use crate::keychain;
use crate::pool::Pool;
use crate::state::AppState;

#[derive(Serialize, Clone)]
struct LogEventPayload {
    #[serde(rename = "queryId")]
    query_id: String,
    entries: Vec<LogEntryPayload>,
}

#[derive(Serialize, Clone)]
struct LogsUnavailablePayload {
    #[serde(rename = "queryId")]
    query_id: String,
}

#[derive(Serialize, Clone)]
struct LogEntryPayload {
    event_time: Option<String>,
    host_name: String,
    query_id: String,
    thread_id: u64,
    /// ClickHouse logs the Poco priority: 1=Fatal, 3=Error, 4=Warning, 6=Information, 7=Debug, 8=Trace.
    priority: i8,
    source: String,
    text: String,
}

#[derive(Serialize, Clone)]
struct ProgressEventPayload {
    #[serde(rename = "queryId")]
    query_id: String,
    read_rows: u64,
    read_bytes: u64,
    total_rows_to_read: u64,
    written_rows: u64,
    written_bytes: u64,
}

impl ProgressEventPayload {
    fn from_snapshot(query_id: String, s: ProgressSnapshot) -> Self {
        Self {
            query_id,
            read_rows: s.read_rows,
            read_bytes: s.read_bytes,
            total_rows_to_read: s.total_rows_to_read,
            written_rows: s.written_rows,
            written_bytes: s.written_bytes,
        }
    }
}

impl From<klickhouse::LogEntry> for LogEntryPayload {
    fn from(e: klickhouse::LogEntry) -> Self {
        Self {
            event_time: e.event_time.map(|t| t.to_rfc3339()),
            host_name: e.host_name,
            query_id: e.query_id,
            thread_id: e.thread_id,
            priority: e.priority,
            source: e.source,
            text: e.text,
        }
    }
}

#[derive(Serialize)]
pub struct DbInfo {
    pub name: String,
}

#[derive(Serialize)]
pub struct TableInfo {
    pub name: String,
    pub engine: String,
}

#[derive(Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub r#type: String,
}

async fn get_or_connect_in(
    pool: &Pool<Client>,
    cfg: ConnectionConfig,
    lane: &'static str,
) -> AppResult<Arc<Client>> {
    let id = cfg.id.clone();
    let fingerprint = cfg.fingerprint();
    let fanout = cfg.cluster_fanout;
    let client = pool
        .get_or_insert(
            &id,
            |c| !c.is_closed() && c.config_fingerprint() == fingerprint,
            || async move { Client::connect_in_lane(cfg, Some(lane)).await },
        )
        .await?;
    client.sync_cluster_fanout(fanout);
    Ok(client)
}

async fn get_or_connect(state: &AppState, cfg: ConnectionConfig) -> AppResult<Arc<Client>> {
    get_or_connect_in(&state.pools, cfg, "editor").await
}

async fn get_or_connect_monitor(state: &AppState, cfg: ConnectionConfig) -> AppResult<Arc<Client>> {
    get_or_connect_in(&state.monitor_pools, cfg, "monitor").await
}

fn emit_fanout_disabled(app: &AppHandle, client: &Client) {
    if client.take_fanout_disabled_notice() {
        let _ = app.emit(
            "cluster-fanout-disabled",
            client.connection_id().to_string(),
        );
    }
}

#[tauri::command]
pub async fn test_connection(cfg: ConnectionConfig) -> AppResult<()> {
    let client = Client::connect(cfg).await?;
    client.ping().await
}

#[tauri::command]
pub async fn run_query(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    sql: String,
    query_id: String,
    log_level: Option<String>,
) -> AppResult<crate::clickhouse::client::QueryResult> {
    // The id goes into a `-- chgui:{query_id}` comment line. A newline in it would end the comment
    // and leave the query uncancelable.
    Uuid::parse_str(&query_id).map_err(|e| AppError::Invalid(e.to_string()))?;
    let client = get_or_connect(&state, cfg)
        .await
        .map_err(AppError::connect)?;

    let level = log_level
        .as_deref()
        .filter(|l| !l.eq_ignore_ascii_case("none"));

    let progress_app = app.clone();
    let progress_qid = query_id.clone();
    let on_progress: crate::clickhouse::client::ProgressCallback = Box::new(move |snapshot| {
        let payload = ProgressEventPayload::from_snapshot(progress_qid.clone(), snapshot);
        let _ = progress_app.emit("query-progress", payload);
    });

    match level {
        Some(level) => {
            let qid = query_id.clone();
            let on_log: crate::clickhouse::client::LogCallback = Box::new(move |event| {
                let _ = match event {
                    LogEvent::Lines(entries) => app.emit(
                        "query-log",
                        LogEventPayload {
                            query_id: qid.clone(),
                            entries: entries.into_iter().map(LogEntryPayload::from).collect(),
                        },
                    ),
                    LogEvent::Unavailable => app.emit(
                        "query-logs-unavailable",
                        LogsUnavailablePayload {
                            query_id: qid.clone(),
                        },
                    ),
                };
            });
            client
                .run_query_with_logs(&sql, &query_id, level, on_log, Some(on_progress))
                .await
        }
        None => client.run_query(&sql, &query_id, Some(on_progress)).await,
    }
}

#[tauri::command]
pub async fn fetch_query_profile(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    query_id: String,
) -> AppResult<Option<crate::clickhouse::client::ProfileSnapshot>> {
    Uuid::parse_str(&query_id).map_err(|e| AppError::Invalid(e.to_string()))?;
    let client = get_or_connect(&state, cfg).await?;
    client.fetch_query_profile(&query_id).await
}

/// A fresh connection lets the drawer open while a long query holds the pooled client.
#[tauri::command]
pub async fn fetch_table_details(
    cfg: ConnectionConfig,
    database: String,
    table: String,
) -> AppResult<crate::clickhouse::client::TableDetails> {
    let client = Client::connect(cfg).await?;
    client.fetch_table_details(&database, &table).await
}

#[tauri::command]
pub async fn fetch_dependency_graph(
    cfg: ConnectionConfig,
    database: String,
    table: String,
    max_depth: u32,
    max_nodes: u32,
) -> AppResult<crate::clickhouse::client::DependencyGraph> {
    let client = Client::connect(cfg).await?;
    client
        .fetch_dependency_graph(&database, &table, max_depth, max_nodes)
        .await
}

#[tauri::command]
pub async fn fetch_column_stats(
    cfg: ConnectionConfig,
    database: String,
    table: String,
    column: String,
    query_id: String,
) -> AppResult<crate::clickhouse::client::ColumnStats> {
    Uuid::parse_str(&query_id).map_err(|e| AppError::Invalid(e.to_string()))?;
    let client = Client::connect(cfg).await?;
    client
        .fetch_column_stats(&database, &table, &column, &query_id)
        .await
}

#[tauri::command]
pub async fn fetch_column_distribution(
    cfg: ConnectionConfig,
    database: String,
    table: String,
    column: String,
    query_id: String,
) -> AppResult<crate::clickhouse::client::ColumnDistribution> {
    Uuid::parse_str(&query_id).map_err(|e| AppError::Invalid(e.to_string()))?;
    let client = Client::connect(cfg).await?;
    client
        .fetch_column_distribution(&database, &table, &column, &query_id)
        .await
}

#[tauri::command]
pub async fn fetch_parts_summary(
    cfg: ConnectionConfig,
    database: String,
    table: String,
) -> AppResult<crate::clickhouse::client::PartsSummaryResult> {
    let client = Client::connect(cfg).await?;
    client.fetch_parts_summary(&database, &table).await
}

#[tauri::command]
pub async fn fetch_active_merges(
    cfg: ConnectionConfig,
    database: String,
    table: String,
) -> AppResult<Vec<crate::clickhouse::client::ActiveMerge>> {
    let client = Client::connect(cfg).await?;
    client.fetch_active_merges(&database, &table).await
}

#[tauri::command]
pub async fn list_server_history(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    limit: u32,
    filters: crate::clickhouse::client::ServerHistoryFilters,
) -> AppResult<Vec<crate::clickhouse::client::ServerHistoryEntry>> {
    let client = get_or_connect(&state, cfg).await?;
    client.list_server_history(limit, &filters).await
}

#[tauri::command]
pub async fn list_server_history_grouped(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    limit: u32,
    filters: crate::clickhouse::client::ServerHistoryFilters,
) -> AppResult<Vec<crate::clickhouse::client::ServerHistoryGroup>> {
    let client = get_or_connect(&state, cfg).await?;
    client.list_server_history_grouped(limit, &filters).await
}

/// This needs the monitor connection. A query on the editor connection would wait for the user's
/// query to finish, and that query would be gone from `system.processes`.
#[tauri::command]
pub async fn list_running_queries(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<Vec<crate::clickhouse::client::RunningQuery>> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    client.list_running_queries().await
}

#[tauri::command]
pub async fn can_kill_others(state: State<'_, AppState>, cfg: ConnectionConfig) -> AppResult<bool> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    client.can_kill_others().await
}

#[tauri::command]
pub async fn list_server_errors(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<Vec<crate::clickhouse::client::ServerError>> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    let res = client.list_server_errors().await;
    emit_fanout_disabled(&app, &client);
    res
}

#[tauri::command]
pub async fn list_mv_failures(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    view_name: Option<String>,
) -> AppResult<crate::clickhouse::client::MvFailuresResult> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    let res = client.list_mv_failures(view_name.as_deref()).await;
    emit_fanout_disabled(&app, &client);
    res
}

#[tauri::command]
pub async fn list_functions(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<crate::clickhouse::client::FunctionsResult> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    client.list_functions().await
}

#[derive(Serialize)]
pub struct VersionInfo {
    pub server: String,
    pub app: String,
}

#[tauri::command]
pub async fn version_info(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<VersionInfo> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    Ok(VersionInfo {
        server: client.server_version().await?,
        app: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
pub async fn list_changed_settings(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<Vec<crate::clickhouse::client::ChangedSetting>> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    client.list_changed_settings().await
}

#[tauri::command]
pub async fn error_pulse(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<crate::clickhouse::client::ErrorPulse> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    let res = client.error_pulse().await;
    emit_fanout_disabled(&app, &client);
    res
}

#[tauri::command]
pub async fn list_pending_mutations(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<crate::clickhouse::client::PendingMutationsResult> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    let res = client.list_pending_mutations().await;
    emit_fanout_disabled(&app, &client);
    res
}

#[tauri::command]
pub async fn list_replica_queue(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<crate::clickhouse::client::ReplicaQueueResult> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    let res = client.list_replica_queue().await;
    emit_fanout_disabled(&app, &client);
    res
}

#[tauri::command]
pub async fn list_kafka_tables(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<crate::clickhouse::client::KafkaTablesResult> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    let res = client.list_kafka_tables().await;
    emit_fanout_disabled(&app, &client);
    res
}

#[tauri::command]
pub async fn list_kafka_consumers(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    database: String,
    table: String,
) -> AppResult<crate::clickhouse::client::KafkaConsumersResult> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    let res = client.list_kafka_consumers(&database, &table).await;
    emit_fanout_disabled(&app, &client);
    res
}

#[tauri::command]
pub async fn kafka_pulse(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<crate::clickhouse::client::KafkaPulse> {
    let client = get_or_connect_monitor(&state, cfg).await?;
    let res = client.kafka_pulse().await;
    emit_fanout_disabled(&app, &client);
    res
}

/// Returns the server's `kill_status`, or `None` when no query matched because it had already ended.
#[tauri::command]
pub async fn kill_running_query(
    cfg: ConnectionConfig,
    query_id: String,
) -> AppResult<Option<String>> {
    // A `query_id` in `system.processes` can be any string, so `cancel_query`'s UUID check would
    // reject real ids.
    if query_id.is_empty() {
        return Err(AppError::Invalid("invalid query id".into()));
    }
    let killer = Client::connect(cfg).await?;
    let sql = format!(
        "KILL QUERY WHERE query_id = {} SYNC",
        sql_string_literal(&query_id)
    );
    let res = killer
        .run_query(&sql, &Uuid::new_v4().to_string(), None)
        .await?;
    Ok(res.rows.first().and_then(|r| match r.first() {
        Some(crate::clickhouse::value::CellValue::Str(s)) => Some(s.clone()),
        _ => None,
    }))
}

async fn kill_tagged_query(cfg: ConnectionConfig, query_id: &str) -> AppResult<()> {
    Uuid::parse_str(query_id).map_err(|e| AppError::Invalid(e.to_string()))?;
    // The pooled connection is busy with the query to kill, so the KILL needs its own connection.
    let killer = Client::connect(cfg).await?;
    // `Client::run_query` prefixes the SQL with this tag.
    let sql = format!("KILL QUERY WHERE query LIKE '%chgui:{query_id}%' SYNC");
    killer
        .run_query(&sql, &Uuid::new_v4().to_string(), None)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    query_id: String,
) -> AppResult<()> {
    let connection_id = cfg.id.clone();
    kill_tagged_query(cfg, &query_id).await?;

    // The killed query leaves its pooled connection unusable, so the next call must reconnect.
    state.pools.remove(&connection_id).await;
    Ok(())
}

/// Column stats scans run on their own connection, so the pooled session survives.
#[tauri::command]
pub async fn cancel_scan(cfg: ConnectionConfig, query_id: String) -> AppResult<()> {
    kill_tagged_query(cfg, &query_id).await
}

#[tauri::command]
pub async fn introspect_databases(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
) -> AppResult<Vec<DbInfo>> {
    let client = get_or_connect(&state, cfg).await?;
    let result = client
        .run_query(
            "SELECT name FROM system.databases WHERE name NOT IN ('INFORMATION_SCHEMA','information_schema') ORDER BY name",
            &Uuid::new_v4().to_string(),
            None,
        )
        .await?;
    Ok(result
        .rows
        .into_iter()
        .filter_map(|row| match row.into_iter().next()? {
            crate::clickhouse::value::CellValue::Str(s) => Some(DbInfo { name: s }),
            _ => None,
        })
        .collect())
}

#[tauri::command]
pub async fn introspect_tables(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    database: String,
) -> AppResult<Vec<TableInfo>> {
    let client = get_or_connect(&state, cfg).await?;
    let db = sql_string_literal(&database);
    let sql = format!("SELECT name, engine FROM system.tables WHERE database = {db} ORDER BY name");
    let result = client
        .run_query(&sql, &Uuid::new_v4().to_string(), None)
        .await?;
    Ok(result
        .rows
        .into_iter()
        .filter_map(|row| {
            let mut it = row.into_iter();
            let name = match it.next()? {
                crate::clickhouse::value::CellValue::Str(s) => s,
                _ => return None,
            };
            let engine = match it.next()? {
                crate::clickhouse::value::CellValue::Str(s) => s,
                _ => String::new(),
            };
            Some(TableInfo { name, engine })
        })
        .collect())
}

#[tauri::command]
pub async fn introspect_columns(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
    let client = get_or_connect(&state, cfg).await?;
    let db = sql_string_literal(&database);
    let tb = sql_string_literal(&table);
    let sql = format!(
        "SELECT name, type FROM system.columns WHERE database = {db} AND table = {tb} ORDER BY position"
    );
    let result = client
        .run_query(&sql, &Uuid::new_v4().to_string(), None)
        .await?;
    Ok(result
        .rows
        .into_iter()
        .filter_map(|row| {
            let mut it = row.into_iter();
            let name = match it.next()? {
                crate::clickhouse::value::CellValue::Str(s) => s,
                _ => return None,
            };
            let ty = match it.next()? {
                crate::clickhouse::value::CellValue::Str(s) => s,
                _ => return None,
            };
            Some(ColumnInfo { name, r#type: ty })
        })
        .collect())
}

/// Older servers lack `formatQuery`. The caller falls back to the JS sql-formatter.
#[tauri::command]
pub async fn format_sql(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    sql: String,
) -> AppResult<String> {
    let client = get_or_connect(&state, cfg).await?;
    let formatter_sql = format!("SELECT formatQuery({})", sql_string_literal(&sql));
    let result = client
        .run_query(&formatter_sql, &Uuid::new_v4().to_string(), None)
        .await?;
    let cell = result
        .rows
        .into_iter()
        .next()
        .and_then(|r| r.into_iter().next())
        .ok_or_else(|| AppError::ClickHouse("formatQuery returned no rows".into()))?;
    match cell {
        crate::clickhouse::value::CellValue::Str(s) => Ok(s),
        _ => Err(AppError::ClickHouse(
            "formatQuery returned a non-string value".into(),
        )),
    }
}

#[tauri::command]
pub fn save_password(connection_id: String, password: String) -> AppResult<()> {
    keychain::save(&connection_id, &password)
}

#[tauri::command]
pub fn load_password(connection_id: String) -> AppResult<Option<String>> {
    keychain::load(&connection_id)
}

#[tauri::command]
pub fn delete_password(connection_id: String) -> AppResult<()> {
    keychain::delete(&connection_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn column_stats_commands_reject_an_id_that_is_not_a_uuid() {
        let cfg = ConnectionConfig {
            id: "c".into(),
            host: "127.0.0.1".into(),
            port: 1,
            user: String::new(),
            password: String::new(),
            secure: false,
            default_database: None,
            custom_ca_pem: None,
            cluster_name: None,
            cluster_fanout: false,
        };
        let id = || "x\nSELECT 1".to_string();
        let stats = fetch_column_stats(cfg.clone(), "d".into(), "t".into(), "c".into(), id()).await;
        assert!(matches!(stats, Err(AppError::Invalid(_))));
        let dist = fetch_column_distribution(cfg, "d".into(), "t".into(), "c".into(), id()).await;
        assert!(matches!(dist, Err(AppError::Invalid(_))));
    }
}
