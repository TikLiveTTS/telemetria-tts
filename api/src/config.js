'use strict';

// Lee y valida el entorno. Falla rapido y con un mensaje claro si falta algo,
// en vez de arrancar a medias con valores por defecto peligrosos.

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    console.error(`[config] falta la variable de entorno obligatoria: ${name}`);
    process.exit(1);
  }
  return String(v).trim();
}

function bool(name, def) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function int(name, def) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : def;
}

const config = {
  port: int('PORT', 4000),
  postgresUrl: required('POSTGRES_URL'),

  adminUser: required('ADMIN_USER'),
  adminPassword: required('ADMIN_PASSWORD'),
  sessionSecret: required('SESSION_SECRET'),
  sessionHours: int('SESSION_HOURS', 12),

  ingestToken: required('INGEST_TOKEN'),

  retentionDays: int('RETENTION_DAYS', 365),
  anonymizeIp: bool('ANONYMIZE_IP', false),
  trustProxy: bool('TRUST_PROXY', false),

  tzDisplay: (process.env.TZ_DISPLAY || 'America/Guayaquil').trim(),
  // Lista separada por comas. "*" en cualquier posicion permite cualquier origen.
  // Cada entrada admite un unico comodin "*" (ej. "https://foo-*-bar.vercel.app")
  // para cubrir hashes de preview sin listarlos uno a uno.
  publicOrigin: (process.env.PUBLIC_ORIGIN || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Limites de la ingesta
  maxEventsPerBatch: int('MAX_EVENTS_PER_BATCH', 50),
  maxBodyBytes: int('MAX_BODY_BYTES', 64 * 1024),
};

if (config.sessionSecret.length < 16) {
  console.error('[config] SESSION_SECRET es demasiado corto (minimo 16 caracteres)');
  process.exit(1);
}

module.exports = config;
