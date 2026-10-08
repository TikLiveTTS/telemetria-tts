-- Versiones ocultas desde el panel (pagina Versiones). No borra datos: solo
-- las saca del reparto, la tabla y el despliegue. Quitar la fila las devuelve.
CREATE TABLE IF NOT EXISTS hidden_versions (
  app_version TEXT PRIMARY KEY,
  hidden_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
