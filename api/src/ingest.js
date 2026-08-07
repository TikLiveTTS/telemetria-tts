'use strict';

const crypto = require('crypto');
const { pool } = require('./db');
const { geoFromIp, clientIp, normalizeIp, nullGeo } = require('./geo');
const connectors = require('./connectors');
const { parseBatch } = require('./middleware/validate');

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
  // "Primera vez" = no hay ninguna OTRA sesion de esta maquina.
  const { rows: prev } = await client.query(
    'SELECT 1 FROM sessions WHERE machine_id = $1 AND session_id <> $2 LIMIT 1',
    [payload.machine_id, payload.session_id]
  );

  const { rowCount } = await client.query(
    `INSERT INTO sessions
       (session_id, machine_id, app_version, os_release,
        country, country_code, city, lat, lon, ip,
        platforms_used, started_at, first_seen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}',$11,$12)
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

// Procesa un batch ya validado. Todo ocurre dentro de una transaccion: o entra
// el batch entero, o no entra nada.
async function processBatch(payload, geo, ip) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const install = await upsertInstall(client, payload, geo, ip);
    await ensureSession(client, payload, geo, ip);

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

      await connector.handle(ctx, event);

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
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ingest]', err.message);
  } finally {
    client.release();
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

module.exports = { ingestHandler, legacyPingHandler };
