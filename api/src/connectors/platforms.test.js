'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const platforms = require('./platforms');

test('registra conexiones de Kick en la sesion', async () => {
  const queries = [];
  const client = { query: async (sql, params) => queries.push({ sql, params }) };

  await platforms.handle(
    { client, session_id: 'session-1' },
    { name: 'connected', props: { platform: 'kick' } }
  );

  assert.deepEqual(queries[0].params, ['session-1', 'kick']);
});
