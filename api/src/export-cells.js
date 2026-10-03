'use strict';

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v)
    ? v.join('|')
    : (v instanceof Date ? v.toISOString() : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function exportCell(value, separator) {
  const safe = /^[=+\-@]/.test(String(value ?? '')) ? `'${value}` : String(value ?? '');
  if (separator === '\t') return safe.replace(/[\t\r\n]/g, ' ');
  return csvCell(safe);
}

module.exports = { csvCell, exportCell };
