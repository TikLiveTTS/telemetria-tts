'use strict';

const express = require('express');
const q = require('../queries/dashboard');
const config = require('../config');
const { runRollup, purgeOldEvents } = require('../jobs');
const { ingestStatus } = require('../ingest');
const blockedWords = require('../queries/blocked-words');

const router = express.Router();

// `days` viene del selector de periodo de la cabecera. Se acota para que
// nadie pueda pedir una ventana absurda y tumbar la DB.
function periodDays(req, def = 30) {
  const n = parseInt(req.query.days, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(3650, Math.max(1, n));
}

function blockedWordsOptions(req) {
  const k = parseInt(req.query.k, 10);
  const page = parseInt(req.query.page, 10);
  const pageSize = parseInt(req.query.pageSize, 10);
  const lang = typeof req.query.lang === 'string' ? req.query.lang.slice(0, 16) : null;
  const prefix = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : null;
  return {
    days: periodDays(req),
    k: Number.isFinite(k) ? Math.min(100000, Math.max(1, k)) : config.blockedWordsK,
    page: Number.isFinite(page) ? Math.max(1, page) : 1,
    pageSize: Number.isFinite(pageSize) ? Math.min(200, Math.max(1, pageSize)) : 50,
    lang, prefix,
  };
}

function wrap(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      console.error('[dashboard]', err.message);
      res.status(500).json({ error: 'Error interno' });
    }
  };
}

router.get('/summary',    wrap((req) => q.summary(periodDays(req))));
router.get('/daily',      wrap((req) => q.daily(periodDays(req))));
router.get('/retention',  wrap(() => q.retention()));
router.get('/platforms',  wrap((req) => q.platformMix(periodDays(req))));
router.get('/versions',   wrap((req) => q.versions(periodDays(req))));
router.get('/features',   wrap((req) => q.features(periodDays(req))));
router.get('/geo/countries', wrap((req) => q.countries(Math.min(50, parseInt(req.query.limit, 10) || 10))));
router.get('/geo/live',      wrap(() => q.liveMap()));
router.get('/geo/history',   wrap(() => q.geoHistory()));
router.get('/blocked-words', wrap((req) => blockedWords.ranking(blockedWordsOptions(req))));
router.get('/blocked-words/summary', wrap((req) => blockedWords.summary(blockedWordsOptions(req))));

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

router.get('/installs/:machineId', async (req, res) => {
  try {
    const profile = await q.installProfile(req.params.machineId);
    if (!profile) return res.status(404).json({ error: 'Instalacion no encontrada' });
    res.json(profile);
  } catch (err) {
    console.error('[dashboard]', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/sessions/:id/events', wrap((req) => q.sessionEvents(req.params.id)));

router.get('/status', wrap(async () => ({
  ...(await q.systemStatus()),
  ...ingestStatus(),
  retention_days: config.retentionDays,
  timezone: config.tzDisplay,
  anonymize_ip: config.anonymizeIp,
  public_origin: config.publicOrigin,
  glitchtip_issues_url: config.glitchtipIssuesUrl,
})));

// Acciones de mantenimiento desde la pagina Ajustes.
router.post('/maintenance/rollup', wrap(async () => ({ ok: true, rows: await runRollup(90) })));
router.post('/maintenance/purge',  wrap(async () => ({ ok: true, deleted: await purgeOldEvents() })));

module.exports = router;
