ALTER TABLE query_history ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_history_pinned
  ON query_history (connection_id, pinned DESC, executed_at DESC);
