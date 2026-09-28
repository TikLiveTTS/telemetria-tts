'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const app = require('./app');

test('shutdown actualiza solo los creadores de las plataformas de la sesion', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1 ? { rows: [{ platforms_used: ['twitch'] }] } : { rows: [] };
    },
  };

  await app.handle(
    { client, machine_id: 'machine-1', session_id: 'session-1' },
    { name: 'shutdown', ts: '2026-09-27T00:00:00Z', props: { duration_minutes: 5 } }
  );

  assert.match(queries[2].sql, /platform = ANY\(\$3::text\[\]\)/);
  assert.deepEqual(queries[2].params, ['machine-1', 5, ['twitch']]);
});
