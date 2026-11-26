//! Server-side log streaming.
//!
//! When a session enables `send_logs_level`, ClickHouse pushes log packets
//! interleaved with data packets over the native TCP protocol. This module
//! defines a typed [`LogEntry`] view of those packets and a decoder that
//! pulls entries out of the raw [`Block`] the server sends.
//!
//! chgui patch — not in upstream klickhouse 0.13.x / 0.14.x.

use chrono::{DateTime, Utc};

use crate::{block::Block, values::Value};

/// One log line emitted by the ClickHouse server during query execution.
///
/// Field set tracks the server's text_log on-wire schema. Anything missing
/// from the received block (older or differently-built servers) defaults to
/// the empty value rather than producing an error — log streaming is a
/// best-effort feature, never a query failure.
#[derive(Debug, Clone)]
pub struct LogEntry {
    /// Server-side event timestamp in UTC (microsecond precision when the
    /// server provides `event_time_microseconds`, otherwise second precision).
    pub event_time: Option<DateTime<Utc>>,
    pub host_name: String,
    pub query_id: String,
    pub thread_id: u64,
    /// Poco priority: 1=Fatal, 3=Error, 4=Warning, 6=Information, 7=Debug, 8=Trace.
    pub priority: i8,
    /// Logger name (e.g. `executeQuery`, `MergeTreeData`).
    pub source: String,
    pub text: String,
}

/// Decode a log block into a `Vec<LogEntry>`. Reads columns by name so
/// minor schema variations across server versions don't break decoding.
pub fn decode_log_block(block: &Block) -> Vec<LogEntry> {
    let n = block.rows as usize;
    if n == 0 {
        return Vec::new();
    }

    let event_time_us = block.column_data.get("event_time_microseconds");
    let event_time = block.column_data.get("event_time");
    let host = block.column_data.get("host_name");
    let qid = block.column_data.get("query_id");
    let tid = block.column_data.get("thread_id");
    let prio = block.column_data.get("priority");
    let src = block.column_data.get("source");
    let txt = block.column_data.get("text");

    (0..n)
        .map(|i| LogEntry {
            event_time: event_time_us
                .and_then(|c| c.get(i))
                .and_then(value_to_datetime64_utc)
                .or_else(|| {
                    event_time
                        .and_then(|c| c.get(i))
                        .and_then(value_to_datetime_utc)
                }),
            host_name: src_string(host, i),
            query_id: src_string(qid, i),
            thread_id: prio_u64(tid, i),
            priority: prio_i8(prio, i),
            source: src_string(src, i),
            text: src_string(txt, i),
        })
        .collect()
}

fn src_string(col: Option<&Vec<Value>>, i: usize) -> String {
    match col.and_then(|c| c.get(i)) {
        Some(Value::String(b)) => String::from_utf8_lossy(b).into_owned(),
        _ => String::new(),
    }
}

fn prio_u64(col: Option<&Vec<Value>>, i: usize) -> u64 {
    match col.and_then(|c| c.get(i)) {
        Some(Value::UInt64(v)) => *v,
        Some(Value::UInt32(v)) => *v as u64,
        _ => 0,
    }
}

fn prio_i8(col: Option<&Vec<Value>>, i: usize) -> i8 {
    match col.and_then(|c| c.get(i)) {
        Some(Value::Int8(v)) => *v,
        Some(Value::UInt8(v)) => *v as i8,
        _ => 0,
    }
}

fn value_to_datetime_utc(v: &Value) -> Option<DateTime<Utc>> {
    if let Value::DateTime(dt) = v {
        chrono::DateTime::<chrono_tz::Tz>::try_from(*dt)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    } else {
        None
    }
}

fn value_to_datetime64_utc(v: &Value) -> Option<DateTime<Utc>> {
    if let Value::DateTime64(dt) = v {
        chrono::DateTime::<chrono_tz::Tz>::try_from(*dt)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    } else {
        None
    }
}
