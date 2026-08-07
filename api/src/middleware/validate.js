'use strict';

const config = require('./../config');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[a-zA-Z0-9_.:-]{4,128}$/;
const NAME_RE = /^[a-z0-9_]{1,40}$/;

function str(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// Normaliza y valida un batch de ingesta (schema v2). Devuelve
// { ok: true, payload } o { ok: false, error }.
function parseBatch(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body invalido' };

  const machine_id = str(body.machine_id, 128);
  const session_id = str(body.session_id, 64);

  if (!machine_id || !ID_RE.test(machine_id)) return { ok: false, error: 'machine_id invalido' };
  if (!session_id || !UUID_RE.test(session_id)) return { ok: false, error: 'session_id invalido' };

  const os = body.os && typeof body.os === 'object' ? body.os : {};
  const rawEvents = Array.isArray(body.events) ? body.events : [];
  if (rawEvents.length === 0) return { ok: false, error: 'events vacio' };
  if (rawEvents.length > config.maxEventsPerBatch) {
    return { ok: false, error: `maximo ${config.maxEventsPerBatch} eventos por batch` };
  }

  const events = [];
  for (const raw of rawEvents) {
    if (!raw || typeof raw !== 'object') continue;
    const connector = str(raw.connector, 40);
    const name = str(raw.name, 40);
    if (!connector || !NAME_RE.test(connector)) continue;
    if (!name || !NAME_RE.test(name)) continue;

    // Timestamp del cliente, pero acotado: un reloj desajustado no debe
    // ensuciar las series temporales con eventos en el año 2087.
    let ts = raw.ts ? new Date(raw.ts) : new Date();
    if (Number.isNaN(ts.getTime())) ts = new Date();
    const now = Date.now();
    if (ts.getTime() > now + 5 * 60 * 1000) ts = new Date(now);
    if (ts.getTime() < now - 30 * 24 * 3600 * 1000) ts = new Date(now - 30 * 24 * 3600 * 1000);

    const props = raw.props && typeof raw.props === 'object' && !Array.isArray(raw.props)
      ? raw.props
      : {};

    events.push({ connector, name, ts, props });
  }

  if (events.length === 0) return { ok: false, error: 'ningun evento valido' };

  return {
    ok: true,
    payload: {
      machine_id,
      session_id,
      app_version: str(body.app_version, 32),
      os: {
        platform: str(os.platform, 32),
        release: str(os.release, 64),
        arch: str(os.arch, 16),
        locale: str(os.locale, 16),
      },
      events,
    },
  };
}

module.exports = { parseBatch, str, UUID_RE };
