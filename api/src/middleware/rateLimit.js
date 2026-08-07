'use strict';

const { clientIp } = require('../geo');

// Ventana deslizante simple por IP, en memoria. Suficiente para un servicio de
// una sola instancia; si algun dia hay varias replicas habria que moverlo a
// Postgres o Redis.
function makeRateLimit({ max, windowMs, message = 'Too many requests' }) {
  const hits = new Map();

  // Limpieza periodica para que el Map no crezca sin fin.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, w] of hits) if (now > w.reset) hits.delete(ip);
  }, Math.max(windowMs, 60000));
  if (sweep.unref) sweep.unref();

  return function rateLimit(req, res, next) {
    const ip = clientIp(req) || 'unknown';
    const now = Date.now();
    const w = hits.get(ip) || { count: 0, reset: now + windowMs };
    if (now > w.reset) {
      w.count = 0;
      w.reset = now + windowMs;
    }
    w.count++;
    hits.set(ip, w);

    if (w.count > max) {
      res.setHeader('Retry-After', Math.ceil((w.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { makeRateLimit };
