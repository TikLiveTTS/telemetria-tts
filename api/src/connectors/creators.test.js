'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const creators = require('./creators');

test('registra un creador de Kick con su URL canonica', async () => {
  const queries = [];
  const client = { query: async (sql, params) => queries.push({ sql, params }) };

  await creators.handle(
    {
      client,
      machine_id: 'machine-1',
      app_version: '1.0.0',
      geo: { country: 'EC' },
      install: { user_id: 'user-1' },
    },
    { name: 'seen', ts: '2026-09-28T00:00:00Z', props: { platform: 'kick', username: 'streamer' } }
  );

  assert.equal(queries[0].params[4], 'https://kick.com/streamer');
});
