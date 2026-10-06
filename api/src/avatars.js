'use strict';

const fs = require('fs/promises');
const path = require('path');
const { query } = require('./db');
const config = require('./config');

// Copia local de los avatares: las URLs del CDN de TikTok van firmadas y
// caducan, asi que se descargan mientras todavia sirven y se guardan en
// config.avatarDir como <creator_id>.<ext>.

const MAX_BYTES = 512 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Descarga una URL y devuelve { type, buf } solo si es una imagen razonable.
async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
  if (!res.ok) return null;
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!EXT[type]) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return null;
  return { type, buf };
}

// Descarga `url` y la deja como la foto vigente del creador. Un fallo queda
// anotado (file NULL) sin borrar una foto buena ya guardada.
async function saveAvatar(creatorId, url, oldFile) {
  let file = null;
  let type = null;
  try {
    const img = await download(url);
    if (img) {
      file = `${creatorId}.${EXT[img.type]}`;
      type = img.type;
      await fs.writeFile(path.join(config.avatarDir, file), img.buf);
      // La foto vieja se borra: con otra extension quedaria huerfana.
      if (oldFile && oldFile !== file) {
        await fs.unlink(path.join(config.avatarDir, path.basename(oldFile))).catch(() => {});
      }
    }
  } catch (_) { /* URL caducada o CDN caido */ }

  await query(
    `INSERT INTO creator_avatars (creator_id, source_url, file, content_type, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (creator_id) DO UPDATE SET
       source_url   = EXCLUDED.source_url,
       file         = COALESCE(EXCLUDED.file, creator_avatars.file),
       content_type = COALESCE(EXCLUDED.content_type, creator_avatars.content_type),
       -- fetched_at = fecha de la foto vigente: de aqui corre el mes.
       fetched_at   = CASE WHEN EXCLUDED.file IS NOT NULL THEN NOW() ELSE creator_avatars.fetched_at END`,
    [creatorId, url, file, type]
  );
  return file != null;
}

// Fichas cuyo avatar_url (el que mando la app) aun no se intento descargar.
async function syncAvatars(limit = 2000) {
  const { rows } = await query(
    `SELECT c.id, c.avatar_url, a.file AS old_file
       FROM creators c
       LEFT JOIN creator_avatars a ON a.creator_id = c.id
      WHERE c.avatar_url IS NOT NULL AND NOT c.is_hidden
        AND (a.creator_id IS NULL OR a.source_url <> c.avatar_url)
      ORDER BY c.is_public DESC, c.last_seen_at DESC
      LIMIT $1`,
    [limit]
  );
  if (!rows.length) return 0;

  await fs.mkdir(config.avatarDir, { recursive: true });
  let saved = 0;
  for (const r of rows) {
    if (await saveAvatar(r.id, r.avatar_url, r.old_file)) saved++;
  }
  return saved;
}

// URL actual de la foto de un perfil publico de TikTok, sacada del HTML del
// perfil (bloque de datos que TikTok embebe en la pagina).
// ponytail: depende del HTML de TikTok; si cambia o bloquea la IP del VPS,
// solo queda la via de la app (requestFreshAvatars).
function parseTiktokAvatar(html) {
  const m = /"avatarMedium":"([^"]+)"/.exec(html) || /"avatarThumb":"([^"]+)"/.exec(html);
  if (!m) return null;
  try {
    const url = JSON.parse(`"${m[1]}"`);
    return /^https:\/\/[^/]+\.tiktokcdn(-[a-z]+)?\.com\//.test(url) ? url : null;
  } catch (_) {
    return null;
  }
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
// Twitch solo pone og:image en el HTML que sirve a crawlers de previews.
const CRAWLER_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';

async function fetchHtml(url, ua) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'user-agent': ua, 'accept-language': 'es-ES,es;q=0.9,en;q=0.8' },
  });
  return res.ok ? res.text() : null;
}

function ogImage(html) {
  const m = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(html)
    || /<meta[^>]+content="([^"]+)"[^>]+property="og:image"/.exec(html);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

