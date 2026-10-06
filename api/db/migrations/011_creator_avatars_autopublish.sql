-- Copia propia de los avatares: las URLs de TikTok van firmadas y caducan
-- (x-expires), asi que la web publica se quedaba con la inicial. La imagen
-- vive en disco (AVATAR_DIR, volumen "fotos"); aqui solo su indice.
-- file NULL = la descarga de source_url fallo; no se reintenta hasta que
-- llegue una URL distinta.
CREATE TABLE IF NOT EXISTS creator_avatars (
  creator_id   BIGINT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  source_url   TEXT NOT NULL,
  file         TEXT,
  content_type TEXT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Publicacion automatica diaria: solo toca fichas que nadie decidio a mano.
-- Cualquier publicar/despublicar/ocultar desde el panel lo pone en TRUE.
ALTER TABLE creators ADD COLUMN IF NOT EXISTS publish_decided BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE creators SET publish_decided = TRUE WHERE is_public OR is_hidden;
