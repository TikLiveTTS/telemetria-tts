'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./config');
const { pool, waitForDb } = require('./db');
const { migrate } = require('../db/migrate');
const jobs = require('./jobs');

const { ingestHandler, legacyPingHandler } = require('./ingest');
const { makeRateLimit } = require('./middleware/rateLimit');
const { requireAuth } = require('./middleware/requireAuth');
const { requireIngestToken } = require('./middleware/requireIngestToken');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const creatorRoutes = require('./routes/creators');
const exportRoutes = require('./routes/export');
const publicRoutes = require('./routes/public');
const healthRoutes = require('./routes/health');

const WEB_DIR = path.join(__dirname, '..', 'web');
const app = express();

// Solo se confia en X-Forwarded-For si esta detras de un proxy declarado.
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(helmet({
  // El panel es todo local (mismo origen, sin CDN), asi que se puede cerrar
  // la CSP de verdad en vez de desactivarla.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'], // avatares de TikTok/Twitch/YouTube
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // para /embed/creators.js
}));

app.use(cookieParser());
app.use(express.json({ limit: config.maxBodyBytes }));

// ── Publico ────────────────────────────────────────────────────────────────
app.use(healthRoutes);
app.use(publicRoutes);

const ingestLimit = makeRateLimit({ max: 60, windowMs: 60 * 1000 });
app.post('/api/ingest', requireIngestToken, ingestLimit, ingestHandler);
app.post('/api/ping', requireIngestToken, ingestLimit, legacyPingHandler);

app.use('/api/auth', authRoutes);

// ── Protegido ──────────────────────────────────────────────────────────────
app.use('/api/dashboard/creators', requireAuth, creatorRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/export', requireAuth, exportRoutes);

// ── Frontend ───────────────────────────────────────────────────────────────
// Chart.js se sirve desde node_modules: sin CDN y sin vendorizar a mano.
// Se monta el directorio por ruta de disco en vez de require.resolve porque el
// "exports" de chart.js no expone sus subrutas.
app.use('/vendor', express.static(
  path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist'),
  { index: false, maxAge: '30d' }
));

app.use(express.static(WEB_DIR, { extensions: ['html'] }));

// El panel es una SPA con router por hash: cualquier ruta no-API devuelve el
// shell y el cliente decide que pintar.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// ── Arranque ───────────────────────────────────────────────────────────────
async function main() {
  await waitForDb();
  await migrate();
  jobs.start();

  const server = app.listen(config.port, () => {
    console.log(`[api] escuchando en :${config.port}`);
    console.log(`[api] zona horaria de visualizacion: ${config.tzDisplay}`);
    console.log(`[api] retencion de eventos: ${config.retentionDays} dias`);
    if (config.publicOrigin.includes('*')) {
      console.log('[api] aviso: PUBLIC_ORIGIN=* — /api/public/* es legible desde cualquier web');
    }
  });

  const shutdown = async (signal) => {
    console.log(`[api] ${signal} recibido, cerrando...`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[api] fallo al arrancar:', err.message);
  process.exit(1);
});
