//! The smoke test asserts that each backend function decodes its result, not what the result contains.

use std::time::Duration;

use ch_gui_lib::clickhouse::client::{
    ColumnDistribution, KafkaConsumersResult, KafkaTablesResult, PartsSummaryResult,
    ServerHistoryFilters,
};
use ch_gui_lib::clickhouse::Client;

mod common;
use common::try_connect;

/// Use a unique `db_name` per test. `cargo test` runs tests in parallel, so a shared database
/// would make their DROP and CREATE statements collide.
async fn reset_fixtures(client: &Client, db_name: &str) {
    let _ = client
        .run_query(
            &format!("DROP DATABASE IF EXISTS {db_name}"),
            "test-drop",
            None,
        )
        .await;
    client
        .run_query(
            &format!("CREATE DATABASE {db_name}"),
            "test-create-db",
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("CREATE DATABASE {db_name}: {e}"));
    client
        .run_query(
            &format!(
                "CREATE TABLE {db_name}.t \
                 (x UInt64, created_at DateTime DEFAULT now()) \
                 ENGINE = MergeTree ORDER BY x"
            ),
            "test-create-t",
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("CREATE TABLE {db_name}.t: {e}"));
    client
        .run_query(
            &format!("INSERT INTO {db_name}.t (x) SELECT number FROM numbers(1000)"),
            "test-insert-t",
            None,
        )
        .await
        .expect("seed rows");

    // A server may reject `throwIf` in this DDL. The result is ignored because `list_mv_failures`
    // also decodes an empty log.
    let _ = client
        .run_query(
            &format!(
                "CREATE MATERIALIZED VIEW {db_name}.bad_mv \
                 ENGINE = MergeTree ORDER BY x AS \
                 SELECT throwIf(x > 10, 'boom') AS fail, x FROM {db_name}.t"
            ),
            "test-create-mv",
            None,
        )
        .await;
    let _ = client
        .run_query(
            &format!("INSERT INTO {db_name}.t (x) VALUES (42)"),
            "test-trigger-mv",
            None,
        )
        .await;

    // `system.query_log` does not exist on a fresh server until the first flush.
    let _ = client
        .run_query("SYSTEM FLUSH LOGS", "test-flush-logs", None)
        .await;
}

async fn drop_fixtures(client: &Client, db_name: &str) {
    let _ = client
        .run_query(
            &format!("DROP DATABASE IF EXISTS {db_name}"),
            "test-cleanup",
            None,
        )
        .await;
}

