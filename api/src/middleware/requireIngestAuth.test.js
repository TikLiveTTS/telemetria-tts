'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const secrets = { 'machine-a': 'a'.repeat(64), 'machine-b': 'b'.repeat(64) };
const sessionOwners = { '11111111-1111-1111-1111-111111111111': 'machine-b' };
const committed = [];

function fakeQuery(sql, params) {
  if (sql.includes('SELECT ingest_secret')) {
    const secret = secrets[params[0]];
    return { rows: secret ? [{ ingest_secret: secret }] : [] };
  }
  if (sql.includes('SELECT machine_id FROM sessions')) {
    const owner = sessionOwners[params[0]];
    return { rows: owner ? [{ machine_id: owner }] : [] };
  }
  if (sql === 'COMMIT') committed.push(true);
  return { rows: [{}], rowCount: 1 };
}

function stub(file, exports) {
  const id = path.join(__dirname, '..', file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('config.js', { ingestToken: 'shared-token', maxEventsPerBatch: 100 });
stub('db.js', {
  pool: {
    query: async (sql, params) => fakeQuery(sql, params),
    connect: async () => ({ query: async (sql, params) => fakeQuery(sql, params), release() {} }),
  },
});
stub('geo.js', {
  geoFromIp: async () => ({ lat: null }),
  clientIp: () => '1.2.3.4',
  normalizeIp: (ip) => ip,
  nullGeo: () => ({ lat: null }),
});

const { requireIngestAuth, sign } = require('./requireIngestAuth');
const { ingestHandler, ingestStatus } = require('../ingest');

const SESSION = '22222222-2222-2222-2222-222222222222';
let nonceSeq = 0;

function request({ machineId, sessionId = SESSION, secret, headers = {} }) {
  const body = {
    machine_id: machineId, session_id: sessionId, os: {},
    events: [{ connector: 'unknown', name: 'noop', props: {} }],
  };
  const all = { ...headers };
  if (secret) {
    const signed = { machineId, sessionId, ts: String(Date.now()), nonce: `n${++nonceSeq}` };
    all['x-ingest-ts'] = signed.ts;
    all['x-ingest-nonce'] = signed.nonce;
    all['x-ingest-signature'] = sign(secret, signed);
  }
  return { body, get: (h) => all[h.toLowerCase()] };
}

function run(req) {
  return new Promise((resolve) => {
    const res = {
      status(code) { this.code = code; return this; },
      json() { resolve(this.code); },
    };
    requireIngestAuth(req, res, (err) => resolve(err || 'next'));
  });
}

test('acepta un batch firmado con el secreto de su machine_id', async () => {
  assert.equal(await run(request({ machineId: 'machine-a', secret: secrets['machine-a'] })), 'next');
});

test('rechaza un batch firmado con el secreto de otra maquina', async () => {
  assert.equal(await run(request({ machineId: 'machine-a', secret: secrets['machine-b'] })), 401);
});

test('rechaza machine_id sin secreto registrado', async () => {
  assert.equal(await run(request({ machineId: 'machine-x', secret: 'c'.repeat(64) })), 401);
});

test('rechaza reuso de nonce y ts fuera de ventana', async () => {
  const req = request({ machineId: 'machine-a', secret: secrets['machine-a'] });
  assert.equal(await run(req), 'next');
  assert.equal(await run(req), 401);

  const stale = { machineId: 'machine-a', sessionId: SESSION, ts: String(Date.now() - 6 * 60 * 1000), nonce: 'old' };
  const headers = { 'x-ingest-ts': stale.ts, 'x-ingest-nonce': stale.nonce, 'x-ingest-signature': sign(secrets['machine-a'], stale) };
  assert.equal(await run(request({ machineId: 'machine-a', headers })), 401);
});

test('sin firma usa el token compartido (legacy) y lo cuenta', async () => {
  const before = ingestStatus().legacy_ingest_batches;
  assert.equal(await run(request({ machineId: 'machine-a', headers: { 'x-ingest-token': 'shared-token' } })), 'next');
  assert.equal(await run(request({ machineId: 'machine-a', headers: { 'x-ingest-token': 'mal' } })), 401);
  // Firma incompleta = legacy.
  assert.equal(await run(request({ machineId: 'machine-a', headers: { 'x-ingest-signature': 'ab', 'x-ingest-token': 'shared-token' } })), 'next');
  assert.equal(ingestStatus().legacy_ingest_batches, before + 2);
});

test('rechaza el batch si el session_id pertenece a otra maquina', async () => {
  const res = { status() { return this; }, json() {} };
  committed.length = 0;
  await ingestHandler(request({ machineId: 'machine-a', sessionId: '11111111-1111-1111-1111-111111111111' }), res);
  assert.equal(committed.length, 0);
  await ingestHandler(request({ machineId: 'machine-b', sessionId: '11111111-1111-1111-1111-111111111111' }), res);
  assert.equal(committed.length, 1);
});
