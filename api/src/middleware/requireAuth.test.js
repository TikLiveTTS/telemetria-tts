'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { requireSession } = require('./requireAuth');

test('sin sesión de administración devuelve 401', () => {
  let status;
  let body;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; } };
  requireSession(null, {}, res, () => assert.fail('no debe continuar'));
  assert.equal(status, 401);
  assert.deepEqual(body, { error: 'Unauthorized' });
});
