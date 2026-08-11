'use strict';

const { query } = require('../db');
const config = require('../config');

const TZ = config.tzDisplay;

// KPIs de cabecera. `prev_*` permite mostrar el delta contra el periodo
// anterior de la misma longitud.
async function summary(days) {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*) FROM installs)::int AS total_installs,
       (SELECT COUNT(*) FROM sessions
         WHERE last_heartbeat_at > NOW() - INTERVAL '5 minutes')::int AS active_now,
       (SELECT COUNT(DISTINCT machine_id) FROM sessions
         WHERE (started_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date)::int AS active_today,
       (SELECT COUNT(DISTINCT machine_id) FROM sessions
         WHERE started_at > NOW() - make_interval(days => $1::int))::int AS active_period,
       (SELECT COUNT(*) FROM installs
         WHERE (first_seen_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date)::int AS new_today,
       (SELECT COUNT(*) FROM installs
         WHERE first_seen_at > NOW() - make_interval(days => $1::int))::int AS new_period,
       (SELECT COUNT(*) FROM installs
         WHERE first_seen_at > NOW() - make_interval(days => $1::int * 2)
           AND first_seen_at <= NOW() - make_interval(days => $1::int))::int AS new_prev_period,
       (SELECT COUNT(DISTINCT machine_id) FROM sessions
         WHERE started_at > NOW() - make_interval(days => $1::int * 2)
           AND started_at <= NOW() - make_interval(days => $1::int))::int AS active_prev_period,
       (SELECT ROUND(AVG(session_duration_minutes)::numeric, 1) FROM sessions
         WHERE session_duration_minutes IS NOT NULL
           AND started_at > NOW() - make_interval(days => $1::int)) AS avg_session_min,
       (SELECT COUNT(*) FROM creators WHERE NOT is_hidden)::int AS creators_total,
       (SELECT COUNT(*) FROM creators WHERE is_public AND NOT is_hidden)::int AS creators_public`,
    [days, TZ]
  );
  return rows[0];
}

// Serie diaria: sesiones, usuarios unicos e instalaciones nuevas.
// generate_series rellena los dias sin datos, para que la linea no mienta
// saltandose huecos.
async function daily(days) {
  const { rows } = await query(
    `WITH d AS (
       SELECT generate_series(
         (NOW() AT TIME ZONE $2)::date - ($1::int - 1),
         (NOW() AT TIME ZONE $2)::date,
         '1 day'::interval
       )::date AS day
     ),
     s AS (
       SELECT (started_at AT TIME ZONE $2)::date AS day,
              COUNT(*)::int AS sessions,
              COUNT(DISTINCT machine_id)::int AS users
         FROM sessions
        WHERE started_at > NOW() - make_interval(days => $1::int)
        GROUP BY 1
     ),
     n AS (
       SELECT (first_seen_at AT TIME ZONE $2)::date AS day, COUNT(*)::int AS installs
         FROM installs
        WHERE first_seen_at > NOW() - make_interval(days => $1::int)
        GROUP BY 1
     )
     SELECT d.day,
            COALESCE(s.sessions, 0) AS sessions,
            COALESCE(s.users, 0)    AS users,
            COALESCE(n.installs, 0) AS installs
       FROM d LEFT JOIN s USING (day) LEFT JOIN n USING (day)
      ORDER BY d.day`,
    [days, TZ]
  );
  return rows;
}

// Cohortes semanales: de los que instalaron esa semana, cuantos volvieron.
async function retention() {
  const { rows } = await query(
    `WITH cohort AS (
       SELECT machine_id, (first_seen_at AT TIME ZONE $1)::date AS c_day
         FROM installs
        WHERE first_seen_at > NOW() - INTERVAL '90 days'
     ),
     act AS (
       SELECT DISTINCT machine_id, (started_at AT TIME ZONE $1)::date AS a_day
         FROM sessions
     ),
     ret AS (
       SELECT c.machine_id,
              c.c_day,
              bool_or(a.a_day = c.c_day + 1)                        AS d1,
              bool_or(a.a_day BETWEEN c.c_day + 1 AND c.c_day + 7)  AS d7,
              bool_or(a.a_day BETWEEN c.c_day + 1 AND c.c_day + 30) AS d30
         FROM cohort c
         LEFT JOIN act a ON a.machine_id = c.machine_id
        GROUP BY 1, 2
     )
     SELECT date_trunc('week', c_day)::date AS week,
            COUNT(*)::int AS users,
            ROUND(100.0 * COUNT(*) FILTER (WHERE d1)  / NULLIF(COUNT(*), 0), 1) AS d1,
            ROUND(100.0 * COUNT(*) FILTER (WHERE d7)  / NULLIF(COUNT(*), 0), 1) AS d7,
            ROUND(100.0 * COUNT(*) FILTER (WHERE d30) / NULLIF(COUNT(*), 0), 1) AS d30
       FROM ret
      GROUP BY 1
      ORDER BY 1`,
    [TZ]
  );
  return rows;
}

async function countries(limit = 10) {
  const { rows } = await query(
    `SELECT country, country_code,
            COUNT(*)::int AS users,
            SUM(total_sessions)::int AS sessions,
            SUM(total_minutes)::int AS minutes
       FROM installs
      WHERE country IS NOT NULL
      GROUP BY 1, 2
      ORDER BY users DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// Puntos del mapa: solo instalaciones con heartbeat reciente. Tambien
// compara contra la ventana de 5 minutos anterior, para la tendencia de la
// tarjeta "Usuarios activos" (variacion real, no inventada).
async function liveMap() {
  const [{ rows: points }, { rows: counts }] = await Promise.all([
    query(
      `SELECT s.lat, s.lon, s.city, s.country, s.country_code
         FROM sessions s
        WHERE s.last_heartbeat_at > NOW() - INTERVAL '5 minutes'
          AND s.lat IS NOT NULL AND s.lon IS NOT NULL`
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '5 minutes')::int AS now,
         COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '10 minutes'
                             AND last_heartbeat_at <= NOW() - INTERVAL '5 minutes')::int AS prev
         FROM sessions`
    ),
  ]);

  const { now, prev } = counts[0];
  const trendPct = prev > 0 ? Math.round(((now - prev) / prev) * 100) : null;
  return { points, count: now, trendPct };
}

async function versions() {
  const { rows } = await query(
    `SELECT app_version,
            COUNT(*)::int AS users,
            ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct,
            MAX(last_seen_at) AS last_seen
       FROM installs
      WHERE app_version IS NOT NULL
      GROUP BY 1
      ORDER BY users DESC`
  );
  return rows;
}

// Uso por conector, leido del rollup diario. `pct_users` se calcula sobre los
// usuarios activos del periodo, no sobre el total de instalaciones, para no
// diluir la cifra con gente que hace meses que no abre la app.
async function features(days) {
  const { rows } = await query(
    `WITH base AS (
       SELECT GREATEST(COUNT(DISTINCT machine_id), 1)::int AS active
         FROM sessions
        WHERE started_at > NOW() - make_interval(days => $1::int)
     )
     SELECT f.connector,
            f.name,
            SUM(f.count)::bigint AS count,
            MAX(f.users)::int    AS users,
            ROUND(100.0 * MAX(f.users) / (SELECT active FROM base), 1) AS pct_users
       FROM feature_daily f
      WHERE f.day > (NOW() AT TIME ZONE $2)::date - $1::int
      GROUP BY 1, 2
      ORDER BY count DESC`,
    [days, TZ]
  );
  return rows;
}

// Serie diaria de un conector concreto, para la ficha de detalle.
async function featureDetail(connector, days) {
  const { rows } = await query(
    `SELECT day, name, users, count
       FROM feature_daily
      WHERE connector = $1
        AND day > (NOW() AT TIME ZONE $3)::date - $2::int
      ORDER BY day`,
    [connector, days, TZ]
  );
  return rows;
}

async function sessions({ page = 1, pageSize = 50, platform, country, version, q }) {
  const where = [];
  const params = [];

  if (platform) { params.push(platform); where.push(`$${params.length} = ANY(s.platforms_used)`); }
  if (country)  { params.push(country);  where.push(`s.country_code = $${params.length}`); }
  if (version)  { params.push(version);  where.push(`s.app_version = $${params.length}`); }
  if (q)        { params.push(`%${q}%`); where.push(`(s.machine_id ILIKE $${params.length} OR i.user_id ILIKE $${params.length})`); }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(pageSize, (page - 1) * pageSize);

  const { rows } = await query(
    `SELECT s.session_id, s.machine_id, i.user_id, s.app_version,
            s.country, s.country_code, s.city, s.platforms_used,
            s.started_at, s.ended_at, s.last_heartbeat_at,
            s.session_duration_minutes, s.first_seen,
            COUNT(*) OVER ()::int AS total_rows
       FROM sessions s
       LEFT JOIN installs i ON i.machine_id = s.machine_id
       ${clause}
      ORDER BY s.started_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = rows.length ? rows[0].total_rows : 0;
  return { total, page, pageSize, rows: rows.map(({ total_rows, ...r }) => r) };
}

// Timeline de una sesion concreta (fila expandible).
async function sessionEvents(sessionId, limit = 500) {
  const { rows } = await query(
    `SELECT connector, name, props, ts
       FROM events
      WHERE session_id = $1
      ORDER BY ts
      LIMIT $2`,
    [sessionId, limit]
  );
  return rows;
}

// Errores agrupados por firma.
async function errors(days, limit = 100) {
  const { rows } = await query(
    `SELECT signature,
            MIN(where_at) AS where_at,
            (array_agg(message ORDER BY ts DESC))[1] AS message,
            (array_agg(stack   ORDER BY ts DESC))[1] AS stack,
            COUNT(*)::int AS occurrences,
            COUNT(DISTINCT machine_id)::int AS machines,
            array_agg(DISTINCT app_version) AS versions,
            MIN(ts) AS first_seen,
            MAX(ts) AS last_seen
       FROM app_errors
      WHERE ts > NOW() - make_interval(days => $1::int)
      GROUP BY signature
      ORDER BY occurrences DESC
      LIMIT $2`,
    [days, limit]
  );
  return rows;
}

// Mix de plataformas: % de sesiones del periodo en que aparece cada una.
async function platformMix(days) {
  const { rows } = await query(
    `WITH base AS (
       SELECT GREATEST(COUNT(*), 1)::int AS total
         FROM sessions
        WHERE started_at > NOW() - make_interval(days => $1::int)
     )
     SELECT p AS platform,
            COUNT(*)::int AS sessions,
            ROUND(100.0 * COUNT(*) / (SELECT total FROM base), 1) AS pct
       FROM sessions s, unnest(s.platforms_used) AS p
      WHERE s.started_at > NOW() - make_interval(days => $1::int)
      GROUP BY 1
      ORDER BY sessions DESC`,
    [days]
  );
  return rows;
}

// Estado interno que se muestra en la pagina Ajustes.
async function systemStatus() {
  const { rows } = await query(
    `SELECT
       (SELECT pg_size_pretty(pg_database_size(current_database()))) AS db_size,
       (SELECT COUNT(*) FROM events)::bigint       AS events_rows,
       (SELECT COUNT(*) FROM sessions)::bigint     AS sessions_rows,
       (SELECT COUNT(*) FROM installs)::bigint     AS installs_rows,
       (SELECT COUNT(*) FROM creators)::bigint     AS creators_rows,
       (SELECT MIN(ts) FROM events)                AS oldest_event,
       (SELECT MAX(day) FROM feature_daily)        AS rollup_last_day`
  );
  return rows[0];
}

module.exports = {
  summary, daily, retention, countries, liveMap, versions,
  features, featureDetail, sessions, sessionEvents, errors,
  platformMix, systemStatus,
};
