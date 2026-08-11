'use strict';

const config = require('./config');

// Resolucion IP → pais/ciudad/coordenadas via ip-api.com (gratis, 45 req/min).
// Cache en memoria para no gastar cuota: la misma IP se resuelve una vez.

const CACHE_MAX = 50000;
const cache = new Map();

const PRIVATE_RE = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|fc00:|fd)/i;

function nullGeo() {
  return { country: null, country_code: null, city: null, lat: null, lon: null };
}

// Devuelve la IP tal cual o truncada, segun ANONYMIZE_IP.
function normalizeIp(raw) {
  if (!raw) return null;
  const ip = String(raw).replace(/^::ffff:/, '').trim();
  if (!ip) return null;
  if (!config.anonymizeIp) return ip;

  if (ip.includes(':')) {
    // IPv6 → se conservan los 3 primeros grupos (/48)
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + '::';
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

// Extrae la IP del cliente. Solo confia en X-Forwarded-For si TRUST_PROXY
// esta activo: con el puerto expuesto directo, cualquiera podria falsearla.
function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) {
      const first = String(fwd).split(',')[0].trim();
      if (first) return first.replace(/^::ffff:/, '');
    }
  }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

async function geoFromIp(ip) {
  const clean = String(ip || '').replace(/^::ffff:/, '').trim();
  if (!clean || PRIVATE_RE.test(clean)) return nullGeo();
  if (cache.has(clean)) return cache.get(clean);

  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,country,countryCode,city,lat,lon`,
      { signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    const geo = data && data.status === 'success'
      ? {
          country: data.country || null,
          country_code: data.countryCode || null,
          city: data.city || null,
          lat: typeof data.lat === 'number' ? data.lat : null,
          lon: typeof data.lon === 'number' ? data.lon : null,
        }
      : nullGeo();

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(clean, geo);
    return geo;
  } catch (_) {
    // Fallo de red o rate limit: no cachear, se reintenta la proxima vez.
    return nullGeo();
  }
}

module.exports = { geoFromIp, nullGeo, clientIp, normalizeIp };
