'use strict';

const crypto = require('crypto');
const { pool } = require('./db');
const { geoFromIp, clientIp, normalizeIp, nullGeo } = require('./geo');
const connectors = require('./connectors');
const { parseBatch, ID_RE } = require('./middleware/validate');

// ponytail: se reinicia al reiniciar la API; persistirla cuando haga falta historial entre reinicios.
const ingestFailures = { batches: 0, events: 0 };
// ponytail: idem, cuenta batches aceptados con el token compartido (clientes sin firma HMAC).
let legacyIngestCount = 0;

class SessionOwnershipError extends Error {}

function recordIngestFailure(payload, err) {
  ingestFailures.batches += 1;
  ingestFailures.events += payload.events.length;
  console.error('[ingest] persistence_failed', {
    error: err.message,
    machine_id: payload.machine_id,
    events_lost: payload.events.length,
  });
}

function ingestStatus() {
  return {
    ingest_failed_batches: ingestFailures.batches,
    ingest_failed_events: ingestFailures.events,
    legacy_ingest_batches: legacyIngestCount,
  };
}

function recordLegacyIngest() {
  legacyIngestCount += 1;
}

// Identificador corto y estable que se muestra en el panel. Se genera una
// sola vez por instalacion y no vuelve a cambiar.
function newUserId() {
  return 'usr_' + crypto.randomBytes(4).toString('hex');
}

// Crea o actualiza la fila de `installs` y devuelve su estado actual.
async function upsertInstall(client, payload, geo, ip) {
  const { rows } = await client.query(
    `INSERT INTO installs
       (machine_id, user_id, app_version, os_platform, os_release, os_arch, locale,
        country, country_code, city, lat, lon, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (machine_id) DO UPDATE SET
       last_seen_at = NOW(),
       app_version  = COALESCE(EXCLUDED.app_version, installs.app_version),
       os_platform  = COALESCE(EXCLUDED.os_platform, installs.os_platform),
       os_release   = COALESCE(EXCLUDED.os_release, installs.os_release),
       os_arch      = COALESCE(EXCLUDED.os_arch, installs.os_arch),
       locale       = COALESCE(EXCLUDED.locale, installs.locale),
       country      = COALESCE(EXCLUDED.country, installs.country),
       country_code = COALESCE(EXCLUDED.country_code, installs.country_code),
       city         = COALESCE(EXCLUDED.city, installs.city),
       lat          = COALESCE(EXCLUDED.lat, installs.lat),
       lon          = COALESCE(EXCLUDED.lon, installs.lon),
       ip           = COALESCE(EXCLUDED.ip, installs.ip)
     RETURNING machine_id, user_id, first_seen_at`,
    [
      payload.machine_id, newUserId(), payload.app_version,
      payload.os.platform, payload.os.release, payload.os.arch, payload.os.locale,
      geo.country, geo.country_code, geo.city, geo.lat, geo.lon, ip,
    ]
  );
  return rows[0];
}

// Garantiza que exista la fila de `sessions` ANTES de procesar ningun evento.
// Si se dejara en manos del evento `startup`, un batch reenviado desde la cola
// en disco cuyo startup se perdio dejaria caer todos los demas eventos por la
// clave foranea.
async function ensureSession(client, payload, geo, ip) {
  // Una firma valida de una maquina no la autoriza a escribir en sesiones ajenas.
  const { rows: owner } = await client.query(
    'SELECT machine_id FROM sessions WHERE session_id = $1',
    [payload.session_id]
  );
  if (owner.length && owner[0].machine_id !== payload.machine_id) {
    throw new SessionOwnershipError('session_id pertenece a otra maquina');
  }

  // "Primera vez" = no hay ninguna OTRA sesion de esta maquina.
  const { rows: prev } = await client.query(
    'SELECT 1 FROM sessions WHERE machine_id = $1 AND session_id <> $2 LIMIT 1',
    [payload.machine_id, payload.session_id]
  );

  const { rowCount } = await client.query(
    `INSERT INTO sessions
       (session_id, machine_id, app_version, os_release,
        country, country_code, city, lat, lon, ip,
        platforms_used, started_at, last_heartbeat_at, first_seen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}',$11,$11,$12)
     ON CONFLICT (session_id) DO NOTHING`,
    [
      payload.session_id, payload.machine_id, payload.app_version, payload.os.release,
      geo.country, geo.country_code, geo.city, geo.lat, geo.lon, ip,
      payload.events[0].ts, prev.length === 0,
    ]
  );

  // total_sessions se incrementa al crear la sesion, no en el evento startup:
  // asi un startup duplicado no infla el contador.
  if (rowCount > 0) {
    await client.query(
      'UPDATE installs SET total_sessions = total_sessions + 1 WHERE machine_id = $1',
      [payload.machine_id]
    );
  }
}

