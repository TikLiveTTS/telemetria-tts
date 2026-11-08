'use strict';

const { query } = require('../db');
const config = require('../config');

const TZ = config.tzDisplay;
const REAL_INSTALL = "machine_id NOT LIKE 'manual:%'";

// Unica definicion de "app abierta" que comparten /summary, /geo/live y
// /sessions. Es presencia del proceso, no una transmision en vivo: el emisor
// aun no manda una senal LIVE verificada.
const APP_OPEN = `(ended_at IS NULL AND received_at > NOW() - INTERVAL '5 minutes')`;
const CONNECTED = `(ended_at IS NULL AND live_heartbeat_at > NOW() - INTERVAL '150 seconds')`;

// "En live" de verdad: conectada a su plataforma Y con actividad reciente. Una
// app que sigue conectada pero lleva LIVE_IDLE_MIN minutos sin actividad es
// 'idle' (probable olvido de desconectar). Estados de una sesion:
//   live   conectada y con senal reciente (o sin ninguna senal registrada: se
//          le da el beneficio de la duda, no se puede saber)
//   idle   conectada pero sin senal en LIVE_IDLE_MIN minutos
//   open   app abierta sin conexion a plataforma
//   closed cerrada o abandonada
// Senal = ultima actividad real del TTS o ultima conexion a una plataforma.
const IDLE_MIN = config.liveIdleMin;
const ACTIVITY = [
  'tts.spoken', 'tts.skipped', 'tts.rate_limited',
  'music.request', 'music.skip', 'soundpad.triggered', 'moderation.message_filtered',
];
const ACTIVITY_PAIRS = ACTIVITY.map((a) => `('${a.split('.')[0]}','${a.split('.')[1]}')`).join(',');
const LAST_SIGNAL = `GREATEST(
  (SELECT e.ts FROM events e WHERE e.session_id = s.session_id
      AND (e.connector, e.name) IN (${ACTIVITY_PAIRS}) ORDER BY e.ts DESC LIMIT 1),
  (SELECT e.ts FROM events e WHERE e.session_id = s.session_id
      AND e.connector = 'platforms' AND e.name = 'connected' ORDER BY e.ts DESC LIMIT 1))`;
// La senal solo se busca para sesiones conectadas (decenas): el CASE evita
// consultar events de las demas. Requiere la tabla de sesiones con alias `s`.
const SIGNAL_JOIN = `LEFT JOIN LATERAL (SELECT CASE WHEN ${CONNECTED} THEN ${LAST_SIGNAL} END AS sig) g ON TRUE`;
const LIVE_STATE = `(CASE
  WHEN ${CONNECTED} THEN
    CASE WHEN g.sig IS NULL OR g.sig > NOW() - INTERVAL '${IDLE_MIN} minutes' THEN 'live' ELSE 'idle' END
  WHEN ${APP_OPEN} THEN 'open'
  ELSE 'closed' END)`;

