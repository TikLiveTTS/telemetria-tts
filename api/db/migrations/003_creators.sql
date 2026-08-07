-- Creadores: el @ / link del canal de cada streamer que usa la app.
-- Una fila por (plataforma, canal). Un mismo user_id puede tener varios canales.
CREATE TABLE IF NOT EXISTS creators (
  id             BIGSERIAL PRIMARY KEY,
  platform       TEXT NOT NULL,                      -- tiktok | twitch | youtube
  username       TEXT NOT NULL,                      -- @handle / login / channelId
  user_id        TEXT REFERENCES installs(user_id) ON DELETE SET NULL,
  machine_id     TEXT,                               -- traza tecnica, no se publica
  resolve_count  SMALLINT NOT NULL DEFAULT 0,        -- 0,1,2 — espejo del contador del cliente
  force_resolve  BOOLEAN  NOT NULL DEFAULT FALSE,    -- lo activa el boton "re-resolver" del panel
  display_name   TEXT,
  channel_url    TEXT,
  avatar_url     TEXT,
  follower_count INTEGER,
  peak_followers INTEGER,
  country        TEXT,
  app_version    TEXT,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_sessions INTEGER NOT NULL DEFAULT 0,
  total_minutes  INTEGER NOT NULL DEFAULT 0,
  is_public      BOOLEAN NOT NULL DEFAULT FALSE,     -- decide si sale en la web publica
  is_hidden      BOOLEAN NOT NULL DEFAULT FALSE,     -- descartar spam/pruebas sin borrar
  featured_order INTEGER,                            -- fijar destacados arriba
  notes          TEXT,                               -- notas privadas
  UNIQUE (platform, username)
);

CREATE TABLE IF NOT EXISTS creator_follower_history (
  creator_id BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  day        DATE   NOT NULL,
  followers  INTEGER NOT NULL,
  PRIMARY KEY (creator_id, day)
);

CREATE INDEX IF NOT EXISTS idx_creators_last_seen ON creators (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_creators_user      ON creators (user_id);
CREATE INDEX IF NOT EXISTS idx_creators_public
  ON creators (is_public, featured_order NULLS LAST, follower_count DESC);