async function fillSessionGeo(client, sessionId, geo) {
  if (geo.lat === null) return;

  await client.query(
    `UPDATE sessions
       SET country = $2, country_code = $3, city = $4, lat = $5, lon = $6
     WHERE session_id = $1 AND lat IS NULL`,
    [sessionId, geo.country, geo.country_code, geo.city, geo.lat, geo.lon]
  );
}

// Procesa un batch ya validado. Todo ocurre dentro de una transaccion: o entra
// el batch entero, o no entra nada.
async function processBatch(payload, geo, ip) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const install = await upsertInstall(client, payload, geo, ip);
    await ensureSession(client, payload, geo, ip);
    await fillSessionGeo(client, payload.session_id, geo);

    const ctx = {
      client,
      install,
      machine_id: payload.machine_id,
      session_id: payload.session_id,
      app_version: payload.app_version,
      os: payload.os,
      geo,
      ip,
    };

    for (const event of payload.events) {
      const connector = connectors.get(event.connector);
      if (!connector) continue; // conector desconocido: se descarta en silencio

      const handled = await connector.handle(ctx, event);
      if (handled === false) continue;
      if (event.connector === 'app' && event.name === 'live') continue;

      await client.query(
        `INSERT INTO events (session_id, machine_id, connector, name, props, app_version, ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          payload.session_id, payload.machine_id, event.connector, event.name,
          JSON.stringify(event.props), payload.app_version, event.ts,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err instanceof SessionOwnershipError) {
      console.warn('[ingest] batch_rechazado', {
        error: err.message,
        machine_id: payload.machine_id,
        session_id: payload.session_id,
      });
    } else {
      recordIngestFailure(payload, err);
    }
  } finally {
    if (client) client.release();
  }
}

// Directivas que la app lee en la respuesta. Hoy solo una: los canales que el
// panel ha marcado para volver a resolver.
async function pendingDirectives(machineId) {
  try {
    const { rows } = await pool.query(
      `SELECT platform, username FROM creators
        WHERE machine_id = $1 AND force_resolve = TRUE
        LIMIT 10`,
      [machineId]
    );
    return rows.length ? { re_resolve: rows } : {};
  } catch (_) {
    return {};
  }
}

// POST /api/ingest — schema v2, batch de eventos.
async function ingestHandler(req, res) {
  const parsed = parseBatch(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const payload = parsed.payload;
  const rawIp = clientIp(req);

  // Se responde antes de tocar la DB: la app no debe esperar por la
  // telemetria, y un fallo aqui jamas debe degradar su experiencia.
  const directives = await pendingDirectives(payload.machine_id);
  res.status(202).json({ ok: true, directives });

  let geo = nullGeo();
  try {
    geo = await geoFromIp(rawIp);
  } catch (_) { /* la geolocalizacion es opcional */ }

  await processBatch(payload, geo, normalizeIp(rawIp));
}

// POST /api/ingest/register — alta del secreto HMAC de una instalacion. Lo
// genera el cliente; una vez fijado no se reemplaza ni se revela (409).
async function registerHandler(req, res, next) {
  const { machine_id: machineId, secret } = req.body || {};
  if (typeof machineId !== 'string' || !ID_RE.test(machineId)) {
    return res.status(400).json({ error: 'machine_id invalido' });
  }
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) {
    return res.status(400).json({ error: 'secret invalido' });
  }

  let registered;
  try {
    registered = await storeIngestSecret(machineId, secret);
  } catch (err) {
    return next(err);
  }
  if (!registered) return res.status(409).json({ error: 'machine_id ya registrado' });
  res.json({ ok: true });
}

// Solo fija el secreto si la instalacion aun no tiene uno.
async function storeIngestSecret(machineId, secret) {
  const { rowCount } = await pool.query(
    `INSERT INTO installs (machine_id, user_id, ingest_secret, ingest_secret_registered_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (machine_id) DO UPDATE SET
       ingest_secret = EXCLUDED.ingest_secret,
       ingest_secret_registered_at = EXCLUDED.ingest_secret_registered_at
     WHERE installs.ingest_secret IS NULL`,
    [machineId, newUserId(), secret]
  );
  return rowCount > 0;
}

// POST /api/ping — contrato v1 antiguo, traducido al conector `app`.
async function legacyPingHandler(req, res) {
  const b = req.body || {};
  const event = String(b.event || '');
  if (!['startup', 'heartbeat', 'shutdown'].includes(event)) {
    return res.status(400).json({ error: 'event invalido' });
  }

  const translated = {
    schema: 2,
    machine_id: b.machine_id,
    session_id: b.session_id,
    app_version: b.app_version,
    os: { platform: null, release: b.os_version, arch: null, locale: null },
    events: [{
      connector: 'app',
      name: event,
      ts: new Date().toISOString(),
      props: {
        duration_minutes: b.session_duration_minutes,
        platforms_used: b.platforms_used,
      },
    }],
  };

  req.body = translated;
  return ingestHandler(req, res);
}

module.exports = {
  ingestHandler,
  legacyPingHandler,
  registerHandler,
  ingestStatus,
  recordLegacyIngest,
};
