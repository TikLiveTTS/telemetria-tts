'use strict';

// Graficos de habitos, activacion y despliegue de versiones.

const { query } = require('../db');
const config = require('../config');

const TZ = config.tzDisplay;
const REAL_INSTALL = "machine_id NOT LIKE 'manual:%'";

// Dias sin abrir la app a partir de los cuales un usuario cuenta como perdido.
const CHURN_DAYS = 14;

// Duracion real de una sesion cerrada. Si el shutdown no llego, se usa el
// ultimo latido; las sesiones aun abiertas no cuentan (su duracion no es final).
const DURATION = `COALESCE(session_duration_minutes,
  GREATEST(0, EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)) / 60))`;
const CLOSED = `(ended_at IS NOT NULL OR last_heartbeat_at < NOW() - INTERVAL '15 minutes')`;

async function habits(days) {
  // ponytail: ventana movil de 30 dias por cada dia del periodo, O(dias x actividad); precalcular en rollup si crece.
  const weekly = days > 90;
  const [durations, hours, stickiness, churn, heatmap] = await Promise.all([
    query(
      `SELECT CASE WHEN d < 15 THEN '<15 min'
                   WHEN d < 60 THEN '15-60 min'
                   WHEN d < 180 THEN '1-3 h'
                   ELSE '>3 h' END AS bucket,
              COUNT(*)::int AS sessions
         FROM (SELECT ${DURATION} AS d FROM sessions
                WHERE ${CLOSED} AND started_at > NOW() - make_interval(days => $1::int)) s
        GROUP BY 1`,
      [days]
    ),
    query(
      `WITH d AS (
         SELECT generate_series(
           date_trunc($3, (NOW() AT TIME ZONE $2)::date - ($1::int - 1)),
           (NOW() AT TIME ZONE $2)::date::timestamp,
           make_interval(days => CASE WHEN $3 = 'week' THEN 7 ELSE 1 END)
         )::date AS day
       ), h AS (
         SELECT date_trunc($3, (started_at AT TIME ZONE $2)::date)::date AS day,
                ROUND(SUM(${DURATION}) / 60.0, 1)::float AS hours
           FROM sessions
          WHERE ${CLOSED} AND started_at > NOW() - make_interval(days => $1::int)
          GROUP BY 1
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(h.hours, 0) AS hours
         FROM d LEFT JOIN h USING (day) ORDER BY d.day`,
      [days, TZ, weekly ? 'week' : 'day']
    ),
    query(
      `WITH act AS (
         SELECT DISTINCT machine_id, (started_at AT TIME ZONE $2)::date AS day
           FROM sessions
          WHERE started_at > NOW() - make_interval(days => $1::int + 30)
       ), d AS (
         SELECT generate_series((NOW() AT TIME ZONE $2)::date - ($1::int - 1),
                                (NOW() AT TIME ZONE $2)::date, '1 day')::date AS day
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COUNT(DISTINCT a.machine_id) FILTER (WHERE a.day = d.day)::int AS dau,
              COUNT(DISTINCT a.machine_id) FILTER (WHERE a.day > d.day - 7)::int AS wau,
              COUNT(DISTINCT a.machine_id)::int AS mau
         FROM d
         LEFT JOIN act a ON a.day > d.day - 30 AND a.day <= d.day
        GROUP BY d.day ORDER BY d.day`,
      [days, TZ]
    ),
    // Perdido: su sesion fue seguida de >= CHURN_DAYS sin volver (o no volvio).
    // Recuperado: volvio tras un hueco de >= CHURN_DAYS. Se cuenta en la
    // semana de la ultima sesion y en la de la vuelta, respectivamente.
    query(
      `WITH s AS (
         SELECT machine_id, started_at,
                LAG(started_at)  OVER w AS prev_at,
                LEAD(started_at) OVER w AS next_at
           FROM sessions
          WHERE ${REAL_INSTALL}
         WINDOW w AS (PARTITION BY machine_id ORDER BY started_at)
       ), weeks AS (
         SELECT generate_series(
           date_trunc('week', (NOW() AT TIME ZONE $2)::date - ($1::int - 1)),
           date_trunc('week', (NOW() AT TIME ZONE $2)::date),
           '1 week'
         )::date AS week
       ), lost AS (
         SELECT date_trunc('week', (started_at AT TIME ZONE $2)::date)::date AS week,
                COUNT(DISTINCT machine_id)::int AS n
           FROM s
          WHERE COALESCE(next_at, NOW()) - started_at >= make_interval(days => $3::int)
          GROUP BY 1
       ), back AS (
         SELECT date_trunc('week', (started_at AT TIME ZONE $2)::date)::date AS week,
                COUNT(DISTINCT machine_id)::int AS n
           FROM s
          WHERE started_at - prev_at >= make_interval(days => $3::int)
          GROUP BY 1
       )
       SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
              COALESCE(l.n, 0) AS churned, COALESCE(b.n, 0) AS recovered
         FROM weeks w
         LEFT JOIN lost l USING (week)
         LEFT JOIN back b USING (week)
        ORDER BY w.week`,
      [days, TZ, CHURN_DAYS]
    ),
    // Usuarios con la app abierta en cada (dia de la semana, hora), en la hora
    // local del usuario. Cada sesion cuenta en todas las horas que cubrio.
    // ponytail: hora local aproximada por longitud (lon/15), sin horario de verano; usar zona IANA por pais si hace falta precision.
    query(
      `WITH s AS (
         SELECT machine_id,
                CASE WHEN lon IS NULL THEN started_at AT TIME ZONE $2
                     ELSE started_at AT TIME ZONE 'UTC' + make_interval(hours => ROUND(lon / 15)::int) END AS from_at,
                LEAST(EXTRACT(EPOCH FROM (COALESCE(ended_at, last_heartbeat_at, started_at) - started_at)), 12 * 3600) AS secs
           FROM sessions
          WHERE started_at > NOW() - make_interval(days => $1::int)
       ), h AS (
         SELECT machine_id,
                generate_series(date_trunc('hour', from_at), from_at + make_interval(secs => secs), '1 hour') AS at
           FROM s
       )
       SELECT EXTRACT(ISODOW FROM at)::int AS dow, EXTRACT(HOUR FROM at)::int AS hour,
              COUNT(DISTINCT machine_id)::int AS users
         FROM h GROUP BY 1, 2`,
      [days, TZ]
    ),
  ]);

  const order = ['<15 min', '15-60 min', '1-3 h', '>3 h'];
  const byBucket = new Map(durations.rows.map((r) => [r.bucket, r.sessions]));

  return {
    durations: order.map((bucket) => ({ bucket, sessions: byBucket.get(bucket) || 0 })),
    hours: { unit: weekly ? 'week' : 'day', rows: hours.rows },
    stickiness: stickiness.rows,
    churn: { days: CHURN_DAYS, rows: churn.rows },
    heatmap: heatmap.rows,
  };
}

