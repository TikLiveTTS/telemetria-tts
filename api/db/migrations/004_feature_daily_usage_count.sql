-- Cuenta los usos agregados en props.count, no solo las filas de events.
CREATE OR REPLACE FUNCTION rebuild_feature_daily(days_back INTEGER, tz TEXT)
RETURNS INTEGER AS $$
DECLARE
  touched INTEGER;
BEGIN
  WITH agg AS (
    SELECT
      (e.ts AT TIME ZONE tz)::date                              AS day,
      e.connector,
      e.name,
      COUNT(DISTINCT e.machine_id)::int                         AS users,
      SUM(COALESCE((e.props->>'count')::bigint, 1))::bigint     AS count
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
