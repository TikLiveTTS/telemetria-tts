'use strict';

const express = require('express');
const { pool } = require('../db');
const blockedWords = require('../queries/blocked-words');
const config = require('../config');
const { csvCell, exportCell } = require('../export-cells');

const router = express.Router();

// Exportaciones protegidas por la misma cookie de sesion que el panel: no hay
// token por query string, asi que el secreto no acaba en logs ni en el
// historial del navegador.

const DATASETS = {
  sessions: `SELECT s.session_id, s.machine_id, s.app_version, s.os_release,
                    s.country, s.country_code, s.city, s.lat, s.lon,
                    s.platforms_used, s.started_at, s.last_heartbeat_at,
                    s.ended_at, s.session_duration_minutes, s.first_seen,
                    s.received_at, i.user_id
               FROM sessions s LEFT JOIN installs i ON i.machine_id = s.machine_id
              ORDER BY s.started_at DESC`,
  installs: `SELECT machine_id, user_id, first_seen_at, last_seen_at, app_version,
                    os_platform, os_release, os_arch, locale, country, country_code,
                    city, lat, lon, total_sessions, total_minutes
               FROM installs ORDER BY first_seen_at DESC`,
  creators: `SELECT id, platform, username, user_id, display_name, channel_url,
                    follower_count, peak_followers, country, resolve_count,
                    first_seen_at, last_seen_at, total_sessions, total_minutes,
                    is_public, is_hidden, notes
               FROM creators ORDER BY last_seen_at DESC`,
  events: `SELECT * FROM events WHERE ts > NOW() - INTERVAL '30 days' ORDER BY ts DESC`,
};


function blockedWordsOptions(req) {
  const int = (name, fallback, max) => {
    const value = parseInt(req.query[name], 10);
    return Number.isFinite(value) ? Math.min(max, Math.max(1, value)) : fallback;
  };
  return {
    days: int('days', 30, 3650),
    k: int('k', config.blockedWordsK, 100000),
    lang: typeof req.query.lang === 'string' ? req.query.lang.slice(0, 16) : null,
    prefix: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : null,
  };
}

async function blockedWordsExport(req, res, separator, extension) {
  try {
    const rows = await blockedWords.exportRows(blockedWordsOptions(req));
    res.setHeader('Content-Type', `text/${extension}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="blocked-words.${extension}"`);
    if (extension === 'csv') res.write('\uFEFF');
    res.write(['word', 'users', 'pct_users', 'first_seen', 'last_seen'].join(separator) + '\n');
    for (const row of rows) {
      res.write([
        row.word_norm, row.usuarios_distintos, row.porcentaje_de_usuarios_activos,
        row.first_seen instanceof Date ? row.first_seen.toISOString() : row.first_seen,
        row.last_seen instanceof Date ? row.last_seen.toISOString() : row.last_seen,
      ].map((value) => exportCell(value, separator)).join(separator) + '\n');
    }
    res.end();
  } catch (err) {
    console.error('[export]', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
}

router.get('/blocked-words.tsv', (req, res) => blockedWordsExport(req, res, '\t', 'tsv'));
router.get('/blocked-words.csv', (req, res) => blockedWordsExport(req, res, ',', 'csv'));

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
