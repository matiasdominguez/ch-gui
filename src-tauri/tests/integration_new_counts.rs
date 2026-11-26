use std::collections::HashSet;

mod common;
use common::try_connect;

#[tokio::test(flavor = "multi_thread")]
async fn activity_count_matches_rows_marked_new() {
    let Some(client) = try_connect().await else {
        return;
    };
    // `throwIf` raises a server error (code 395), and the typo raises a user's mistake (code 62).
    let _ = client
        .run_query("SELECT throwIf(1, 'new-counts')", "test-new", None)
        .await;
    let _ = client.run_query("SELEC 1", "test-new", None).await;

    let db = "chgui_test_new_counts";
    for sql in [
        format!("DROP DATABASE IF EXISTS {db}"),
        format!("CREATE DATABASE {db}"),
        format!("CREATE TABLE {db}.t (x UInt64) ENGINE = MergeTree ORDER BY x"),
        format!("CREATE TABLE {db}.sink (x UInt64) ENGINE = MergeTree ORDER BY x"),
        format!(
            "CREATE MATERIALIZED VIEW {db}.bad TO {db}.sink AS \
             SELECT throwIf(x > 0, 'boom') + x AS x FROM {db}.t"
        ),
    ] {
        client.run_query(&sql, "test-new", None).await.unwrap();
    }
    let _ = client
        .run_query(
            &format!(
                "INSERT INTO {db}.t SETTINGS materialized_views_ignore_errors = 1, \
                 log_query_views = 1 VALUES (1)"
            ),
            "test-new",
            None,
        )
        .await;
    client
        .run_query("SYSTEM FLUSH LOGS", "test-new", None)
        .await
        .unwrap();

    let errors = client.list_server_errors().await.unwrap();
    let pulse = client.error_pulse().await.unwrap();
    let mv = client.list_mv_failures(None).await.unwrap();

    let throw = errors
        .iter()
        .find(|e| e.code == 395)
        .expect("throwIf listed");
    assert!(throw.recent, "a fresh server error counts as new");
    let typo = errors.iter().find(|e| e.code == 62).expect("typo listed");
    assert!(!typo.recent, "a user's syntax error never counts as new");

    let new_errors: HashSet<_> = errors
        .iter()
        .filter(|e| e.recent)
        .map(|e| &e.name)
        .collect();
    assert_eq!(pulse.errors_recent as usize, new_errors.len());

    if let ch_gui_lib::clickhouse::client::MvFailuresResult::Enabled { rows } = mv {
        assert!(
            rows.iter()
                .any(|r| r.recent && r.view_name == format!("{db}.bad")),
            "the fresh MV failure is marked new"
        );
        let new_views: HashSet<_> = rows
            .iter()
            .filter(|r| r.recent)
            .map(|r| &r.view_name)
            .collect();
        assert_eq!(pulse.mv_failures_recent as usize, new_views.len());
    } else {
        panic!("query_views_log should be enabled on the test server");
    }

    client
        .run_query(&format!("DROP DATABASE {db}"), "test-new", None)
        .await
        .unwrap();
}
