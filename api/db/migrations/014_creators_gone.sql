-- Canales que ya no existen (el creador cambio de nick o link): la revision
-- diaria cuenta las veces seguidas que el perfil no aparece y, al tercer dia,
-- oculta la ficha. gone_at marca las ocultadas por el sistema para poder
-- reactivarlas si la app vuelve a reportar el canal.
ALTER TABLE creators ADD COLUMN IF NOT EXISTS missing_checks SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS gone_at TIMESTAMPTZ;
