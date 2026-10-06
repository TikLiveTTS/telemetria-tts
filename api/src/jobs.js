'use strict';

const { query } = require('./db');
const config = require('./config');
const { syncAvatars, requestFreshAvatars, purgeHiddenAvatars } = require('./avatars');

// Tareas periodicas dentro del propio proceso: no hace falta cron ni un
// contenedor extra.

// Recalcula el rollup diario por conector.
async function runRollup(daysBack = 3) {
  const { rows } = await query('SELECT rebuild_feature_daily($1, $2) AS touched', [
    daysBack,
    config.tzDisplay,
  ]);
  return rows[0].touched;
}

async function rebuildBlockedWordWeekly() {
  const { rows } = await query('SELECT rebuild_blocked_word_weekly($1, $2) AS touched', [
    config.activeDays,
    config.tzDisplay,
  ]);
  return rows[0].touched;
}

// Borra eventos crudos mas viejos que RETENTION_DAYS.
// Los agregados de feature_daily sobreviven: se pierde el detalle, no la serie.
async function purgeOldEvents() {
  const { rowCount } = await query(
    `DELETE FROM events WHERE ts < NOW() - make_interval(days => $1::int)`,
    [config.retentionDays]
  );
  await query(
    `DELETE FROM app_errors WHERE ts < NOW() - make_interval(days => $1::int)`,
    [config.retentionDays]
  );
  return rowCount;
}

// Palabras bloqueadas: la asociacion con una instalacion caduca RETENTION_DAYS despues del
// ultimo envio que la incluyo (lo promete la politica de privacidad). Una palabra que el
// streamer conserva se renueva en cada envio semanal; una que quito caduca. El historico
// semanal es agregado, pero tambien se recorta, y las palabras sin referencias se borran.
async function purgeOldBlockedWords() {
  const { rowCount } = await query(
    `DELETE FROM installation_blocked_words WHERE last_seen < NOW() - make_interval(days => $1::int)`,
    [config.retentionDays]
  );
  await query(
    `DELETE FROM installation_blocked_word_snapshots WHERE last_seen < NOW() - make_interval(days => $1::int)`,
    [config.retentionDays]
  );
  await query(
    `DELETE FROM blocked_word_weekly WHERE week < (NOW() - make_interval(days => $1::int))::date`,
    [config.retentionDays]
  );
  await query(
    `DELETE FROM blocked_words w
      WHERE NOT EXISTS (SELECT 1 FROM installation_blocked_words i WHERE i.word_norm = w.word_norm)
        AND NOT EXISTS (SELECT 1 FROM blocked_word_weekly k WHERE k.word_norm = w.word_norm)`
  );
  return rowCount;
}

async function sweepAbandonedSessions() {
  const { rowCount } = await query(
    `UPDATE sessions
        SET ended_at = last_heartbeat_at
      WHERE ended_at IS NULL
        AND last_heartbeat_at < NOW() - INTERVAL '20 minutes'`
  );
  return rowCount;
}

// Publica en la web los creadores nuevos que nadie decidio a mano. Ocultar o
// despublicar desde el panel marca publish_decided y el job no lo revierte.
async function autoPublishCreators() {
  const { rowCount } = await query(
    `UPDATE creators
        SET is_public = TRUE, publish_decided = TRUE
      WHERE NOT is_public AND NOT is_hidden AND NOT publish_decided`
  );
  return rowCount;
}

// Tarea diaria del widget de creadores: publica los nuevos, descarga sus
// fotos a AVATAR_DIR y pide a la app una URL fresca para los que no tienen
// foto o la tienen hace mas de un mes (renovacion mensual).
async function daily() {
  try {
    const published = await autoPublishCreators();
    console.log(`[jobs] creadores publicados automaticamente: ${published}`);
  } catch (err) {
    console.error('[jobs] publicacion de creadores fallo:', err.message);
  }
  try {
    const removed = await purgeHiddenAvatars();
    if (removed > 0) console.log(`[jobs] fotos de creadores ocultos borradas: ${removed}`);
  } catch (err) {
    console.error('[jobs] borrado de fotos ocultas fallo:', err.message);
  }
  try {
    const saved = await syncAvatars();
    console.log(`[jobs] fotos de creadores guardadas: ${saved}`);
  } catch (err) {
    console.error('[jobs] fotos de creadores fallo:', err.message);
  }
  try {
    const asked = await requestFreshAvatars();
    if (asked > 0) console.log(`[jobs] fotos pedidas de nuevo a la app: ${asked}`);
  } catch (err) {
    console.error('[jobs] pedido de fotos fallo:', err.message);
  }
}

function start() {
  const tick = async () => {
    try {
      const touched = await runRollup(3);
      console.log(`[jobs] rollup ok (${touched} filas)`);
    } catch (err) {
      console.error('[jobs] rollup fallo:', err.message);
    }
    try {
      await rebuildBlockedWordWeekly();
    } catch (err) {
      console.error('[jobs] palabras bloqueadas fallo:', err.message);
    }
    try {
      const deleted = await purgeOldEvents();
      if (deleted > 0) console.log(`[jobs] purga: ${deleted} eventos borrados`);
    } catch (err) {
      console.error('[jobs] purga fallo:', err.message);
    }
    try {
      const expired = await purgeOldBlockedWords();
      if (expired > 0) console.log(`[jobs] palabras bloqueadas caducadas: ${expired}`);
    } catch (err) {
      console.error('[jobs] purga de palabras bloqueadas fallo:', err.message);
    }
    try {
      const closed = await sweepAbandonedSessions();
      if (closed > 0) console.log(`[jobs] sesiones cerradas: ${closed}`);
    } catch (err) {
      console.error('[jobs] cierre de sesiones fallo:', err.message);
    }
  };

  // Un primer pase al arrancar (con ventana amplia, por si el servicio estuvo
  // caido) y luego cada hora.
  runRollup(90).catch((err) => console.error('[jobs] rollup inicial fallo:', err.message));
  rebuildBlockedWordWeekly().catch((err) => console.error('[jobs] palabras bloqueadas inicial fallo:', err.message));
  sweepAbandonedSessions().catch((err) => console.error('[jobs] cierre inicial de sesiones fallo:', err.message));

  daily();

  const timer = setInterval(tick, 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  const dailyTimer = setInterval(daily, 24 * 60 * 60 * 1000);
  if (dailyTimer.unref) dailyTimer.unref();
  return timer;
}

module.exports = { start, daily, autoPublishCreators, runRollup, rebuildBlockedWordWeekly, purgeOldEvents, purgeOldBlockedWords, sweepAbandonedSessions };
