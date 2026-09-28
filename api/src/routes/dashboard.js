'use strict';

const express = require('express');
const q = require('../queries/dashboard');
const config = require('../config');
const { runRollup, purgeOldEvents } = require('../jobs');

const router = express.Router();

// `days` viene del selector de periodo de la cabecera. Se acota para que
// nadie pueda pedir una ventana absurda y tumbar la DB.
function periodDays(req, def = 30) {
  const n = parseInt(req.query.days, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(3650, Math.max(1, n));
}

function wrap(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      console.error('[dashboard]', err.message);
      res.status(500).json({ error: err.message });
    }
  };
}

router.get('/summary',    wrap((req) => q.summary(periodDays(req))));
router.get('/daily',      wrap((req) => q.daily(periodDays(req))));
router.get('/retention',  wrap(() => q.retention()));
router.get('/platforms',  wrap((req) => q.platformMix(periodDays(req))));
router.get('/versions',   wrap(() => q.versions()));
router.get('/features',   wrap((req) => q.features(periodDays(req))));
router.get('/geo/countries', wrap((req) => q.countries(Math.min(50, parseInt(req.query.limit, 10) || 10))));
router.get('/geo/live',      wrap(() => q.liveMap()));
router.get('/errors',        wrap((req) => q.errors(periodDays(req))));

router.get('/features/:connector', wrap((req) =>
  q.featureDetail(req.params.connector, periodDays(req))
));

router.get('/sessions', wrap((req) => q.sessions({
  page: Math.max(1, parseInt(req.query.page, 10) || 1),
  pageSize: Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50)),
  platform: req.query.platform || null,
  country: req.query.country || null,
  version: req.query.version || null,
  q: req.query.q || null,
})));

router.get('/sessions/:id/events', wrap((req) => q.sessionEvents(req.params.id)));

router.get('/status', wrap(async () => ({
  ...(await q.systemStatus()),
  retention_days: config.retentionDays,
  timezone: config.tzDisplay,
  anonymize_ip: config.anonymizeIp,
  public_origin: config.publicOrigin,
})));

// Acciones de mantenimiento desde la pagina Ajustes.
router.post('/maintenance/rollup', wrap(async () => ({ ok: true, rows: await runRollup(90) })));
router.post('/maintenance/purge',  wrap(async () => ({ ok: true, deleted: await purgeOldEvents() })));

module.exports = router;
