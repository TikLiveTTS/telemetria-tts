'use strict';

// Genera datos falsos para poder trabajar el panel sin usuarios reales.
//
//   docker compose exec api node tools/seed.js 200
//
// Marca todo lo que crea con el prefijo 'seed_' en machine_id, asi que se
// puede limpiar con:  node tools/seed.js --clean

const crypto = require('crypto');
const { pool } = require('../src/db');
const { runRollup } = require('../src/jobs');

const COUNTRIES = [
  ['Ecuador', 'EC', 'Guayaquil', -2.19, -79.89],
  ['Mexico', 'MX', 'Ciudad de Mexico', 19.43, -99.13],
  ['Espana', 'ES', 'Madrid', 40.42, -3.70],
  ['Colombia', 'CO', 'Bogota', 4.71, -74.07],
  ['Argentina', 'AR', 'Buenos Aires', -34.60, -58.38],
  ['Peru', 'PE', 'Lima', -12.05, -77.04],
  ['Chile', 'CL', 'Santiago', -33.45, -70.67],
  ['Estados Unidos', 'US', 'Miami', 25.76, -80.19],
  ['Brasil', 'BR', 'Sao Paulo', -23.55, -46.63],
  ['Venezuela', 'VE', 'Caracas', 10.48, -66.90],
  ['Guatemala', 'GT', 'Ciudad de Guatemala', 14.63, -90.51],
  ['Bolivia', 'BO', 'La Paz', -16.50, -68.15],
  ['Republica Dominicana', 'DO', 'Santo Domingo', 18.49, -69.93],
  ['Honduras', 'HN', 'Tegucigalpa', 14.07, -87.19],
  ['Paraguay', 'PY', 'Asuncion', -25.26, -57.58],
  ['Uruguay', 'UY', 'Montevideo', -34.90, -56.16],
  ['Costa Rica', 'CR', 'San Jose', 9.93, -84.08],
  ['Panama', 'PA', 'Ciudad de Panama', 8.98, -79.52],
  ['Canada', 'CA', 'Toronto', 43.65, -79.38],
  ['Francia', 'FR', 'Paris', 48.86, 2.35],
  ['Italia', 'IT', 'Roma', 41.90, 12.50],
  ['Alemania', 'DE', 'Berlin', 52.52, 13.40],
  ['Reino Unido', 'GB', 'Londres', 51.51, -0.13],
  ['Portugal', 'PT', 'Lisboa', 38.72, -9.14],
  ['Noruega', 'NO', 'Oslo', 59.91, 10.75],
  ['Marruecos', 'MA', 'Casablanca', 33.57, -7.59],
  ['Filipinas', 'PH', 'Manila', 14.60, 120.98],
  ['Japon', 'JP', 'Tokio', 35.68, 139.69],
  ['Australia', 'AU', 'Sidney', -33.87, 151.21],
];

// Peso de cada pais (mismo orden que COUNTRIES): Latam domina, el resto es cola.
const COUNTRY_WEIGHTS = [30, 45, 35, 25, 20, 15, 10, 25, 12, 8, 6, 5, 6, 4, 3, 2, 3, 2, 3, 3, 3, 2, 3, 2, 1, 1, 2, 1, 1, 1];

// Lanzamientos: [version, dias atras]. Cada sesion usa la ultima version
// publicada en su fecha, con un retraso de adopcion aleatorio por usuario.
const RELEASES = [['1.4.0', 120], ['1.5.6', 70], ['1.5.7', 40], ['1.5.8', 18], ['1.6.0', 4]];
const VERSIONS = RELEASES.map(([v]) => v);

// Hora local de inicio: casi todo por la tarde/noche, cuando se hace directo.
const HOUR_WEIGHTS = [3, 2, 1, 1, 1, 1, 1, 2, 2, 3, 3, 4, 5, 5, 5, 6, 8, 10, 13, 15, 16, 14, 10, 6];

