CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  user TEXT NOT NULL,
  secure INTEGER NOT NULL DEFAULT 1,
  default_database TEXT,
  custom_ca_pem TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS query_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  sql TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  rows_returned INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_connection_time
  ON query_history (connection_id, executed_at DESC);
