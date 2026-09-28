'use strict';

const crypto = require('crypto');
const { pool } = require('../db');
const { requireIngestToken } = require('./requireIngestToken');
const { recordLegacyIngest } = require('../ingest');

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

// ponytail: nonces en memoria, se pierden al reiniciar la API (una firma de los
// ultimos 5 min podria reusarse una vez tras un reinicio). Moverlo a Redis/PG
// si hay varias replicas o si ese hueco importa.
const recentNonces = new Map(); // machine_id -> Map(nonce -> visto_en_ms)

const sweep = setInterval(() => {
  const cutoff = Date.now() - SIGNATURE_WINDOW_MS;
  for (const [machineId, nonces] of recentNonces) {
    for (const [nonce, seenAt] of nonces) if (seenAt < cutoff) nonces.delete(nonce);
    if (nonces.size === 0) recentNonces.delete(machineId);
  }
}, 60 * 1000);
if (sweep.unref) sweep.unref();

function readSignedRequest(req) {
  const signature = req.get('X-Ingest-Signature');
  const ts = req.get('X-Ingest-Ts');
  const nonce = req.get('X-Ingest-Nonce');
  const body = req.body || {};
  if (!signature || !ts || !nonce || !body.machine_id || !body.session_id) return null;
  return {
    signature, ts, nonce,
    machineId: String(body.machine_id),
    sessionId: String(body.session_id),
  };
}

function hexEqual(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// X-Ingest-Ts: epoch en milisegundos.
function isFresh(ts) {
  const sentAt = Number(ts);
  return Number.isFinite(sentAt) && Math.abs(Date.now() - sentAt) <= SIGNATURE_WINDOW_MS;
}

function consumeNonce(machineId, nonce) {
  const nonces = recentNonces.get(machineId) || new Map();
  if (nonces.has(nonce)) return false;
  nonces.set(nonce, Date.now());
  recentNonces.set(machineId, nonces);
  return true;
}

async function findIngestSecret(machineId) {
  const { rows } = await pool.query(
    'SELECT ingest_secret FROM installs WHERE machine_id = $1 AND ingest_secret IS NOT NULL',
    [machineId]
  );
  return rows.length ? rows[0].ingest_secret : null;
}

function sign(secret, { machineId, sessionId, ts, nonce }) {
  return crypto.createHmac('sha256', secret)
    .update(`${machineId}.${sessionId}.${ts}.${nonce}`)
    .digest('hex');
}

async function verifySignedRequest(signed) {
  if (!isFresh(signed.ts)) return false;
  const secret = await findIngestSecret(signed.machineId);
  if (!secret || !hexEqual(sign(secret, signed), signed.signature)) return false;
  return consumeNonce(signed.machineId, signed.nonce);
}

// Firma HMAC por instalacion; sin cabeceras de firma completas cae al token
// compartido (clientes viejos o a medio actualizar).
async function requireIngestAuth(req, res, next) {
  const signed = readSignedRequest(req);
  if (!signed) {
    return requireIngestToken(req, res, () => {
      recordLegacyIngest();
      next();
    });
  }
  try {
    if (!(await verifySignedRequest(signed))) return res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    return next(err);
  }
  next();
}

module.exports = { requireIngestAuth, sign };
