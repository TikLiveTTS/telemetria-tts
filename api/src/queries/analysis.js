'use strict';

// Tabla para analisis (humano o IA): una fila por instalacion real con metricas
// ya calculadas, en vez de miles de sesiones sueltas. Sin IP, sin coordenadas,
// sin machine_id ni @ de canales: la clave es el user_id seudonimo.
// ponytail: recorre sessions completa y events de 90 dias; es una descarga
// puntual. Si events crece mucho, leer de feature_daily o cachear con memo.

const { query } = require('../db');
const config = require('../config');

const CHURN_DAYS = 14;

// Duracion real de una sesion cerrada (igual que insights.js).
const DUR = `COALESCE(session_duration_minutes,
  GREATEST(0, EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)) / 60))`;

async function analysisRows() {
  const { rows } = await query(
    `WITH i AS (
       SELECT * FROM installs WHERE machine_id NOT LIKE 'manual:%'
     ), ses AS (
       SELECT machine_id, started_at, platforms_used,
              ${DUR} AS dur,
              (ended_at IS NOT NULL OR last_heartbeat_at < NOW() - INTERVAL '15 minutes') AS closed,
              (started_at AT TIME ZONE $1)::date AS day,
              -- hora local aproximada por longitud (lon/15), sin horario de verano
              CASE WHEN lon IS NULL THEN started_at AT TIME ZONE $1
                   ELSE started_at AT TIME ZONE 'UTC' + make_interval(hours => ROUND(lon / 15)::int) END AS local_at
         FROM sessions
     ), usage AS (
       SELECT machine_id,
              COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days')::int  AS sessions_7d,
              COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '30 days')::int AS sessions_30d,
              COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '90 days')::int AS sessions_90d,
              ROUND((SUM(dur) FILTER (WHERE closed AND started_at > NOW() - INTERVAL '30 days'))::numeric, 0) AS minutes_30d,
              ROUND((AVG(dur) FILTER (WHERE closed))::numeric, 1) AS avg_session_min,
              ROUND((MAX(dur) FILTER (WHERE closed))::numeric, 0) AS max_session_min,
              COUNT(DISTINCT day)::int AS active_days,
              COUNT(DISTINCT day) FILTER (WHERE started_at > NOW() - INTERVAL '30 days')::int AS active_days_30d,
              MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM local_at))::int  AS peak_hour_local,
              MODE() WITHIN GROUP (ORDER BY EXTRACT(ISODOW FROM local_at))::int AS peak_weekday_1mon,
              ROUND(100.0 * COUNT(*) FILTER (WHERE EXTRACT(ISODOW FROM local_at) >= 6) / COUNT(*))::int AS weekend_sessions_pct
         FROM ses GROUP BY 1
     ), back AS (
       -- Volvio tras el dia de instalacion: dia siguiente, primera semana, primer mes.
       SELECT i.machine_id,
              BOOL_OR(s.day - (i.first_seen_at AT TIME ZONE $1)::date = 1) AS returned_next_day,
              BOOL_OR(s.day - (i.first_seen_at AT TIME ZONE $1)::date BETWEEN 1 AND 7)  AS returned_within_7d,
              BOOL_OR(s.day - (i.first_seen_at AT TIME ZONE $1)::date BETWEEN 1 AND 30) AS returned_within_30d
         FROM i JOIN ses s USING (machine_id) GROUP BY 1
     ), plat AS (
       SELECT machine_id, string_agg(DISTINCT p, '|' ORDER BY p) AS platforms_used, COUNT(DISTINCT p)::int AS n_platforms
         FROM ses, LATERAL unnest(platforms_used) AS p GROUP BY 1
     ), ev AS (
       SELECT machine_id, COUNT(*)::int AS events_90d, COUNT(DISTINCT connector || '.' || name)::int AS distinct_features_90d
         FROM events WHERE ts > NOW() - INTERVAL '90 days' GROUP BY 1
     ), top AS (
       SELECT machine_id, string_agg(f || ':' || n, '|' ORDER BY n DESC, f) AS top_features_90d
         FROM (SELECT machine_id, connector || '.' || name AS f, COUNT(*) AS n,
                      ROW_NUMBER() OVER (PARTITION BY machine_id ORDER BY COUNT(*) DESC, connector || '.' || name) AS rn
                 FROM events WHERE ts > NOW() - INTERVAL '90 days' GROUP BY machine_id, connector, name) x
        WHERE rn <= 5 GROUP BY 1
     ), conn AS (
       SELECT machine_id, MIN(ts) AS first_connect_at
         FROM events WHERE connector = 'platforms' AND name = 'connected' GROUP BY 1
     ), cr AS (
       SELECT user_id, COUNT(*)::int AS n_channels, string_agg(DISTINCT platform, '|' ORDER BY platform) AS channel_platforms,
              MAX(follower_count) AS max_followers, BOOL_OR(is_public) AS is_public_creator
         FROM creators WHERE user_id IS NOT NULL AND NOT is_hidden GROUP BY 1
     )
     SELECT COALESCE(i.user_id, md5(i.machine_id)) AS id,
            to_char(i.first_seen_at AT TIME ZONE $1, 'YYYY-MM-DD') AS first_seen_date,
            to_char(i.last_seen_at  AT TIME ZONE $1, 'YYYY-MM-DD') AS last_seen_date,
            (NOW() AT TIME ZONE $1)::date - (i.first_seen_at AT TIME ZONE $1)::date AS age_days,
            (NOW() AT TIME ZONE $1)::date - (i.last_seen_at  AT TIME ZONE $1)::date AS days_since_last_seen,
            CASE WHEN NOW() - i.last_seen_at <= INTERVAL '7 days' THEN 'activo'
                 WHEN NOW() - i.last_seen_at <  make_interval(days => $2::int) THEN 'enfriandose'
                 ELSE 'perdido' END AS status,
            i.app_version, i.os_platform, i.os_release, i.os_arch, i.locale,
            i.country_code, i.country, i.city,
            i.total_sessions, i.total_minutes,
            COALESCE(u.sessions_7d, 0) AS sessions_7d, COALESCE(u.sessions_30d, 0) AS sessions_30d,
            COALESCE(u.sessions_90d, 0) AS sessions_90d, u.minutes_30d,
            u.avg_session_min, u.max_session_min,
            COALESCE(u.active_days, 0) AS active_days, COALESCE(u.active_days_30d, 0) AS active_days_30d,
            u.peak_hour_local, u.peak_weekday_1mon, u.weekend_sessions_pct,
            COALESCE(b.returned_next_day, FALSE) AS returned_next_day,
            COALESCE(b.returned_within_7d, FALSE) AS returned_within_7d,
            COALESCE(b.returned_within_30d, FALSE) AS returned_within_30d,
            ROUND((GREATEST(0, EXTRACT(EPOCH FROM (c.first_connect_at - i.first_seen_at)) / 60))::numeric, 1) AS minutes_to_first_connect,
            p.platforms_used, COALESCE(p.n_platforms, 0) AS n_platforms,
            COALESCE(e.events_90d, 0) AS events_90d, COALESCE(e.distinct_features_90d, 0) AS distinct_features_90d,
            t.top_features_90d,
            COALESCE(cr.n_channels, 0) AS n_channels, cr.channel_platforms, cr.max_followers,
            COALESCE(cr.is_public_creator, FALSE) AS is_public_creator
       FROM i
       LEFT JOIN usage u USING (machine_id)
       LEFT JOIN back b USING (machine_id)
       LEFT JOIN plat p USING (machine_id)
       LEFT JOIN ev e USING (machine_id)
       LEFT JOIN top t USING (machine_id)
       LEFT JOIN conn c USING (machine_id)
       LEFT JOIN cr ON cr.user_id = i.user_id
      ORDER BY i.first_seen_at`,
    [config.tzDisplay, CHURN_DAYS]
  );
  return rows;
}

module.exports = { analysisRows, CHURN_DAYS };