async function activation(days) {
  const [firstUse, pareto] = await Promise.all([
    // Instalaciones nuevas del periodo: minutos desde que aparecio hasta la
    // primera conexion a una plataforma (el primer uso real de la app).
    query(
      `WITH n AS (
         SELECT i.machine_id,
                (SELECT MIN(e.ts) FROM events e
                  WHERE e.machine_id = i.machine_id
                    AND e.connector = 'platforms' AND e.name = 'connected') AS first_at,
                i.first_seen_at
           FROM installs i
          WHERE i.machine_id NOT LIKE 'manual:%'
            AND i.first_seen_at > NOW() - make_interval(days => $1::int)
       )
       SELECT bucket, COUNT(*)::int AS users,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY m) AS median_min
         FROM (SELECT m, CASE WHEN m IS NULL THEN 'Nunca'
                              WHEN m < 1 THEN '<1 min'
                              WHEN m < 5 THEN '1-5 min'
                              WHEN m < 15 THEN '5-15 min'
                              WHEN m < 60 THEN '15-60 min'
                              WHEN m < 1440 THEN '1-24 h'
                              ELSE '>1 dia' END AS bucket
                 FROM (SELECT GREATEST(0, EXTRACT(EPOCH FROM (first_at - first_seen_at)) / 60) AS m
                         FROM n) y) x
        GROUP BY ROLLUP (bucket)`,
      [days]
    ),
    // Curva de Pareto: % acumulado de horas aportado por el top X % de usuarios.
    query(
      `WITH u AS (
         SELECT machine_id, SUM(${DURATION}) AS mins
           FROM sessions
          WHERE ${REAL_INSTALL} AND ${CLOSED}
            AND started_at > NOW() - make_interval(days => $1::int)
          GROUP BY 1
         HAVING SUM(${DURATION}) > 0
       ), r AS (
         SELECT CEIL(100.0 * ROW_NUMBER() OVER (ORDER BY mins DESC) / COUNT(*) OVER ())::int AS pct_users,
                SUM(mins) OVER (ORDER BY mins DESC ROWS UNBOUNDED PRECEDING) / SUM(mins) OVER () AS share
           FROM u
       )
       SELECT pct_users, ROUND(100 * MAX(share), 1)::float AS pct_hours
         FROM r GROUP BY 1 ORDER BY 1`,
      [days]
    ),
  ]);

  const order = ['<1 min', '1-5 min', '5-15 min', '15-60 min', '1-24 h', '>1 dia', 'Nunca'];
  const total = firstUse.rows.find((r) => r.bucket === null);
  const byBucket = new Map(firstUse.rows.filter((r) => r.bucket !== null).map((r) => [r.bucket, r.users]));
  // Lo que aporta el top X %: el primer punto de la curva que llega a X.
  const share = (x) => pareto.rows.find((r) => r.pct_users >= x)?.pct_hours ?? null;

  return {
    first_use: {
      rows: order.map((bucket) => ({ bucket, users: byBucket.get(bucket) || 0 })),
      total: total ? total.users : 0,
      median_min: total && total.median_min !== null ? Math.round(total.median_min) : null,
    },
    pareto: { rows: pareto.rows, top10: share(10), top20: share(20) },
  };
}