function weighted(items, weights) {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

function versionAt(date, lagDays) {
  const age = (Date.now() - date.getTime()) / 86400000 + lagDays;
  return [...RELEASES].reverse().find(([, ago]) => ago >= age)?.[0] || RELEASES[0][0];
}

// Inicio de sesion en el dia `dayOffset` atras, a una hora local realista
// segun la longitud del usuario. Fines de semana con mas probabilidad.
function sessionStart(dayOffset, lon) {
  let d = dayOffset;
  const dow = new Date(Date.now() - d * 86400000).getUTCDay();
  if ((dow === 1 || dow === 2) && Math.random() < 0.35 && d > 0) d -= 1;
  const day = new Date(Date.now() - d * 86400000);
  day.setUTCHours(0, 0, 0, 0);
  const localHour = weighted([...Array(24).keys()], HOUR_WEIGHTS);
  const t = day.getTime() + (localHour - Math.round(lon / 15)) * 3600000 + between(0, 59) * 60000;
  return new Date(Math.min(t, Date.now() - 10 * 60000));
}
const PLATFORMS = ['tiktok', 'twitch', 'youtube', 'kick'];
const HANDLES = [
  'khunsa', 'lunastream', 'gamerx', 'pixelpanda', 'nocturno', 'sofiaplays',
  'elmagotv', 'ritmolatino', 'zonagamer', 'mariposa_live', 'kbros', 'dj_neon',
  'valequeen', 'thecraftlab', 'auroraz', 'tacotuesday', 'rexgaming', 'mimivt',
];

const EVENT_MIX = [
  ['tts', 'spoken', 40], ['tts', 'rate_limited', 3], ['tts', 'skipped', 5],
  ['music', 'request', 8], ['music', 'skip', 3],
  ['soundpad', 'triggered', 10],
  ['moderation', 'message_filtered', 12],
  ['overlays', 'opened', 2],
  ['obs', 'clip_saved', 2],
  ['mobile', 'command', 3],
  ['updates', 'check', 1],
  ['settings', 'snapshot', 1],
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

async function clean() {
  await pool.query("DELETE FROM creators WHERE machine_id LIKE 'seed_%'");
  const { rowCount } = await pool.query("DELETE FROM installs WHERE machine_id LIKE 'seed_%'");
  console.log(`[seed] borradas ${rowCount} instalaciones de prueba (cascada incluida)`);
}

async function seed(count) {
  const client = await pool.connect();
  const usedHandles = new Set();

  try {
    for (let i = 0; i < count; i++) {
      const machineId = `seed_${crypto.randomBytes(8).toString('hex')}`;
      const userId = 'usr_' + crypto.randomBytes(4).toString('hex');
      const [country, code, city, lat, lon] = weighted(COUNTRIES, COUNTRY_WEIGHTS);
      // Dias que tarda este usuario en actualizar; algunos nunca lo hacen.
      const lag = Math.random() < 0.1 ? 999 : Math.round(-Math.log(Math.random()) * 5);
      // Usuarios intensivos: pocos, con sesiones largas (curva de Pareto).
      const intensity = Math.random() < 0.12 ? 3 : Math.random() < 0.5 ? 1 : 0.4;

      // Antiguedad de la instalacion: hasta 120 dias atras.
      const ageDays = between(0, 120);
      const version = versionAt(new Date(Date.now() - ageDays * 86400000), lag);
      const firstSeen = sessionStart(ageDays, lon);

      await client.query(
        `INSERT INTO installs
           (machine_id, user_id, first_seen_at, last_seen_at, app_version,
            os_platform, os_release, os_arch, locale,
            country, country_code, city, lat, lon, ip)
         VALUES ($1,$2,$3,NOW(),$4,'win32','10.0.26200','x64','es-ES',$5,$6,$7,$8,$9,'203.0.113.1')
         ON CONFLICT (machine_id) DO NOTHING`,
        [machineId, userId, firstSeen, version, country, code, city,
         lat + (Math.random() - .5), lon + (Math.random() - .5)]
      );

      // Sesiones: mas para instalaciones viejas, con abandono realista.
      const sessionCount = Math.max(1, Math.round(between(1, 25) * intensity * Math.min(1, (ageDays + 3) / 30)));
      // Minutos hasta conectar la primera plataforma; un 12% nunca conecta.
      const neverConnects = Math.random() < 0.12;
      const firstConnect = weighted([0.5, 3, 10, 35, 300, 2000], [30, 30, 15, 10, 8, 7]) * (0.5 + Math.random());
      let totalMinutes = 0;

      for (let s = 0; s < sessionCount; s++) {
        const sessionId = crypto.randomUUID();
        // Sesiones repartidas desde la instalacion; la mayoria abandona pronto.
        const dayOffset = s === 0 ? ageDays : Math.max(0, ageDays - Math.round(Math.random() ** 1.6 * ageDays));
        const startedAt = s === 0 ? firstSeen : sessionStart(dayOffset, lon);
        const sessionVersion = versionAt(startedAt, lag);
        const duration = Math.max(3, Math.round(weighted([8, 35, 110, 240], [15, 25, 35, 25]) * (0.5 + Math.random()) * Math.sqrt(intensity)));
        const platforms = [...new Set(Array.from({ length: between(1, 2) }, () => pick(PLATFORMS)))];

        // Una parte de las sesiones recientes se deja "viva" para que el mapa
        // y el KPI de activos ahora tengan algo que mostrar.
        const live = startedAt.getTime() + duration * 60000 > Date.now()
          || (dayOffset === 0 && Math.random() < 0.25);
        const endedAt = live ? null : new Date(startedAt.getTime() + duration * 60000);

        await client.query(
          `INSERT INTO sessions
             (session_id, machine_id, app_version, os_release,
              country, country_code, city, lat, lon, ip,
              platforms_used, started_at, last_heartbeat_at, ended_at,
              session_duration_minutes, first_seen)
           VALUES ($1,$2,$3,'10.0.26200',$4,$5,$6,$7,$8,'203.0.113.1',$9,$10,$11,$12,$13,$14)`,
          [
            sessionId, machineId, sessionVersion, country, code, city,
            lat + (Math.random() - .5), lon + (Math.random() - .5),
            platforms, startedAt,
            live ? new Date() : endedAt,
            endedAt, live ? null : duration, s === 0,
          ]
        );

        if (!live) totalMinutes += duration;

        // Eventos de la sesion
        const rows = [];
        rows.push([sessionId, machineId, 'app', 'startup', '{}', sessionVersion, startedAt]);
        for (const [connector, name, weight] of EVENT_MIX) {
          const n = Math.round((weight * duration) / 200 * Math.random());
          for (let k = 0; k < n; k++) {
            const ts = new Date(startedAt.getTime() + Math.random() * duration * 60000);
            rows.push([sessionId, machineId, connector, name, '{}', sessionVersion, ts]);
          }
        }
        const connectAt = s === 0
          ? new Date(startedAt.getTime() + firstConnect * 60000)
          : new Date(startedAt.getTime() + between(0, 3) * 60000);
        if (!(neverConnects && s === 0) && connectAt <= new Date()) {
          for (const platform of platforms) {
            rows.push([sessionId, machineId, 'platforms', 'connected',
              JSON.stringify({ platform }), sessionVersion, connectAt]);
          }
        }

        for (const r of rows) {
          await client.query(
            `INSERT INTO events (session_id, machine_id, connector, name, props, app_version, ts)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            r
          );
        }
      }

      await client.query(
        `UPDATE installs i SET total_sessions = $2, total_minutes = $3,
                app_version = s.app_version, last_seen_at = s.started_at
           FROM (SELECT app_version, started_at FROM sessions WHERE machine_id = $1
                  ORDER BY started_at DESC LIMIT 1) s
          WHERE i.machine_id = $1`,
        [machineId, sessionCount, totalMinutes]
      );

      // Un 45% de las instalaciones deja un canal identificado.
      if (Math.random() < 0.45) {
        let handle = pick(HANDLES);
        while (usedHandles.has(handle)) handle = `${pick(HANDLES)}${between(2, 99)}`;
        usedHandles.add(handle);

        const platform = pick(PLATFORMS);
        const followers = between(80, 90000);
        const url = platform === 'tiktok' ? `https://www.tiktok.com/@${handle}`
          : platform === 'twitch' ? `https://www.twitch.tv/${handle}`
          : platform === 'kick' ? `https://kick.com/${handle}`
          : `https://www.youtube.com/@${handle}`;

        const { rows } = await client.query(
          `INSERT INTO creators
             (platform, username, user_id, machine_id, resolve_count, display_name,
              channel_url, follower_count, peak_followers, country, app_version,
              first_seen_at, last_seen_at, total_sessions, total_minutes, is_public)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,NOW(),$12,$13,$14)
           ON CONFLICT (platform, username) DO NOTHING
           RETURNING id`,
          [
            platform, handle, userId, machineId, pick([1, 2, 2, 2]),
            handle.charAt(0).toUpperCase() + handle.slice(1),
            url, followers, country, version, firstSeen,
            sessionCount, totalMinutes, Math.random() < 0.15,
          ]
        );

        // Curva de seguidores de los ultimos 30 dias
        if (rows.length) {
          for (let d = 30; d >= 0; d--) {
            const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
            const value = Math.round(followers * (1 - d * 0.004 * Math.random()));
            await client.query(
              `INSERT INTO creator_follower_history (creator_id, day, followers)
               VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [rows[0].id, day, Math.max(1, value)]
            );
          }
        }
      }

      if ((i + 1) % 25 === 0) console.log(`[seed] ${i + 1}/${count} instalaciones`);
    }
  } finally {
    client.release();
  }

  console.log('[seed] recalculando rollup...');
  await runRollup(120);
  console.log('[seed] listo');
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--clean') {
    await clean();
  } else {
    const count = parseInt(arg, 10) || 100;
    console.log(`[seed] generando ${count} instalaciones de prueba...`);
    await seed(count);
  }
  await pool.end();
}

main().catch((err) => {
  console.error('[seed] fallo:', err.message);
  process.exit(1);
});
