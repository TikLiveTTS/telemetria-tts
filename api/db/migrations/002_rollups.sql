-- Agregado diario por conector+evento.
-- Alimenta la pagina "Funciones" sin escanear la tabla events.
CREATE TABLE IF NOT EXISTS feature_daily (
  day       DATE   NOT NULL,
  connector TEXT   NOT NULL,
  name      TEXT   NOT NULL,
  users     INTEGER NOT NULL DEFAULT 0,
  count     BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, connector, name)
);

CREATE INDEX IF NOT EXISTS idx_feature_daily_day ON feature_daily (day DESC);

-- Recalcula el rollup de los ultimos N dias.
-- El corte de dia usa la zona horaria que se pasa como parametro, para que
-- "hoy" signifique lo mismo en el panel que en la cabeza del que lo mira.
CREATE OR REPLACE FUNCTION rebuild_feature_daily(days_back INTEGER, tz TEXT)
RETURNS INTEGER AS $$
DECLARE
  touched INTEGER;
BEGIN
  WITH agg AS (
    SELECT
      (e.ts AT TIME ZONE tz)::date        AS day,
      e.connector,
      e.name,
      COUNT(DISTINCT e.machine_id)::int   AS users,
      COUNT(*)::bigint                    AS count
    FROM events e
    WHERE e.ts >= NOW() - (days_back || ' days')::interval
    GROUP BY 1, 2, 3
  )
  INSERT INTO feature_daily (day, connector, name, users, count)
  SELECT day, connector, name, users, count FROM agg
  ON CONFLICT (day, connector, name) DO UPDATE
    SET users = EXCLUDED.users,
        count = EXCLUDED.count;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$$ LANGUAGE plpgsql;
