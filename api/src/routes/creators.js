'use strict';

const express = require('express');
const path = require('path');
const c = require('../queries/creators');
const avatars = require('../avatars');
const { query } = require('../db');
const config = require('../config');

const router = express.Router();

function wrap(fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err) {
      console.error('[creators]', err.message);
      const isValidationError = /^(falta |accion invalida|no se puede fusionar|nada que actualizar|sin ids)/.test(err.message);
      res.status(isValidationError ? 400 : 500).json({
        error: isValidationError ? 'Solicitud invalida' : 'Error interno',
      });
    }
  };
}

router.get('/', wrap(async (req) => {
  const [data, stats] = await Promise.all([
    c.list({
      page: Math.max(1, parseInt(req.query.page, 10) || 1),
      pageSize: Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50)),
      sort: req.query.sort || 'last_seen',
      platform: req.query.platform || null,
      q: req.query.q || null,
      onlyPublic: req.query.onlyPublic === 'true',
      onlyNew: req.query.onlyNew === 'true',
      includeHidden: req.query.includeHidden === 'true',
    }),
    c.stats(),
  ]);
  return { ...data, stats };
}));

router.post('/', wrap(async (req) => {
  const { platform, username, display_name, channel_url, avatar_url, user_id } = req.body || {};
  return c.createManual({ platform, username, display_name, channel_url, avatar_url, user_id });
}));

// Recarga de todas las fotos. Antes de '/:id' para que 'avatars' no se tome por un id.
router.post('/avatars/refresh', wrap(() => avatars.startRefreshAll()));
router.get('/avatars/refresh', wrap(() => avatars.refreshAllStatus()));

// Foto guardada de cualquier creador, para el panel (la publica solo sirve a los publicos).
router.get('/:id/avatar', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(404).end();
  try {
    const { rows } = await query('SELECT file, content_type FROM creator_avatars WHERE creator_id = $1 AND file IS NOT NULL', [id]);
    if (!rows.length) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=86400'); // ?v= cambia al renovar la foto
    res.type(rows[0].content_type);
    res.sendFile(path.basename(rows[0].file), { root: config.avatarDir }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch (err) {
    console.error('[creators] avatar', err.message);
    res.status(500).end();
  }
});

router.get('/:id', wrap(async (req) => {
  const found = await c.detail(req.params.id);
  if (!found) throw new Error('creador no encontrado');
  return found;
}));

router.patch('/:id', wrap(async (req) => {
  const updated = await c.patch(req.params.id, req.body || {});
  if (!updated) throw new Error('nada que actualizar');
  return updated;
}));

router.post('/bulk', wrap(async (req) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) throw new Error('sin ids');
  const updated = await c.bulk(ids, String(req.body?.action || ''));
  return { ok: true, updated };
}));

router.post('/merge', wrap(async (req) => {
  const { keep_id: keepId, merge_id: mergeId } = req.body || {};
  if (!keepId || !mergeId) throw new Error('faltan keep_id y merge_id');
  await c.merge(keepId, mergeId);
  return { ok: true };
}));

router.post('/:id/re-resolve', wrap(async (req) => {
  const out = await c.forceResolve(req.params.id);
  if (!out) throw new Error('creador no encontrado');
  return out;
}));

module.exports = router;
