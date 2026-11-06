'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

if (!process.env.TEST_DATABASE_URL) {
  test('integración de estados en live (requiere TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL no definido' }, () => {});
} else {
  process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
  process.env.ADMIN_USER ||= 'admin';
  process.env.ADMIN_PASSWORD ||= 'admin-password';
  process.env.SESSION_SECRET ||= '0123456789abcdef0123456789abcdef';
  process.env.INGEST_TOKEN ||= 'integration-token';
  process.env.LIVE_IDLE_MIN = '30';

  const { migrate } = require('../db/migrate');
  const { pool } = require('./db');
  const dashboard = require('./queries/dashboard');

  const ago = (min) => `NOW() - INTERVAL '${min} minutes'`;

  // Una sesion por escenario. `live` = minutos desde la ultima senal live (null = nunca).
  async function session(id, { live, received = 1, ended = false, events = [] }) {
    await pool.query('INSERT INTO installs (machine_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, `u_${id}`]);
    await pool.query(
      `INSERT INTO sessions (session_id, machine_id, started_at, received_at, live_heartbeat_at, ended_at, lat, lon, country_code)
       VALUES (gen_random_uuid(), $1, ${ago(120)}, ${ago(received)},
               ${live === null || live === undefined ? 'NULL' : ago(live)},
               ${ended ? ago(5) : 'NULL'}, 10, 20, 'EC')`,
      [id]
    );
    const { rows } = await pool.query('SELECT session_id FROM sessions WHERE machine_id = $1', [id]);
    for (const [connector, name, minutesAgo] of events) {
      await pool.query(
        `INSERT INTO events (session_id, machine_id, connector, name, ts) VALUES ($1, $2, $3, $4, ${ago(minutesAgo)})`,
        [rows[0].session_id, id, connector, name]
      );
    }
  }

  const clean = () => pool.query(`DELETE FROM installs WHERE machine_id LIKE 'lv\\_%'`);

  test('clasifica en live / conectada sin actividad / abierta / cerrada', async () => {
    await migrate();
    await clean();
    try {
      await session('lv_activo', { live: 0, events: [['tts', 'spoken', 2]] });
      await session('lv_olvido', { live: 0, events: [['tts', 'spoken', 45]] });
      // Acaba de conectar: sin chat aun, pero la conexion cuenta como senal.
      await session('lv_recien', { live: 0, events: [['tts', 'spoken', 90], ['platforms', 'connected', 3]] });
      // Eventos que no son actividad (ajustes) no mantienen en live.
      await session('lv_ajustes', { live: 0, events: [['tts', 'spoken', 50], ['settings', 'changed', 1]] });
      // Sin ninguna senal registrada: no se puede saber, beneficio de la duda.
      await session('lv_sinsenal', { live: 0 });
      await session('lv_abierta', { live: null });
      // La senal de live se perdio hace 10 min (se desconecto sin avisar): solo abierta.
      await session('lv_cayo', { live: 10 });
      await session('lv_cerrada', { live: null, received: 20, ended: true });

      const { rows } = await dashboard.sessions({ pageSize: 50 });
      const state = Object.fromEntries(rows.filter((r) => r.machine_id.startsWith('lv_')).map((r) => [r.machine_id, r.live_state]));
      assert.deepEqual(state, {
        lv_activo: 'live', lv_olvido: 'idle', lv_recien: 'live', lv_ajustes: 'idle',
        lv_sinsenal: 'live', lv_abierta: 'open', lv_cayo: 'open', lv_cerrada: 'closed',
      });

      // El mapa solo dibuja a los que estan en live; el resto se cuenta aparte.
      const map = await dashboard.liveMap();
      assert.equal(map.count, 3); // activo, recien, sinsenal
      assert.equal(map.idle, 2); // olvido, ajustes
      assert.equal(map.open, 2); // abierta, cayo
      assert.equal(map.idle_min, 30);

      // Filtros de Sesiones.
      for (const [filter, expected] of [['live', 3], ['idle', 2], ['open', 2]]) {
        const out = await dashboard.sessions({ pageSize: 50, live: filter });
        assert.equal(out.rows.filter((r) => r.machine_id.startsWith('lv_')).length, expected, filter);
      }

      // KPIs de Resumen.
      const summary = await dashboard.summary(30);
      assert.equal(summary.live_now, 3);
      assert.equal(summary.idle_now, 2);
    } finally {
      await clean();
      await pool.end();
    }
  });
}
