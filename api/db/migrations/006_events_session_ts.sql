CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events (session_id, ts);
