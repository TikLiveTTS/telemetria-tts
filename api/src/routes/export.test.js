'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { csvCell, exportCell } = require('../export-cells');

test('escapa inyección de fórmulas en CSV y TSV', () => {
  for (const value of ['=SUM(A1:A2)', '+1', '-1', '@cmd']) {
    assert.match(csvCell(value), /^'/);
    assert.match(exportCell(value, '\t'), /^'/);
  }
  assert.equal(exportCell('a\tb\n', '\t'), 'a b ');
});
