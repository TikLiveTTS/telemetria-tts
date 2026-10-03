'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const blockedWords = require('./blocked-words');
const hash = 'a'.repeat(64);
const props = (words, snapshot_at = '2026-10-03T00:00:00Z') => ({ words, lang: 'es', snapshot_at, list_hash: hash });

test('sanea palabras y conserva la ñ', () => {
  assert.equal(blockedWords.normalizeWord('  ÁRBOL  '), 'arbol');
  assert.equal(blockedWords.normalizeWord('NIÑO'), 'niño');
  for (const value of ['@persona', 'https://ejemplo.com', 'a@b.com', '123456', 'una dos tres cuatro', 'x'.repeat(41)]) {
    assert.equal(blockedWords.normalizeWord(value), null, value);
  }
});

test('un snapshot idempotente deduplica palabras y nunca se inserta en events', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  const event = { name: 'blocked_words_snapshot', ts: '2026-10-03T00:00:00Z', props: props(['Árbol', 'arbol', 'niño']) };

  assert.equal(await blockedWords.handle({ client, machine_id: 'machine-1' }, event), false);
  assert.equal(await blockedWords.handle({ client, machine_id: 'machine-1' }, event), false);
  assert.equal(calls.length, 8);
  assert.deepEqual(calls[1].params[0], ['arbol', 'niño']);
  assert.doesNotMatch(calls.map((call) => call.sql).join('\n'), /DELETE FROM installation_blocked_words/);
});

test('cinco instalaciones con listas solapadas cuentan usuarios distintos', () => {
  const snapshots = [
    ['spam', 'flood'], ['spam'], ['spam', 'caps'], ['caps'], ['spam', 'caps'],
  ];
  const counts = new Map();
  snapshots.forEach((words, installation) => {
    for (const word of new Set(words)) {
      if (!counts.has(word)) counts.set(word, new Set());
      counts.get(word).add(installation);
    }
  });
  assert.equal(counts.get('spam').size, 4);
  assert.equal(counts.get('caps').size, 3);
  assert.equal(counts.get('flood').size, 1);
  assert.deepEqual([...counts].filter(([, users]) => users.size >= 3).map(([word]) => word), ['spam', 'caps']);
});

test('una palabra inválida se descarta sin rechazar el resto de la lista', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  const result = await blockedWords.handle(
    { client, machine_id: 'machine-1' },
    { name: 'blocked_words_snapshot', ts: new Date(), props: props(['@privado', 'spam', 'https://x.com']) }
  );
  assert.equal(result, false);
  assert.deepEqual(calls[1].params[0], ['spam']);
});

test('un payload mal formado no escribe nada', async () => {
  const calls = [];
  const client = { query: async (...args) => calls.push(args) };
  const bad = { words: 'no-es-lista', snapshot_at: '2026-10-03T00:00:00Z', list_hash: hash };
  const result = await blockedWords.handle({ client, machine_id: 'machine-1' }, { name: 'blocked_words_snapshot', props: bad });
  assert.equal(result, false);
  assert.equal(calls.length, 0);
});

test('quitar una palabra del snapshot no la elimina ni baja su conteo', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  await blockedWords.handle({ client, machine_id: 'machine-1' }, {
    name: 'blocked_words_snapshot', props: props(['spam', 'flood'], '2026-10-02T00:00:00Z'),
  });
  await blockedWords.handle({ client, machine_id: 'machine-1' }, {
    name: 'blocked_words_snapshot', props: props(['spam'], '2026-10-03T00:00:00Z'),
  });
  assert.deepEqual(calls[5].params[0], ['spam']);
  assert.doesNotMatch(calls.map((call) => call.sql).join('\n'), /DELETE FROM installation_blocked_words/);
});

test('snapshot viejo o idéntico no pisa uno nuevo', async () => {
  const saved = { snapshot_at: '2026-10-03T00:00:00Z', list_hash: hash };
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [saved] }; } };
  const ctx = { client, machine_id: 'machine-1' };
  await blockedWords.handle(ctx, { name: 'blocked_words_snapshot', props: props(['nuevo'], '2026-10-02T00:00:00Z') });
  await blockedWords.handle(ctx, { name: 'blocked_words_snapshot', props: props(['nuevo'], '2026-10-03T00:00:00Z') });
  assert.equal(calls.length, 2);
});
