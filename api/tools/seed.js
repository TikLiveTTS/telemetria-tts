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
];

const VERSIONS = ['1.5.8', '1.5.8', '1.5.8', '1.5.7', '1.5.6', '1.4.0'];
const PLATFORMS = ['tiktok', 'twitch', 'youtube'];
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
      const [country, code, city, lat, lon] = pick(COUNTRIES);
      const version = pick(VERSIONS);

      // Antiguedad de la instalacion: hasta 90 dias atras.
      const ageDays = between(0, 90);
      const firstSeen = new Date(Date.now() - ageDays * 86400000);

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
      const sessionCount = Math.max(1, Math.round(between(1, 12) * Math.exp(-ageDays / 60)));
      let totalMinutes = 0;

      for (let s = 0; s < sessionCount; s++) {
        const sessionId = crypto.randomUUID();
        const dayOffset = between(0, Math.min(ageDays, 60));
        const startedAt = new Date(Date.now() - dayOffset * 86400000 - between(0, 20) * 3600000);
        const duration = between(5, 320);
        const platforms = [...new Set(Array.from({ length: between(1, 2) }, () => pick(PLATFORMS)))];

        // Una parte de las sesiones recientes se deja "viva" para que el mapa
        // y el KPI de activos ahora tengan algo que mostrar.
        const live = dayOffset === 0 && Math.random() < 0.25;
        const endedAt = live ? null : new Date(startedAt.getTime() + duration * 60000);

        await client.query(
          `INSERT INTO sessions
             (session_id, machine_id, app_version, os_release,
              country, country_code, city, lat, lon, ip,
              platforms_used, started_at, last_heartbeat_at, ended_at,
              session_duration_minutes, first_seen)
           VALUES ($1,$2,$3,'10.0.26200',$4,$5,$6,$7,$8,'203.0.113.1',$9,$10,$11,$12,$13,$14)`,
          [
            sessionId, machineId, version, country, code, city,
            lat + (Math.random() - .5), lon + (Math.random() - .5),
            platforms, startedAt,
            live ? new Date() : endedAt,
            endedAt, live ? null : duration, s === 0,
          ]
        );

        if (!live) totalMinutes += duration;

        // Eventos de la sesion
        const rows = [];
        rows.push([sessionId, machineId, 'app', 'startup', '{}', version, startedAt]);
        for (const [connector, name, weight] of EVENT_MIX) {
          const n = Math.round((weight * duration) / 200 * Math.random());
          for (let k = 0; k < n; k++) {
            const ts = new Date(startedAt.getTime() + Math.random() * duration * 60000);
            rows.push([sessionId, machineId, connector, name, '{}', version, ts]);
          }
        }
        for (const platform of platforms) {
          rows.push([sessionId, machineId, 'platforms', 'connected',
            JSON.stringify({ platform }), version, startedAt]);
        }
        if (Math.random() < 0.06) {
          rows.push([sessionId, machineId, 'errors', 'handled',
            JSON.stringify({ where: 'tts', message: 'Google TTS timeout' }), version, startedAt]);
          await client.query(
            `INSERT INTO app_errors (machine_id, session_id, app_version, where_at, message, signature, ts)
             VALUES ($1,$2,$3,'tts','Google TTS timeout after 8000ms','seedsig00000001',$4)`,
            [machineId, sessionId, version, startedAt]
          );
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
        'UPDATE installs SET total_sessions = $2, total_minutes = $3 WHERE machine_id = $1',
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
