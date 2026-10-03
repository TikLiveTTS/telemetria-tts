CREATE TABLE IF NOT EXISTS installation_blocked_word_snapshots (
  machine_id  TEXT PRIMARY KEY REFERENCES installs(machine_id) ON DELETE CASCADE,
  snapshot_at TIMESTAMPTZ NOT NULL,
  list_hash   CHAR(64) NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocked_word_snapshots_last_seen
  ON installation_blocked_word_snapshots (last_seen DESC);

CREATE TABLE IF NOT EXISTS blocked_word_weekly (
  week      DATE NOT NULL,
  word_norm TEXT NOT NULL REFERENCES blocked_words(word_norm) ON DELETE CASCADE,
  users     INTEGER NOT NULL,
  PRIMARY KEY (week, word_norm)
);

CREATE OR REPLACE FUNCTION rebuild_blocked_word_weekly(active_days INTEGER, tz TEXT)
RETURNS INTEGER AS $$
DECLARE
  current_week DATE := date_trunc('week', NOW() AT TIME ZONE tz)::date;
  touched INTEGER;
BEGIN
  DELETE FROM blocked_word_weekly WHERE week = current_week;

  INSERT INTO blocked_word_weekly (week, word_norm, users)
  SELECT current_week, ibw.word_norm, COUNT(DISTINCT ibw.machine_id)::int
    FROM installation_blocked_words ibw
    JOIN installation_blocked_word_snapshots s USING (machine_id)
   WHERE active_days = 0 OR s.last_seen >= NOW() - make_interval(days => active_days)
   GROUP BY ibw.word_norm;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$$ LANGUAGE plpgsql;
