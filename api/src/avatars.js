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

// Fichas cuyo avatar_url aun no se intento descargar (nueva o distinta a la
// ultima). Un fallo queda anotado con file NULL y no se reintenta hasta que
// la app mande otra URL.
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
    let file = null;
    let type = null;
    try {
      const img = await download(r.avatar_url);
      if (img) {
        file = `${r.id}.${EXT[img.type]}`;
        type = img.type;
        await fs.writeFile(path.join(config.avatarDir, file), img.buf);
        // La foto vieja se borra: con otra extension quedaria huerfana.
        if (r.old_file && r.old_file !== file) {
          await fs.unlink(path.join(config.avatarDir, path.basename(r.old_file))).catch(() => {});
        }
        saved++;
      }
    } catch (_) { /* URL caducada o CDN caido: queda anotado como fallo */ }

    await query(
      `INSERT INTO creator_avatars (creator_id, source_url, file, content_type, fetched_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (creator_id) DO UPDATE SET
         source_url   = EXCLUDED.source_url,
         -- Un fallo no borra una foto buena ya guardada.
         file         = COALESCE(EXCLUDED.file, creator_avatars.file),
         content_type = COALESCE(EXCLUDED.content_type, creator_avatars.content_type),
         -- fetched_at = fecha de la foto vigente: de aqui corre el mes.
         fetched_at   = CASE WHEN EXCLUDED.file IS NOT NULL THEN NOW() ELSE creator_avatars.fetched_at END`,
      [r.id, r.avatar_url, file, type]
    );
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

module.exports = { syncAvatars, requestFreshAvatars, purgeHiddenAvatars, download, EXT };
