//! Integration tests pass as skipped when nothing listens at `CH_TEST_HOST:CH_TEST_PORT`.

use std::time::Duration;

use ch_gui_lib::clickhouse::client::{Client, ConnectionConfig};

pub fn test_config() -> ConnectionConfig {
    ConnectionConfig {
        id: "chgui-test".into(),
        host: std::env::var("CH_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
        port: std::env::var("CH_TEST_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(9000),
        user: std::env::var("CH_TEST_USER").unwrap_or_else(|_| "default".into()),
        password: std::env::var("CH_TEST_PASSWORD").unwrap_or_default(),
        secure: false,
        default_database: Some("default".into()),
        custom_ca_pem: None,
        cluster_name: None,
        cluster_fanout: false,
    }
}

/// Skips only when nothing listens, so a broken `Client::connect` fails the suite.
pub async fn try_connect() -> Option<Client> {
    let cfg = test_config();
    let host = format!("{}:{}", cfg.host, cfg.port);
    let listening = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::net::TcpStream::connect(&host),
    )
    .await;
    if !matches!(listening, Ok(Ok(_))) {
        eprintln!(
            "skipping integration test: no CH at {host} (start with \
             `docker compose -f scripts/docker-compose.test-ch.yml up -d`)"
        );
        return None;
    }
    match tokio::time::timeout(Duration::from_secs(5), Client::connect(cfg)).await {
        Ok(Ok(c)) => Some(c),
        Ok(Err(e)) => panic!("CH at {host} rejected connect: {e}"),
        Err(_) => panic!("CH at {host} accepted TCP but connect timed out"),
    }
}
