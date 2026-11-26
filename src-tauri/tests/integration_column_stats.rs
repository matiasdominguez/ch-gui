//! ClickHouse resolves a bare name to a SELECT alias before a column, so the stats queries use no
//! aliases. `readonly=1` profiles refuse `SETTINGS` clauses with code 164, so `run_capped` retries
//! without them.

use ch_gui_lib::clickhouse::client::{Client, ColumnDistribution, ConnectionConfig};

mod common;

/// Names that would collide if the stats queries added aliases, plus `amount` as a control.
const NUMERIC: &[&str] = &[
    "total",
    "nulls",
    "uniq_approx",
    "min_val",
    "max_val",
    "b",
    "cnt",
    "__chgui_total",
    "amount",
];
const TEXT: &[&str] = &[
    "label",
    "n",
    "is_null",
    "lower",
    "upper",
    "__chgui_label",
    "status",
];

async fn setup(table: &str) -> Option<Client> {
    let admin = common::try_connect().await?;
    let numeric: Vec<_> = NUMERIC
        .iter()
        .map(|c| format!("`{c}` Decimal(18, 2)"))
        .collect();
    let text: Vec<_> = TEXT.iter().map(|c| format!("`{c}` String")).collect();
    for sql in [
        format!("DROP TABLE IF EXISTS {table}"),
        format!(
            "CREATE TABLE {table} ({}, {}, ts DateTime) ENGINE = MergeTree ORDER BY tuple()",
            numeric.join(", "),
            text.join(", ")
        ),
        format!(
            "INSERT INTO {table} SELECT {}, {}, toDateTime('2026-01-01 00:00:00') + number * 3600 \
             FROM numbers(200)",
            NUMERIC
                .iter()
                .map(|_| "toDecimal64(number % 37, 2)")
                .collect::<Vec<_>>()
                .join(", "),
            TEXT.iter()
                .map(|_| "toString(number % 7)")
                .collect::<Vec<_>>()
                .join(", ")
        ),
    ] {
        admin
            .run_query(&sql, "test-stats-setup", None)
            .await
            .unwrap();
    }
    Some(admin)
}

async fn check_every_column(client: &Client, table: &str, who: &str) {
    for col in NUMERIC.iter().chain(TEXT) {
        let stats = client
            .fetch_column_stats("default", table, col, "test-stats")
            .await
            .unwrap_or_else(|e| panic!("{who}: stats on `{col}` failed: {e}"));
        assert_eq!(stats.total, Some(200), "{who}: `{col}` total");
        assert_eq!(stats.nulls, Some(0), "{who}: `{col}` nulls");
        let dist = client
            .fetch_column_distribution("default", table, col, "test-dist")
            .await
            .unwrap_or_else(|e| panic!("{who}: distribution on `{col}` failed: {e}"));
        match dist {
            ColumnDistribution::Histogram { buckets, .. } => {
                assert!(!buckets.is_empty(), "{who}: `{col}` histogram empty")
            }
            ColumnDistribution::TopK { values, .. } => {
                assert_eq!(values.len(), 7, "{who}: `{col}` top values")
            }
            other => panic!("{who}: `{col}` unexpected distribution {other:?}"),
        }
    }
    let dist = client
        .fetch_column_distribution("default", table, "ts", "test-dist")
        .await
        .unwrap_or_else(|e| panic!("{who}: distribution on `ts` failed: {e}"));
    assert!(
        matches!(dist, ColumnDistribution::HistogramTime { ref buckets, .. } if !buckets.is_empty()),
        "{who}: `ts` time histogram: {dist:?}"
    );
}

#[tokio::test]
async fn stats_work_on_any_column_name() {
    let Some(admin) = setup("chgui_stats_names_full").await else {
        return;
    };
    check_every_column(&admin, "chgui_stats_names_full", "default").await;
}

#[tokio::test]
async fn stats_work_for_readonly_users() {
    if setup("chgui_stats_names_ro").await.is_none() {
        return;
    }
    let cfg = ConnectionConfig {
        user: "analyst".into(),
        password: "analyst".into(),
        ..common::test_config()
    };
    let analyst = Client::connect(cfg).await.unwrap_or_else(|e| {
        panic!(
            "connect as analyst failed: {e}\nRecreate the test server: \
             docker compose -f scripts/docker-compose.test-ch.yml up -d --force-recreate"
        )
    });
    check_every_column(&analyst, "chgui_stats_names_ro", "analyst").await;
}