// KPIs de cabecera. `prev_*` permite mostrar el delta contra el periodo
// anterior de la misma longitud.
async function summary(days) {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*) FROM installs WHERE ${REAL_INSTALL})::int AS total_installs,
       (SELECT COUNT(*) FROM sessions WHERE ${APP_OPEN})::int AS active_now,
       (SELECT COUNT(*) FROM sessions WHERE ${CONNECTED})::int AS connected_now,
       (SELECT COUNT(DISTINCT machine_id) FROM sessions
         WHERE (started_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date)::int AS active_today,
       (SELECT COUNT(DISTINCT machine_id) FROM sessions
         WHERE started_at > NOW() - make_interval(days => $1::int))::int AS active_period,
       (SELECT COUNT(*) FROM installs
         WHERE ${REAL_INSTALL}
           AND (first_seen_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date)::int AS new_today,
       (SELECT COUNT(*) FROM installs
         WHERE ${REAL_INSTALL}
           AND first_seen_at > NOW() - make_interval(days => $1::int))::int AS new_period,
       (SELECT COUNT(*) FROM installs
         WHERE ${REAL_INSTALL}
           AND first_seen_at > NOW() - make_interval(days => $1::int * 2)
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
  const live = await liveCounts();
  return { ...rows[0], ...live, live_idle_min: IDLE_MIN };
}

// Sesiones sin cerrar por estado (en live / conectadas sin actividad / abiertas).
async function liveCounts() {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE st = 'live')::int AS live_now,
            COUNT(*) FILTER (WHERE st = 'idle')::int AS idle_now
       FROM (SELECT ${LIVE_STATE} AS st
               FROM sessions s ${SIGNAL_JOIN}
              WHERE s.ended_at IS NULL) t`
  );
  return rows[0];
}

// Serie diaria: sesiones, usuarios unicos e instalaciones nuevas.
// generate_series rellena los dias sin datos, para que la linea no mienta
// saltandose huecos.
async function daily(days, unit = 'day') {
  // unit se valida en la ruta; aqui solo llega day | week | month.
  const step = `1 ${unit}`;
  const { rows } = await query(
    `WITH d AS (
       SELECT generate_series(
         date_trunc($3, (NOW() AT TIME ZONE $2)::date - ($1::int - 1))::date,
         (NOW() AT TIME ZONE $2)::date,
         $4::interval
       )::date AS day
     ),
     s AS (
       SELECT date_trunc($3, (started_at AT TIME ZONE $2)::date)::date AS day,
              COUNT(*)::int AS sessions,
              COUNT(DISTINCT machine_id)::int AS users
         FROM sessions
        WHERE started_at > NOW() - make_interval(days => $1::int)
        GROUP BY 1
     ),
     n AS (
       SELECT date_trunc($3, (first_seen_at AT TIME ZONE $2)::date)::date AS day, COUNT(*)::int AS installs
         FROM installs
        WHERE ${REAL_INSTALL}
          AND first_seen_at > NOW() - make_interval(days => $1::int)
        GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(s.sessions, 0) AS sessions,
            COALESCE(s.users, 0)    AS users,
            COALESCE(n.installs, 0) AS installs
       FROM d LEFT JOIN s USING (day) LEFT JOIN n USING (day)
      ORDER BY d.day`,
    [days, TZ, unit, step]
  );
  return rows;
}

// Cohortes semanales: de los que instalaron esa semana, cuantos volvieron.
async function retention() {
  const { rows } = await query(
    `WITH cohort AS (
       SELECT machine_id, (first_seen_at AT TIME ZONE $1)::date AS c_day
         FROM installs
        WHERE ${REAL_INSTALL}
          AND first_seen_at > NOW() - INTERVAL '90 days'
     ),
     act AS (
       SELECT DISTINCT machine_id, (started_at AT TIME ZONE $1)::date AS a_day
         FROM sessions
        WHERE started_at > NOW() - INTERVAL '90 days'
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

// Filtro de tiempo opcional para los mapas: `days` > 0 acota por fecha de
// instalacion (by = 'first') o por ultima vez vista (by = 'last').
function periodClause({ days, by } = {}, params) {
  if (!days) return '';
  params.push(days);
  return ` AND ${by === 'last' ? 'last_seen_at' : 'first_seen_at'} > NOW() - make_interval(days => $${params.length}::int)`;
}

async function countries(limit = 10, period = {}) {
  const params = [limit];
  const { rows } = await query(
    `SELECT MAX(country) AS country, country_code,
            COUNT(*)::int AS installs,
            SUM(total_sessions)::int AS sessions,
            SUM(total_minutes)::int AS minutes
       FROM installs
      WHERE ${REAL_INSTALL}
        AND country IS NOT NULL${periodClause(period, params)}
      GROUP BY country_code
      ORDER BY installs DESC
      LIMIT $1`,
    params
  );
  return rows;
}

// user_id de los usuarios EN LIVE ahora mismo (misma definicion que el mapa).
async function liveUserIds() {
  const { rows } = await query(
    `WITH x AS (
       SELECT s.machine_id, ${LIVE_STATE} AS st
         FROM sessions s ${SIGNAL_JOIN}
        WHERE s.ended_at IS NULL AND ${CONNECTED}
     ) SELECT DISTINCT i.user_id FROM x JOIN installs i ON i.machine_id = x.machine_id
        WHERE x.st = 'live' AND i.user_id IS NOT NULL`
  );
  return new Set(rows.map((r) => String(r.user_id)));
}

// Puntos del mapa: solo usuarios EN LIVE (conectados a su plataforma y con
// actividad reciente). `count` coincide con los puntos; `without_geo` son los
// que estan en live pero no se pueden dibujar. `idle` y `open` cuentan las
// conectadas sin actividad y las apps abiertas sin conexion: se ven en Sesiones.
async function liveMap() {
  const { rows } = await query(
    `SELECT s.machine_id, s.lat, s.lon, s.city, s.country, s.country_code,
            ${LIVE_STATE} AS st
       FROM sessions s ${SIGNAL_JOIN}
      WHERE s.ended_at IS NULL AND (${APP_OPEN} OR ${CONNECTED})`
  );

  const live = rows.filter((r) => r.st === 'live');
  const hasGeo = (r) => r.lat !== null && r.lon !== null;
  return {
    points: live.filter(hasGeo).map(({ st, ...p }) => p),
    // Solo se dibujan si el usuario activa el filtro en el mapa.
    other_points: rows.filter((r) => r.st !== 'live' && hasGeo(r)),
    count: live.filter(hasGeo).length,
    without_geo: live.filter((r) => !hasGeo(r)).length,
    idle: rows.filter((r) => r.st === 'idle').length,
    open: rows.filter((r) => r.st === 'open').length,
    idle_min: IDLE_MIN,
  };
}

// Una instalacion = un punto, en la ultima ubicacion conocida (la misma que
// usan los puntos en vivo). Para el mapa de instalaciones.
async function installPoints(period = {}) {
  const params = [];
  const { rows } = await query(
    `SELECT machine_id, lat, lon, city, country, country_code
       FROM installs
      WHERE ${REAL_INSTALL} AND lat IS NOT NULL AND lon IS NOT NULL${periodClause(period, params)}`,
    params
  );
  return rows;
}

// Historial del mapa: sesiones con ubicacion que estuvieron abiertas en los
// ultimos `days` dias. Fin = cierre o ultimo latido; el cliente decide que
// puntos pintar en cada instante. Sale de `sessions`, no hace falta tabla aparte.
// ponytail: tope de 100k sesiones (~10 MB); agregar en el servidor si se llega.
async function geoHistory(days = 2) {
  const { rows } = await query(
    `SELECT s.machine_id, s.lat, s.lon, s.city, s.country, s.country_code,
            s.started_at AS start, COALESCE(s.ended_at, s.received_at) AS end
       FROM sessions s
      WHERE COALESCE(s.ended_at, s.received_at) > NOW() - make_interval(days => $1::int)
        AND s.lat IS NOT NULL AND s.lon IS NOT NULL
      ORDER BY s.started_at DESC
      LIMIT 100000`,
    [days]
  );
  return rows;
}

// Solo maquinas vistas en el periodo: cada install guarda su version ACTUAL,
// pero quien dejo la app se queda para siempre en la vieja e inflaria esas filas.
async function versions(days) {
  const { rows } = await query(
    `SELECT app_version,
            COUNT(*)::int AS users,
            ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct,
            MAX(last_seen_at) AS last_seen
       FROM installs
      WHERE ${REAL_INSTALL}
        AND app_version IS NOT NULL
        AND app_version NOT IN (SELECT app_version FROM hidden_versions)
        AND last_seen_at > NOW() - make_interval(days => $1::int)
      GROUP BY 1
      ORDER BY users DESC`,
    [days]
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

// Orden de la tabla de Sesiones. Version: "1.10.0" > "1.9.0" comparando los
// numeros como array de enteros, no como texto.
const SESSION_SORTS = {
  started: 's.started_at',
  sessions: 's.session_count',
  duration: 's.session_duration_minutes',
  // Live > conectada sin actividad > app abierta > resto (cerrada / sin cierre).
  status: `CASE ${LIVE_STATE} WHEN 'live' THEN 3 WHEN 'idle' THEN 2 WHEN 'open' THEN 1 ELSE 0 END`,
  version: `(SELECT array_agg(m[1]::int ORDER BY n)
               FROM regexp_matches(s.app_version, '[0-9]+', 'g') WITH ORDINALITY AS t(m, n))`,
};

// Por defecto una fila por usuario (su ultima sesion + cuantas lleva). Con
// `machine` se listan todas las sesiones de ese usuario.
async function sessions({ page = 1, pageSize = 50, platform, country, version, q, machine, live, sort, dir }) {
  const where = [];
  const params = [];

  if (machine)  { params.push(machine);  where.push(`s.machine_id = $${params.length}`); }
  if (platform) { params.push(platform); where.push(`$${params.length} = ANY(s.platforms_used)`); }
  if (country)  { params.push(country);  where.push(`s.country_code = $${params.length}`); }
  if (version)  { params.push(version);  where.push(`s.app_version = $${params.length}`); }
  if (q)        { params.push(`%${q}%`); where.push(`(s.machine_id ILIKE $${params.length} OR i.user_id ILIKE $${params.length})`); }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const picked = machine
    ? 'SELECT * FROM base'
    : 'SELECT DISTINCT ON (machine_id) * FROM base ORDER BY machine_id, started_at DESC';
  // El filtro live mira la ultima sesion del usuario (la que se muestra).
  // live: live | idle | open | closed ('1' y '0' siguen valiendo: en live / no en live).
  const liveClause = ['live', 'idle', 'open', 'closed'].includes(live) ? `WHERE ${LIVE_STATE} = '${live}'`
    : live === '1' ? `WHERE ${LIVE_STATE} = 'live'`
      : live === '0' ? `WHERE ${LIVE_STATE} <> 'live'` : '';
  const order = `${SESSION_SORTS[sort] || SESSION_SORTS.started} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, s.started_at DESC`;
  params.push(pageSize, (page - 1) * pageSize);

  const { rows } = await query(
    `WITH base AS (
       SELECT s.*, i.user_id, COUNT(*) OVER (PARTITION BY s.machine_id)::int AS session_count
         FROM sessions s
         LEFT JOIN installs i ON i.machine_id = s.machine_id
         ${clause}
     ), picked AS (${picked})
     SELECT s.session_id, s.machine_id, s.user_id, s.app_version,
            s.country, s.country_code, s.city, s.platforms_used,
            s.started_at, s.ended_at, s.last_heartbeat_at,
            s.session_duration_minutes, s.first_seen, s.session_count,
            c.id AS creator_id, c.username AS creator_username, c.avatar_url AS creator_avatar_url,
            c.has_avatar AS creator_has_avatar, c.avatar_v AS creator_avatar_v,
            c.channel_url AS creator_channel_url,
            ${APP_OPEN} AS app_open,
            ${CONNECTED} AS connected,
            ${LIVE_STATE} AS live_state,
            COUNT(*) OVER ()::int AS total_rows
       FROM picked s
       -- Una sesion no guarda su canal: se muestra el canal mas reciente del usuario.
       LEFT JOIN LATERAL (
         SELECT cr.id, cr.username, cr.avatar_url, cr.channel_url,
                (av.file IS NOT NULL) AS has_avatar, EXTRACT(EPOCH FROM av.fetched_at)::bigint AS avatar_v
           FROM creators cr
           LEFT JOIN creator_avatars av ON av.creator_id = cr.id
          WHERE cr.user_id = s.user_id AND NOT cr.is_hidden
          ORDER BY cr.last_seen_at DESC, cr.id DESC
          LIMIT 1
       ) c ON TRUE
      ${SIGNAL_JOIN}
      ${liveClause}
      ORDER BY ${order}
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

// Ficha de una instalacion (clic en un punto del mapa). Sin IP ni palabras
// bloqueadas: esas solo se muestran agregadas.
async function installProfile(machineId) {
  const { rows } = await query(
    `SELECT machine_id, user_id, first_seen_at, last_seen_at, app_version, os_platform,
            os_release, locale, country, country_code, city, total_sessions, total_minutes
       FROM installs WHERE machine_id = $1`,
    [machineId]
  );
  if (!rows.length) return null;
  const install = rows[0];

  const [{ rows: creators }, { rows: recent }, { rows: platforms }, { rows: features }] = await Promise.all([
    query(
      `SELECT c.id, c.platform, c.username, c.display_name, c.channel_url, c.avatar_url, c.follower_count,
              (av.file IS NOT NULL) AS has_avatar, EXTRACT(EPOCH FROM av.fetched_at)::bigint AS avatar_v
         FROM creators c
         LEFT JOIN creator_avatars av ON av.creator_id = c.id
        WHERE NOT c.is_hidden AND (c.machine_id = $1 OR ($2::text IS NOT NULL AND c.user_id = $2))
        ORDER BY c.follower_count DESC NULLS LAST`,
      [machineId, install.user_id]
    ),
    query(
      `SELECT session_id, started_at, ended_at, session_duration_minutes, app_version, platforms_used
         FROM sessions WHERE machine_id = $1
        ORDER BY started_at DESC LIMIT 10`,
      [machineId]
    ),
    query(
      `SELECT p AS platform, COUNT(*)::int AS sessions
         FROM sessions, unnest(platforms_used) p
        WHERE machine_id = $1
        GROUP BY p ORDER BY sessions DESC`,
      [machineId]
    ),
    // Por session_id para usar idx_events_session_ts; events no tiene indice por machine_id.
    query(
      `SELECT e.connector, e.name, COUNT(*)::int AS uses
         FROM events e
        WHERE e.session_id IN (SELECT session_id FROM sessions WHERE machine_id = $1)
        GROUP BY e.connector, e.name
        ORDER BY uses DESC LIMIT 10`,
      [machineId]
    ),
  ]);

  return { ...install, creators, recent_sessions: recent, platforms, features };
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
  summary, daily, retention, countries, liveMap, geoHistory, installPoints, versions,
  features, featureDetail, sessions, sessionEvents, installProfile,
  platformMix, systemStatus, liveUserIds,
};
