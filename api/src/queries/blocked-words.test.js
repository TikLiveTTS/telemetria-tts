'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('la consulta aplica k-anonimato y la migración borra en cascada', () => {
  const source = fs.readFileSync(path.join(__dirname, 'blocked-words.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'migrations', '009_blocked_words.sql'), 'utf8');
  const snapshots = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'migrations', '010_blocked_words_snapshots.sql'), 'utf8');
  assert.match(source, /HAVING COUNT\(DISTINCT ibw\.machine_id\) >=/);
  assert.match(migration, /machine_id TEXT NOT NULL REFERENCES installs\(machine_id\) ON DELETE CASCADE/);
  assert.match(source, /config\.activeDays/);
  assert.match(snapshots, /active_days = 0 OR/);
  assert.match(snapshots, /blocked_word_weekly/);
});
