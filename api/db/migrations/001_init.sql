-- Una fila por instalacion (maquina), no por sesion.
-- Permite contar usuarios unicos sin escanear sessions.
CREATE TABLE IF NOT EXISTS installs (
  machine_id     TEXT PRIMARY KEY,
  user_id        TEXT UNIQUE,              -- 'usr_7f3a91c2', generado una sola vez
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app_version    TEXT,
  os_platform    TEXT,
  os_release     TEXT,
  os_arch        TEXT,
  locale         TEXT,
  country        TEXT,
  country_code   CHAR(2),
  city           TEXT,
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  ip             TEXT,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  total_minutes  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id               UUID PRIMARY KEY,
  machine_id               TEXT NOT NULL REFERENCES installs(machine_id) ON DELETE CASCADE,
  app_version              TEXT,
  os_release               TEXT,
  country                  TEXT,
  country_code             CHAR(2),
  city                     TEXT,
  lat                      DOUBLE PRECISION,
  lon                      DOUBLE PRECISION,
  ip                       TEXT,
  platforms_used           TEXT[] NOT NULL DEFAULT '{}',
  started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at        TIMESTAMPTZ,
  ended_at                 TIMESTAMPTZ,
  session_duration_minutes INTEGER,
  first_seen               BOOLEAN NOT NULL DEFAULT FALSE
);

-- Tabla generica: cualquier conector escribe aqui sin migracion nueva.
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
  machine_id  TEXT NOT NULL,
  connector   TEXT NOT NULL,
  name        TEXT NOT NULL,
  props       JSONB NOT NULL DEFAULT '{}',
  app_version TEXT,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_errors (
  id          BIGSERIAL PRIMARY KEY,
  machine_id  TEXT,
  session_id  UUID,
  app_version TEXT,
  where_at    TEXT,
  message     TEXT,
  stack       TEXT,
  signature   TEXT,             -- hash de where_at+message, para agrupar
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_installs_country   ON installs (country_code);
CREATE INDEX IF NOT EXISTS idx_installs_first     ON installs (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_machine   ON sessions (machine_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started   ON sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_heartbeat ON sessions (last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_ts          ON events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_conn        ON events (connector, name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_props       ON events USING GIN (props);
CREATE INDEX IF NOT EXISTS idx_errors_sig         ON app_errors (signature, ts DESC);
