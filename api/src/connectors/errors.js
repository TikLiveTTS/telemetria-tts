'use strict';

const crypto = require('crypto');

// Errores de la app. Ademas de la fila generica en `events`, van a su propia
// tabla con una firma estable para poder agruparlos en el panel.

function signature(where, message) {
  // El mensaje se normaliza antes de hashear: numeros, rutas y hex variables
  // no deberian partir un mismo error en cien firmas distintas.
  const norm = String(message || '')
    .replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>')
    .replace(/\/[^\s'"]{4,}/g, '<path>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .toLowerCase()
    .slice(0, 300);
  return crypto.createHash('sha1').update(`${where || ''}|${norm}`).digest('hex').slice(0, 16);
}

async function handle(ctx, event) {
  const p = event.props || {};
  const where = p.where ? String(p.where).slice(0, 120) : null;
  const message = p.message ? String(p.message).slice(0, 500) : null;
  if (!message) return;

  const stack = p.stack ? String(p.stack).slice(0, 500) : null;

  await ctx.client.query(
    `INSERT INTO app_errors
       (machine_id, session_id, app_version, where_at, message, stack, signature, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx.machine_id, ctx.session_id, ctx.app_version, where, message, stack,
     signature(where, message), event.ts]
  );
}

module.exports = { name: 'errors', handle, signature };
