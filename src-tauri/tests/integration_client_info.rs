//! `client_name`, `os_user`, and `client_hostname` are ClientInfo fields, not settings, so a readonly
//! user's queries must log them too.

use std::time::{SystemTime, UNIX_EPOCH};

use ch_gui_lib::clickhouse::client::{client_name, Client, ConnectionConfig};
use ch_gui_lib::clickhouse::value::CellValue;

mod common;

async fn logged_identity(cfg: ConnectionConfig, lane: Option<&str>) -> Vec<CellValue> {
    let client = Client::connect_in_lane(cfg, lane).await.unwrap();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tag = format!("chgui-client-info-{nanos}");
    client.run_query("SELECT 1", &tag, None).await.unwrap();

    // `run_query` prefixes the SQL with `-- chgui:<tag>`. Only the full user may flush and read the log.
    let admin = common::try_connect().await.unwrap();
    admin
        .run_query("SYSTEM FLUSH LOGS", "test-client-info", None)
        .await
        .unwrap();
    let res = admin
        .run_query(
            &format!(
                "SELECT client_name, os_user, client_hostname \
                 FROM system.query_log \
                 WHERE type = 'QueryFinish' AND query LIKE '%chgui:{tag}\\n%' \
                 ORDER BY event_time_microseconds DESC LIMIT 1"
            ),
            "test-client-info",
            None,
        )
        .await
        .unwrap();
    assert_eq!(res.rows.len(), 1, "no query_log row for {tag}");
    res.rows[0].clone()
}

fn expected(lane: Option<&str>) -> Vec<CellValue> {
    vec![
        CellValue::Str(client_name(lane)),
        CellValue::Str(whoami::fallible::username().unwrap()),
        CellValue::Str(whoami::fallible::hostname().unwrap()),
    ]
}

#[tokio::test]
async fn queries_name_ch_gui_in_query_log() {
    if common::try_connect().await.is_none() {
        return;
    }
    assert_eq!(
        client_name(Some("editor")),
        format!("ch-gui {} (editor)", env!("CARGO_PKG_VERSION"))
    );
    for lane in [Some("editor"), Some("monitor"), None] {
        assert_eq!(
            logged_identity(common::test_config(), lane).await,
            expected(lane),
            "{lane:?}"
        );
    }
}

#[tokio::test]
async fn readonly_user_is_identified_too() {
    if common::try_connect().await.is_none() {
        return;
    }
    let analyst = ConnectionConfig {
        user: "analyst".into(),
        password: "analyst".into(),
        ..common::test_config()
    };
    assert_eq!(
        logged_identity(analyst, Some("editor")).await,
        expected(Some("editor"))
    );
}
