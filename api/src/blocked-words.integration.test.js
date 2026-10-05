'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

if (!process.env.TEST_DATABASE_URL) {
  test('integración de palabras bloqueadas (requiere TEST_DATABASE_URL)', { skip: 'TEST_DATABASE_URL no definido' }, () => {});
} else {
  process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
  process.env.ADMIN_USER ||= 'admin';
  process.env.ADMIN_PASSWORD ||= 'admin-password';
  process.env.SESSION_SECRET ||= '0123456789abcdef0123456789abcdef';
  process.env.INGEST_TOKEN ||= 'integration-token';
  process.env.ACTIVE_DAYS = '0';

  const express = require('express');
  const cookieParser = require('cookie-parser');
  const { migrate } = require('../db/migrate');
  const { pool } = require('./db');
  const connector = require('./connectors/blocked-words');
  const words = require('./queries/blocked-words');
  const { rebuildBlockedWordWeekly, purgeOldBlockedWords } = require('./jobs');
  const { requireAuth } = require('./middleware/requireAuth');
  const { issueCookie } = require('./auth');
  const dashboardRoutes = require('./routes/dashboard');
  const exportRoutes = require('./routes/export');

  const hash = (n) => n.toString(16).padStart(64, '0');
  const at = (day) => `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`;

  async function snapshot(machineId, list, day, n) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await connector.handle({ client, machine_id: machineId }, {
        name: 'blocked_words_snapshot',
        props: { words: list, lang: 'es', snapshot_at: at(day), list_hash: hash(n) },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function httpServer() {
    const app = express();
    app.use(cookieParser());
    app.post('/test-login', (req, res) => { issueCookie(res); res.json({ ok: true }); });
    app.use('/api/dashboard', requireAuth, dashboardRoutes);
    app.use('/api/export', requireAuth, exportRoutes);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  }

  test('SQL real: snapshots, k-anonimato, historial y rutas protegidas', async (t) => {
    await migrate();
    await pool.query('TRUNCATE blocked_word_weekly, installation_blocked_word_snapshots, installation_blocked_words, blocked_words, events, sessions, installs CASCADE');
    t.after(async () => { await pool.end(); });

    for (let i = 1; i <= 5; i++) {
      await pool.query('INSERT INTO installs (machine_id, user_id) VALUES ($1, $2)', [`machine-${i}`, `user-${i}`]);
    }

    await snapshot('machine-1', ['spam', 'flood', 'rare', '@privado'], 1, 1);
    await snapshot('machine-2', ['spam', 'rare'], 1, 2);
    await snapshot('machine-3', ['spam', 'caps'], 1, 3);
    await snapshot('machine-4', ['caps'], 1, 4);
    await snapshot('machine-5', ['spam', 'caps'], 1, 5);

    let ranking = await words.ranking({ k: 3 });
    assert.deepEqual(ranking.rows.map((row) => [row.word_norm, row.usuarios_distintos]), [['spam', 4], ['caps', 3]]);
    assert.equal((await words.exportRows({ k: 3 })).some((row) => row.word_norm === 'rare'), false);
    assert.equal((await pool.query("SELECT 1 FROM installation_blocked_words WHERE word_norm = 'privado'")).rowCount, 0);

    await snapshot('machine-1', ['spam'], 2, 6);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM installation_blocked_words WHERE machine_id = 'machine-1' AND word_norm = 'flood'")).rows[0].n, 1);
    await snapshot('machine-1', ['old'], 1, 7);
    await snapshot('machine-1', ['same'], 2, 6);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM installation_blocked_words WHERE machine_id = 'machine-1' AND word_norm IN ('old', 'same')")).rows[0].n, 0);

    assert.ok(await rebuildBlockedWordWeekly());
    assert.equal((await pool.query("SELECT users FROM blocked_word_weekly WHERE word_norm = 'spam'")).rows[0].users, 4);

    const { server, base } = await httpServer();
    t.after(() => new Promise((resolve) => server.close(resolve)));
    assert.equal((await fetch(`${base}/api/dashboard/blocked-words?k=3`)).status, 401);
    const login = await fetch(`${base}/test-login`, { method: 'POST' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { cookie };
    const dashboard = await fetch(`${base}/api/dashboard/blocked-words?k=3`, { headers });
    assert.equal(dashboard.status, 200);
    assert.deepEqual((await dashboard.json()).rows.map((row) => row.word_norm), ['spam', 'caps']);
    for (const extension of ['tsv', 'csv']) {
      const response = await fetch(`${base}/api/export/blocked-words.${extension}?k=3`, { headers });
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.match(body, /spam/);
      assert.doesNotMatch(body, /rare/);
    }

    // Retencion: la asociacion caduca RETENTION_DAYS despues de su ultimo envio.
    await pool.query("UPDATE installation_blocked_words SET last_seen = NOW() - INTERVAL '400 days' WHERE machine_id = 'machine-4'");
    await pool.query("INSERT INTO blocked_words (word_norm) VALUES ('huerfana') ON CONFLICT DO NOTHING");
    assert.equal(await purgeOldBlockedWords(), 1);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM installation_blocked_words WHERE machine_id = 'machine-4'")).rows[0].n, 0);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM installation_blocked_words WHERE machine_id = 'machine-3'")).rows[0].n, 2, 'lo reciente se conserva');
    assert.equal((await pool.query("SELECT 1 FROM blocked_words WHERE word_norm = 'huerfana'")).rowCount, 0, 'palabra sin referencias borrada');

    await pool.query("DELETE FROM installs WHERE machine_id = 'machine-5'");
    ranking = await words.ranking({ k: 3 });
    assert.deepEqual(ranking.rows.map((row) => [row.word_norm, row.usuarios_distintos]), [['spam', 3]]);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM installation_blocked_words WHERE machine_id = 'machine-5'")).rows[0].n, 0);
  });
}
