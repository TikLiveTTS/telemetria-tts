-- Credencial de ingesta por instalacion (BE-027). Se guarda en claro porque es
-- una clave simetrica: hace falta para recalcular el HMAC de cada request.
ALTER TABLE installs ADD COLUMN ingest_secret TEXT;
ALTER TABLE installs ADD COLUMN ingest_secret_registered_at TIMESTAMPTZ;