// Foto actual del perfil publico, segun la plataforma. null si no se pudo.
// ponytail: depende del HTML de cada plataforma; si cambia o bloquea la IP
// del VPS, queda la via de la app (requestFreshAvatars).
async function profileAvatar(c) {
  if (c.platform === 'tiktok') {
    const html = await fetchHtml(`https://www.tiktok.com/@${encodeURIComponent(c.username)}`, BROWSER_UA);
    return html && parseTiktokAvatar(html);
  }
  if (c.platform === 'youtube' && c.channel_url) {
    const html = await fetchHtml(c.channel_url, BROWSER_UA);
    const url = html && ogImage(html);
    // yt3 acepta el tamano en la URL: 176 px sobra para el widget.
    return url && /^https:\/\/yt3\.(googleusercontent|ggpht)\.com\//.test(url) ? url.replace(/=s\d+/, '=s176') : null;
  }
  if (c.platform === 'twitch') {
    const html = await fetchHtml(`https://www.twitch.tv/${encodeURIComponent(c.username)}`, CRAWLER_UA);
    const url = html && ogImage(html);
    return url && /^https:\/\/static-cdn\.jtvnw\.net\/jtv_user_pictures\//.test(url) ? url : null;
  }
  return null;
}

// Creadores publicos sin foto o con foto de mas de un mes: se toma la foto
// actual de su perfil publico (TikTok, YouTube, Twitch), sin esperar a que
// abran la app. Uno cada 2 s para no martillar a las plataformas.
async function refreshFromProfiles(limit = 2000) {
  const { rows } = await query(
    `SELECT c.id, c.platform, c.username, c.channel_url, a.file AS old_file
       FROM creators c
       LEFT JOIN creator_avatars a ON a.creator_id = c.id
      WHERE c.platform IN ('tiktok', 'youtube', 'twitch') AND c.is_public AND NOT c.is_hidden
        AND (a.file IS NULL OR a.fetched_at < NOW() - INTERVAL '30 days')
      ORDER BY c.featured_order NULLS LAST, c.follower_count DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  if (!rows.length) return 0;

  await fs.mkdir(config.avatarDir, { recursive: true });
  let saved = 0;
  for (const r of rows) {
    try {
      const url = await profileAvatar(r);
      if (url && await saveAvatar(r.id, url, r.old_file)) {
        saved++;
        // Se alinea avatar_url con la foto vigente para que syncAvatars no
        // reintente la URL caducada que tenia la ficha.
        await query('UPDATE creators SET avatar_url = $2 WHERE id = $1', [r.id, url]);
      }
    } catch (_) { /* perfil privado/borrado o la plataforma no respondio */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return saved;
}

// Se le pide a la app del creador (directiva re_resolve en /api/ingest) que
// vuelva a resolver el canal y mande un avatar_url fresco cuando:
//  - es publico y no tiene foto guardada (nuevo o su URL ya caduco), o
//  - su foto tiene mas de un mes: renovacion mensual de los viejos.
// Solo surte efecto cuando esa app vuelve a reportar; syncAvatars descarga
// la URL nueva en la siguiente pasada diaria y reemplaza la foto anterior.
async function requestFreshAvatars() {
  const { rowCount } = await query(
    `UPDATE creators c
        SET force_resolve = TRUE,
            resolve_count = LEAST(resolve_count, 1) -- igual que el boton "re-resolver"
      WHERE c.is_public AND NOT c.is_hidden AND NOT c.force_resolve
        AND c.machine_id IS NOT NULL AND c.machine_id NOT LIKE 'manual:%'
        AND NOT EXISTS (SELECT 1 FROM creator_avatars a
                         WHERE a.creator_id = c.id AND a.file IS NOT NULL
                           AND a.fetched_at > NOW() - INTERVAL '30 days')`
  );
  return rowCount;
}

// Creadores ocultos (pidieron salir de la web, spam, pruebas): se borra su
// foto del disco y su indice. Lo promete la politica de privacidad (§7).
async function purgeHiddenAvatars() {
  const { rows } = await query(
    `DELETE FROM creator_avatars a
      USING creators c
      WHERE c.id = a.creator_id AND c.is_hidden
      RETURNING a.file`
  );
  for (const r of rows) {
    if (r.file) await fs.unlink(path.join(config.avatarDir, path.basename(r.file))).catch(() => {});
  }
  return rows.length;
}

module.exports = { syncAvatars, refreshFromProfiles, requestFreshAvatars, purgeHiddenAvatars, download, parseTiktokAvatar, profileAvatar, EXT };
