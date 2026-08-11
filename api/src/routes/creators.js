'use strict';

const express = require('express');
const c = require('../queries/creators');

const router = express.Router();

function wrap(fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err) {
      console.error('[creators]', err.message);
      res.status(400).json({ error: err.message });
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
