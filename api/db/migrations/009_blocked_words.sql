CREATE TABLE IF NOT EXISTS blocked_words (
  word_norm  TEXT PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS installation_blocked_words (
  machine_id TEXT NOT NULL REFERENCES installs(machine_id) ON DELETE CASCADE,
  word_norm  TEXT NOT NULL REFERENCES blocked_words(word_norm) ON DELETE CASCADE,
  language   VARCHAR(16),
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (machine_id, word_norm)
);

CREATE INDEX IF NOT EXISTS idx_installation_blocked_words_last_seen
  ON installation_blocked_words (last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_installation_blocked_words_language
  ON installation_blocked_words (language, last_seen DESC);
