CREATE TABLE IF NOT EXISTS rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  method TEXT NOT NULL,
  rate REAL NOT NULL,
  source_updated_at TEXT,
  UNIQUE (recorded_at, provider, method)
);

CREATE INDEX IF NOT EXISTS idx_rate_history_recorded_at
  ON rate_history (recorded_at);

CREATE INDEX IF NOT EXISTS idx_rate_history_provider_method_recorded_at
  ON rate_history (provider, method, recorded_at);