/// A Kafka table with an unresolvable broker gets a `system.kafka_consumers` row without a broker.
/// `exceptions.*` stays empty because ClickHouse writes broker failures only to the server log.
/// `last_poll_time` stays fresh because the consumer keeps retrying, so `is_stuck` stays false.
async fn reset_kafka_fixtures(client: &Client, db_name: &str) {
    let _ = client
        .run_query(
            &format!("DROP DATABASE IF EXISTS {db_name}"),
            "test-kafka-drop",
            None,
        )
        .await;
    client
        .run_query(
            &format!("CREATE DATABASE {db_name}"),
            "test-kafka-create-db",
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("CREATE DATABASE {db_name}: {e}"));

    // RFC 2606 reserves `.invalid`, so DNS always fails and no real broker is reached.
    client
        .run_query(
            &format!(
                "CREATE TABLE {db_name}.k_src (raw String) ENGINE = Kafka \
                 SETTINGS \
                    kafka_broker_list = 'nonexistent-broker.invalid:9092', \
                    kafka_topic_list = 'chgui_test_topic', \
                    kafka_group_name = 'chgui_test_group', \
                    kafka_format = 'LineAsString', \
                    kafka_num_consumers = 1"
            ),
            "test-kafka-create-src",
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("CREATE TABLE {db_name}.k_src: {e}"));

    client
        .run_query(
            &format!(
                "CREATE TABLE {db_name}.k_sink (raw String) \
                 ENGINE = MergeTree ORDER BY tuple()"
            ),
            "test-kafka-create-sink",
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("CREATE TABLE {db_name}.k_sink: {e}"));

    // ClickHouse starts a consumer thread only when a materialized view reads the Kafka table.
    client
        .run_query(
            &format!(
                "CREATE MATERIALIZED VIEW {db_name}.k_mv \
                 TO {db_name}.k_sink AS \
                 SELECT raw FROM {db_name}.k_src"
            ),
            "test-kafka-create-mv",
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("CREATE MV {db_name}.k_mv: {e}"));

    // A shorter wait can leave `system.kafka_consumers` empty because the consumer thread starts slowly.
    tokio::time::sleep(Duration::from_secs(5)).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn smoke_backend_reads_against_real_ch() {
    let Some(client) = try_connect().await else {
        return;
    };
    let db = "chgui_test_smoke";
    reset_fixtures(&client, db).await;

    client.error_pulse().await.expect("error_pulse");
    client
        .list_server_errors()
        .await
        .expect("list_server_errors");
    client
        .list_mv_failures(None)
        .await
        .expect("list_mv_failures");
    let functions = client.list_functions().await.expect("list_functions");
    match functions {
        ch_gui_lib::clickhouse::client::FunctionsResult::Enabled { rows } => {
            assert!(
                !rows.is_empty(),
                "list_functions returned Enabled with zero rows"
            );
            assert!(
                rows.iter().any(|r| r.name == "toYYYYMMDD"),
                "list_functions missing toYYYYMMDD"
            );
        }
        ch_gui_lib::clickhouse::client::FunctionsResult::Disabled => {
            panic!("list_functions Disabled on live CH 24 test container");
        }
    }
    client
        .list_pending_mutations()
        .await
        .expect("list_pending_mutations");
    client
        .list_replica_queue()
        .await
        .expect("list_replica_queue");
    client
        .list_running_queries()
        .await
        .expect("list_running_queries");

    client.list_kafka_tables().await.expect("list_kafka_tables");
    client
        .list_kafka_consumers("nonexistent_db", "nonexistent_table")
        .await
        .expect("list_kafka_consumers");
    client.kafka_pulse().await.expect("kafka_pulse");

    let filters = ServerHistoryFilters::default();
    client
        .list_server_history(100, &filters)
        .await
        .expect("list_server_history");
    client
        .list_server_history_grouped(20, &filters)
        .await
        .expect("list_server_history_grouped");

    let with_filters = ServerHistoryFilters {
        min_duration_ms: Some(1),
        min_memory_bytes: Some(1),
        exception_only: false,
    };
    client
        .list_server_history(100, &with_filters)
        .await
        .expect("list_server_history with filters");
    client
        .list_server_history_grouped(20, &with_filters)
        .await
        .expect("list_server_history_grouped with filters");

    client
        .fetch_table_details(db, "t")
        .await
        .expect("fetch_table_details");
    client
        .fetch_column_stats(db, "t", "x", "test-stats")
        .await
        .expect("fetch_column_stats");
    client
        .fetch_parts_summary(db, "t")
        .await
        .expect("fetch_parts_summary");
    client
        .fetch_active_merges(db, "t")
        .await
        .expect("fetch_active_merges");
    client
        .fetch_dependency_graph(db, "t", 3, 50)
        .await
        .expect("fetch_dependency_graph");

    drop_fixtures(&client, db).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn column_distribution_routes_by_type() {
    let Some(client) = try_connect().await else {
        return;
    };
    let db = "chgui_test_dist";

    let _ = client
        .run_query(&format!("DROP DATABASE IF EXISTS {db}"), "drop", None)
        .await;
    client
        .run_query(&format!("CREATE DATABASE {db}"), "create-db", None)
        .await
        .expect("CREATE DATABASE");
    client
        .run_query(
            &format!(
                "CREATE TABLE {db}.t ( \
                    x UInt64, \
                    d DateTime, \
                    s Nullable(String), \
                    e Enum8('red' = 1, 'blue' = 2, 'green' = 3), \
                    u UUID \
                ) ENGINE = MergeTree ORDER BY x"
            ),
            "create-t",
            None,
        )
        .await
        .expect("CREATE TABLE");
    client
        .run_query(
            &format!(
                "INSERT INTO {db}.t \
                SELECT \
                    number AS x, \
                    toDateTime('2026-01-01 00:00:00') + INTERVAL number MINUTE AS d, \
                    multiIf(number % 4 = 0, NULL, number % 4 = 1, '', toString(number % 3)) AS s, \
                    CAST(1 + (number % 3) AS Enum8('red' = 1, 'blue' = 2, 'green' = 3)) AS e, \
                    generateUUIDv4() AS u \
                FROM numbers(100)"
            ),
            "seed",
            None,
        )
        .await
        .expect("seed rows");

    // ClickHouse's `histogram()` can merge streaming buckets, so the bucket sum can fall short of the
    // row count.
    match client
        .fetch_column_distribution(db, "t", "x", "test-dist")
        .await
        .expect("numeric distribution")
    {
        ColumnDistribution::Histogram { buckets, notes } => {
            assert!(!buckets.is_empty(), "expected ≥1 histogram bucket");
            let total: u64 = buckets.iter().map(|b| b.count).sum();
            assert!(
                (95..=100).contains(&total),
                "expected bucket-count sum ≈ 100 (±5 for histogram() drift), got {total}",
            );
            assert!(notes.iter().any(|n| n.contains("Leaves out NULLs")));
            assert!(notes.iter().any(|n| n.contains("Scans the full column")));
        }
        other => panic!("expected Histogram for UInt64, got {other:?}"),
    };

    match client
        .fetch_column_distribution(db, "t", "d", "test-dist")
        .await
        .expect("time distribution")
    {
        ColumnDistribution::HistogramTime { buckets, .. } => {
            assert!(!buckets.is_empty(), "expected ≥1 time bucket");
            assert!(
                buckets.iter().all(|b| b.lower > 0.0),
                "DateTime buckets should have positive unix-timestamp edges",
            );
        }
        other => panic!("expected HistogramTime for DateTime, got {other:?}"),
    };

    match client
        .fetch_column_distribution(db, "t", "s", "test-dist")
        .await
        .expect("string distribution")
    {
        ColumnDistribution::TopK { values, .. } => {
            let null_bucket = values.iter().find(|v| v.is_null);
            assert!(
                null_bucket.is_some(),
                "expected a NULL bucket in top-K, got {values:?}",
            );
            assert_eq!(null_bucket.unwrap().count, 25, "25 rows seeded as NULL",);
            let empty_bucket = values.iter().find(|v| !v.is_null && v.label.is_empty());
            assert!(
                empty_bucket.is_some(),
                "expected an empty-string bucket distinct from NULL",
            );
            assert_eq!(empty_bucket.unwrap().count, 25, "25 rows seeded as ''");
        }
        other => panic!("expected TopK for Nullable(String), got {other:?}"),
    };

    match client
        .fetch_column_distribution(db, "t", "e", "test-dist")
        .await
        .expect("enum distribution")
    {
        ColumnDistribution::TopK { values, .. } => {
            let labels: Vec<&str> = values.iter().map(|v| v.label.as_str()).collect();
            for expected in ["red", "blue", "green"] {
                assert!(
                    labels.contains(&expected),
                    "expected enum label {expected:?} in top-K labels, got {labels:?}",
                );
            }
        }
        other => panic!("expected TopK for Enum8, got {other:?}"),
    };

    match client
        .fetch_column_distribution(db, "t", "u", "test-dist")
        .await
        .expect("uuid distribution")
    {
        ColumnDistribution::None { reason } => {
            assert!(
                reason.contains("UUID") || reason.to_lowercase().contains("no distribution"),
                "expected reason to mention UUID/unsupported, got {reason:?}",
            );
        }
        other => panic!("expected None for UUID, got {other:?}"),
    };

    match client
        .fetch_column_distribution(db, "t", "does_not_exist", "test-dist")
        .await
        .expect("missing column distribution")
    {
        ColumnDistribution::None { .. } => {}
        other => panic!("expected None for missing column, got {other:?}"),
    };

    drop_fixtures(&client, db).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn parts_summary_reflects_inserts() {
    let Some(client) = try_connect().await else {
        return;
    };
    let db = "chgui_test_parts";
    reset_fixtures(&client, db).await;

    let parts = match client
        .fetch_parts_summary(db, "t")
        .await
        .expect("fetch_parts_summary")
    {
        PartsSummaryResult::Enabled { summary } => summary,
        PartsSummaryResult::Disabled => {
            panic!("expected Enabled for a freshly created MergeTree, got Disabled")
        }
    };
    assert!(
        parts.active_count >= 1,
        "expected ≥1 active part after seed, got {}",
        parts.active_count
    );
    assert!(
        parts.total_active_bytes > 0,
        "expected non-zero on-disk bytes after seed, got 0"
    );

    drop_fixtures(&client, db).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kafka_surface_against_real_ch() {
    let Some(client) = try_connect().await else {
        return;
    };
    let db = "chgui_test_kafka";
    reset_kafka_fixtures(&client, db).await;

    let tables = client
        .list_kafka_tables()
        .await
        .expect("list_kafka_tables decode");
    let rows = match tables {
        KafkaTablesResult::Enabled { rows } => rows,
        KafkaTablesResult::Disabled => panic!(
            "expected Enabled on CH 26.3 — if this fires, the CH pin \
             in scripts/docker-compose.test-ch.yml dropped below 23.5 \
             or lost kafka_consumers support"
        ),
    };
    let fixture_row = rows
        .iter()
        .find(|r| r.database == db && r.table == "k_src")
        .unwrap_or_else(|| {
            panic!(
                "fixture table {db}.k_src missing from list_kafka_tables \
                 (got {} row(s)); either the fixture didn't apply or the \
                 engine LIKE 'Kafka%' filter stopped matching",
                rows.len()
            )
        });
    assert!(
        fixture_row.engine_full.contains("Kafka"),
        "engine_full should mention Kafka, got {:?}",
        fixture_row.engine_full
    );

    let consumers = client
        .list_kafka_consumers(db, "k_src")
        .await
        .expect("list_kafka_consumers decode");
    match consumers {
        KafkaConsumersResult::Enabled { rows } => {
            // The row count depends on timing, so only the contents of any row are checked.
            for c in &rows {
                assert_eq!(c.database, db, "db mismatch in consumer row");
                assert_eq!(c.table, "k_src", "table mismatch in consumer row");
            }
        }
        KafkaConsumersResult::Disabled => panic!(
            "expected Enabled on CH 26.3 after list_kafka_tables saw \
             the fixture; if this fires, the probe query is out of \
             sync with the main query"
        ),
    }

    // `kafka_stuck` depends on timing with a fake broker, so the test does not assert it.
    let pulse = client.kafka_pulse().await.expect("kafka_pulse decode");
    assert!(
        pulse.kafka_tables >= 1,
        "kafka_pulse should count the fixture table, got {}",
        pulse.kafka_tables
    );

    drop_fixtures(&client, db).await;
}

#[tokio::test]
async fn names_with_a_backslash_and_quote_stay_inside_the_literal() {
    let Some(client) = try_connect().await else {
        return;
    };
    let db = "chgui_test_escaping";
    reset_fixtures(&client, db).await;
    client
        .run_query(
            &format!(r"CREATE TABLE {db}.`x\\\' OR 1 -- ` (a Int32) ENGINE = Memory"),
            "test-create-escaping",
            None,
        )
        .await
        .expect("create the table");

    let parts = client
        .fetch_parts_summary(db, r"x\' OR 1 -- ")
        .await
        .expect("fetch_parts_summary");
    let PartsSummaryResult::Enabled { summary } = parts else {
        panic!("expected Enabled");
    };
    assert_eq!(summary.active_count, 0, "the name must match only itself");

    drop_fixtures(&client, db).await;
}
