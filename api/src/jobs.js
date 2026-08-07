'use strict';

const { query } = require('./db');
const config = require('./config');

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

function start() {
  const tick = async () => {
    try {
      const touched = await runRollup(3);
      console.log(`[jobs] rollup ok (${touched} filas)`);
    } catch (err) {
      console.error('[jobs] rollup fallo:', err.message);
    }
    try {
      const deleted = await purgeOldEvents();
      if (deleted > 0) console.log(`[jobs] purga: ${deleted} eventos borrados`);
    } catch (err) {
      console.error('[jobs] purga fallo:', err.message);
    }
  };

  // Un primer pase al arrancar (con ventana amplia, por si el servicio estuvo
  // caido) y luego cada hora.
  runRollup(90).catch((err) => console.error('[jobs] rollup inicial fallo:', err.message));

  const timer = setInterval(tick, 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { start, runRollup, purgeOldEvents };
