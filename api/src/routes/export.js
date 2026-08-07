'use strict';

const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// Exportaciones protegidas por la misma cookie de sesion que el panel: no hay
// token por query string, asi que el secreto no acaba en logs ni en el
// historial del navegador.

const DATASETS = {
  sessions: `SELECT s.*, i.user_id
               FROM sessions s LEFT JOIN installs i ON i.machine_id = s.machine_id
              ORDER BY s.started_at DESC`,
  installs: 'SELECT * FROM installs ORDER BY first_seen_at DESC',
  creators: `SELECT id, platform, username, user_id, display_name, channel_url,
                    follower_count, peak_followers, country, resolve_count,
                    first_seen_at, last_seen_at, total_sessions, total_minutes,
                    is_public, is_hidden, notes
               FROM creators ORDER BY last_seen_at DESC`,
  events: `SELECT * FROM events WHERE ts > NOW() - INTERVAL '30 days' ORDER BY ts DESC`,
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v)
    ? v.join('|')
    : (v instanceof Date ? v.toISOString() : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dataset(req, res) {
  const name = String(req.params.dataset || 'sessions');
  const sql = DATASETS[name];
  if (!sql) {
    res.status(404).json({ error: `dataset desconocido. Opciones: ${Object.keys(DATASETS).join(', ')}` });
    return null;
  }
  return { name, sql };
}

router.get('/:dataset.csv', async (req, res) => {
  const ds = dataset(req, res);
  if (!ds) return;

  try {
    const { rows } = await pool.query(ds.sql);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${ds.name}.csv"`);

    if (!rows.length) return res.end('');

    const headers = Object.keys(rows[0]);
    res.write(headers.join(',') + '\n');
    for (const row of rows) res.write(headers.map((h) => csvCell(row[h])).join(',') + '\n');
    res.end();
  } catch (err) {
    console.error('[export]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:dataset.json', async (req, res) => {
  const ds = dataset(req, res);
  if (!ds) return;

  try {
    const { rows } = await pool.query(ds.sql);
    res.setHeader('Content-Disposition', `attachment; filename="${ds.name}.json"`);
    res.json(rows);
  } catch (err) {
    console.error('[export]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
