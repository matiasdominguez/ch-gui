CREATE TABLE IF NOT EXISTS saved_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT,
  name TEXT NOT NULL,
  sql TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_saved_queries_conn
  ON saved_queries (connection_id, updated_at DESC);
