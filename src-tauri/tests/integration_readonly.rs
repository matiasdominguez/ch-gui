//! `analyst` in `scripts/test-ch/` is a `readonly=1` user without the REMOTE grant. Connect-time
//! SETs fail for it with code 164, and `clusterAllReplicas()` fails with 497, which must fall back
//! to local tables.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use ch_gui_lib::clickhouse::client::{
    Client, ConnectionConfig, LogEvent, MvFailuresResult, PendingMutationsResult,
    ServerHistoryFilters,
};
use ch_gui_lib::clickhouse::value::CellValue;

mod common;

fn analyst(fanout: bool, cluster: Option<&str>) -> ConnectionConfig {
    ConnectionConfig {
        user: "analyst".into(),
        password: "analyst".into(),
        cluster_name: cluster.map(str::to_string),
        cluster_fanout: fanout,
        ..common::test_config()
    }
}

/// A container without the `analyst` user panics here, since skipping would hide the whole suite.
async fn connect(cfg: ConnectionConfig) -> Option<Client> {
    common::try_connect().await?;
    match tokio::time::timeout(Duration::from_secs(5), Client::connect(cfg)).await {
        Ok(Ok(c)) => Some(c),
        Ok(Err(e)) => panic!(
            "connect failed: {e}\nIf `analyst` is unknown, recreate the test server: \
             docker compose -f scripts/docker-compose.test-ch.yml up -d --force-recreate"
        ),
        Err(_) => panic!("connect timed out"),
    }
}

async fn scalar(client: &Client, sql: &str) -> CellValue {
    let res = client.run_query(sql, "test-readonly", None).await.unwrap();
    res.rows[0][0].clone()
}

#[tokio::test]
async fn readonly_user_connects_and_browses() {
    let Some(client) = connect(analyst(false, None)).await else {
        return;
    };
    assert_eq!(
        scalar(&client, "SELECT getSetting('readonly')").await,
        CellValue::Int(1)
    );
    assert_eq!(
        scalar(&client, "SELECT getSetting('max_result_rows')").await,
        CellValue::Int(0)
    );
    let err = client
        .run_query("SET max_result_rows = 5", "test-readonly", None)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("164") || err.contains("readonly"), "{err}");

    client
        .run_query("SELECT name FROM system.databases", "test-readonly", None)
        .await
        .unwrap();
    client
        .list_server_history(10, &ServerHistoryFilters::default())
        .await
        .unwrap();
    client
        .list_server_history_grouped(10, &ServerHistoryFilters::default())
        .await
        .unwrap();
    client.list_functions().await.unwrap();
    client.list_changed_settings().await.unwrap();
    client.list_running_queries().await.unwrap();
    assert!(!client.can_kill_others().await.unwrap());
    let unavailable = Arc::new(AtomicBool::new(false));
    let flag = unavailable.clone();
    let res = client
        .run_query_with_logs(
            "SELECT 42",
            "test-readonly-logs",
            "debug",
            Box::new(move |event| {
                if matches!(event, LogEvent::Unavailable) {
                    flag.store(true, Ordering::SeqCst);
                }
            }),
            None,
        )
        .await
        .unwrap();
    assert_eq!(res.rows[0][0], CellValue::Int(42));
    assert!(unavailable.load(Ordering::SeqCst), "no Unavailable event");
    assert!(
        !client.is_closed(),
        "a refused SET must not drop the socket"
    );
    let version = client.server_version().await.unwrap();
    assert!(
        version.starts_with(|c: char| c.is_ascii_digit()),
        "{version}"
    );
    assert_eq!(client.server_version().await.unwrap(), version);
}

/// `system.query_views_log` exists only after a materialized view runs and the logs flush.
/// Without it, `list_mv_failures` returns `Disabled`.
async fn ensure_query_views_log() {
    let admin = common::try_connect().await.unwrap();
    for sql in [
        "CREATE TABLE IF NOT EXISTS chgui_ro_src (x UInt8) ENGINE = MergeTree ORDER BY x",
        "CREATE MATERIALIZED VIEW IF NOT EXISTS chgui_ro_mv ENGINE = MergeTree ORDER BY x \
         AS SELECT x FROM chgui_ro_src",
        "INSERT INTO chgui_ro_src VALUES (1)",
        "SYSTEM FLUSH LOGS",
    ] {
        admin
            .run_query(sql, "test-readonly-setup", None)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn readonly_fanout_falls_back_to_local_tables() {
    if common::try_connect().await.is_none() {
        return;
    }
    ensure_query_views_log().await;
    for cluster in [Some("chgui_test"), None] {
        let Some(client) = connect(analyst(true, cluster)).await else {
            return;
        };
        client.list_server_errors().await.unwrap();
        assert!(
            client.take_fanout_disabled_notice(),
            "{cluster:?}: the 497 should disable fan-out once"
        );
        assert!(
            !client.take_fanout_disabled_notice(),
            "the notice fires once per session"
        );
        client.error_pulse().await.unwrap();
        assert!(matches!(
            client.list_mv_failures(None).await.unwrap(),
            MvFailuresResult::Enabled { .. }
        ));
        assert!(matches!(
            client.list_pending_mutations().await.unwrap(),
            PendingMutationsResult::Enabled { .. }
        ));
        client.list_replica_queue().await.unwrap();
        client.kafka_pulse().await.unwrap();
        client.sync_cluster_fanout(true);
        client.list_server_errors().await.unwrap();
        assert!(!client.take_fanout_disabled_notice());
    }
}

#[tokio::test]
async fn full_user_fans_out_across_the_cluster() {
    for cluster in [Some("chgui_test"), None] {
        let cfg = ConnectionConfig {
            cluster_name: cluster.map(str::to_string),
            cluster_fanout: true,
            ..common::test_config()
        };
        let Some(client) = connect(cfg).await else {
            return;
        };
        client.list_server_errors().await.unwrap();
        client.error_pulse().await.unwrap();
        assert!(client.can_kill_others().await.unwrap());
        assert!(matches!(
            client.list_pending_mutations().await.unwrap(),
            PendingMutationsResult::Enabled { .. }
        ));
        client.kafka_pulse().await.unwrap();
        assert!(
            !client.take_fanout_disabled_notice(),
            "{cluster:?}: a user with REMOTE must keep fan-out on"
        );
    }
}
