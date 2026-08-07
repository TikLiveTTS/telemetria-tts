'use strict';

// Identidad de los canales que usa cada instalacion.
//
//   identified → la app resolvio el perfil (solo ocurre 2 veces por canal)
//   seen       → conexion posterior, sin llamadas de red: refresca last_seen_at
//   stats      → conteo de seguidores del heartbeat (dato que la app ya tenia
//                en memoria para el overlay, no cuesta una peticion extra)

const PLATFORMS = new Set(['tiktok', 'twitch', 'youtube']);

function cleanHandle(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/^@+/, '');
  if (!s || s.length > 100) return null;
  // Handles reales: letras, numeros, punto, guion, guion bajo.
  return /^[\w.\-]+$/.test(s) ? s : null;
}

function safeUrl(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (s.length > 500) return null;
  return /^https:\/\//i.test(s) ? s : null;
}

// La URL canonica se construye aqui, en el servidor, no en el cliente.
function channelUrl(platform, username) {
  if (platform === 'tiktok') return `https://www.tiktok.com/@${username}`;
  if (platform === 'twitch') return `https://www.twitch.tv/${username}`;
  if (platform === 'youtube') {
    return /^UC[\w-]{20,}$/.test(username)
      ? `https://www.youtube.com/channel/${username}`
      : `https://www.youtube.com/@${username}`;
  }
  return null;
}

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 2_000_000_000 ? Math.round(n) : null;
}

async function handle(ctx, event) {
  const { client, machine_id, app_version, geo } = ctx;
  const p = event.props || {};

  const platform = String(p.platform || '').toLowerCase();
  if (!PLATFORMS.has(platform)) return;

  const username = cleanHandle(p.username);
  if (!username) return;

  const followers = intOrNull(p.follower_count);

  if (event.name === 'identified') {
    const displayName = p.display_name ? String(p.display_name).trim().slice(0, 120) : null;
    const avatar = safeUrl(p.avatar_url);
    const url = safeUrl(p.channel_url) || channelUrl(platform, username);
    const resolveCount = Math.min(2, Math.max(0, intOrNull(p.resolve_count) ?? 1));

    // Se pisan los campos de perfil solo si el dato entrante no es peor.
    // COALESCE en el lado del valor nuevo evita borrar un avatar bueno con un
    // null de una resolucion que fallo a medias.
    await client.query(
      `INSERT INTO creators
         (platform, username, user_id, machine_id, resolve_count,
          display_name, channel_url, avatar_url, follower_count, peak_followers,
          country, app_version, first_seen_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$12)
       ON CONFLICT (platform, username) DO UPDATE SET
         user_id        = COALESCE(creators.user_id, EXCLUDED.user_id),
         machine_id     = COALESCE(creators.machine_id, EXCLUDED.machine_id),
         resolve_count  = GREATEST(creators.resolve_count, EXCLUDED.resolve_count),
         force_resolve  = FALSE,
         display_name   = COALESCE(EXCLUDED.display_name, creators.display_name),
         channel_url    = COALESCE(EXCLUDED.channel_url, creators.channel_url),
         avatar_url     = COALESCE(EXCLUDED.avatar_url, creators.avatar_url),
         follower_count = COALESCE(EXCLUDED.follower_count, creators.follower_count),
         peak_followers = GREATEST(COALESCE(creators.peak_followers, 0),
                                   COALESCE(EXCLUDED.follower_count, 0)),
         country        = COALESCE(EXCLUDED.country, creators.country),
         app_version    = COALESCE(EXCLUDED.app_version, creators.app_version),
         last_seen_at   = EXCLUDED.last_seen_at`,
      [
        platform, username, ctx.install.user_id, machine_id, resolveCount,
        displayName, url, avatar, followers,
        geo.country, app_version, event.ts,
      ]
    );

    if (followers != null) await recordFollowers(client, platform, username, followers, event.ts);
    return;
  }

  if (event.name === 'seen') {
    // Conexion sin resolucion. Si el canal no existia todavia (por ejemplo la
    // primera resolucion fallo), se crea la ficha minima para no perderlo.
    await client.query(
      `INSERT INTO creators
         (platform, username, user_id, machine_id, channel_url,
          country, app_version, first_seen_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (platform, username) DO UPDATE SET
         user_id      = COALESCE(creators.user_id, EXCLUDED.user_id),
         machine_id   = COALESCE(creators.machine_id, EXCLUDED.machine_id),
         app_version  = COALESCE(EXCLUDED.app_version, creators.app_version),
         last_seen_at = EXCLUDED.last_seen_at`,
      [
        platform, username, ctx.install.user_id, machine_id,
        channelUrl(platform, username), geo.country, app_version, event.ts,
      ]
    );
    return;
  }

  if (event.name === 'stats') {
    if (followers == null) return;
    await client.query(
      `UPDATE creators
          SET follower_count = $3,
              peak_followers = GREATEST(COALESCE(peak_followers, 0), $3),
              last_seen_at   = $4
        WHERE platform = $1 AND username = $2`,
      [platform, username, followers, event.ts]
    );
    await recordFollowers(client, platform, username, followers, event.ts);
  }
}

// Un punto por dia y canal: la curva de la ficha lateral.
async function recordFollowers(client, platform, username, followers, ts) {
  await client.query(
    `INSERT INTO creator_follower_history (creator_id, day, followers)
     SELECT c.id, ($3::timestamptz AT TIME ZONE $4)::date, $5
       FROM creators c
      WHERE c.platform = $1 AND c.username = $2
     ON CONFLICT (creator_id, day) DO UPDATE SET followers = EXCLUDED.followers`,
    [platform, username, ts, process.env.TZ_DISPLAY || 'America/Guayaquil', followers]
  );
}

module.exports = { name: 'creators', handle, channelUrl };