// Usuarios activos por version y dia, mas las comprobaciones de actualizacion.
async function versionRollout(days) {
  const [series, checks] = await Promise.all([
    query(
      `SELECT to_char((started_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day,
              app_version, COUNT(DISTINCT machine_id)::int AS users
         FROM sessions
        WHERE app_version IS NOT NULL
          AND app_version NOT IN (SELECT app_version FROM hidden_versions)
          AND started_at > NOW() - make_interval(days => $1::int)
        GROUP BY 1, 2 ORDER BY 1`,
      [days, TZ]
    ),
    query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(count)::int AS checks
         FROM feature_daily
        WHERE connector = 'updates' AND name = 'check'
          AND day > (NOW() AT TIME ZONE $2)::date - $1::int
        GROUP BY 1 ORDER BY 1`,
      [days, TZ]
    ),
  ]);
  return { series: series.rows, checks: checks.rows };
}

// Todas las versiones vistas alguna vez, ocultas incluidas, para el pop-up
// de gestion de la pagina Versiones.
async function versionCatalog() {
  const { rows } = await query(
    `SELECT v.app_version,
            (SELECT COUNT(*) FROM installs i WHERE i.app_version = v.app_version AND i.${REAL_INSTALL})::int AS installs,
            v.sessions,
            v.last_seen,
            h.hidden_at
       FROM (SELECT app_version, COUNT(*)::int AS sessions, MAX(started_at) AS last_seen
               FROM sessions WHERE app_version IS NOT NULL GROUP BY 1) v
       LEFT JOIN hidden_versions h USING (app_version)
      ORDER BY v.last_seen DESC`
  );
  return rows;
}

async function setVersionHidden(version, hidden) {
  await query(
    hidden
      ? 'INSERT INTO hidden_versions (app_version) VALUES ($1) ON CONFLICT DO NOTHING'
      : 'DELETE FROM hidden_versions WHERE app_version = $1',
    [version]
  );
  return { ok: true };
}

module.exports = { habits, activation, versionRollout, versionCatalog, setVersionHidden };
