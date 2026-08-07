'use strict';

// Registry de conectores. Un conector = { name, handle(ctx, event) }.
//
// El insert generico en la tabla `events` lo hace ingest.js para TODOS los
// conectores. `handle` solo existe para los efectos secundarios propios de
// cada uno (crear la sesion, upsertear un creador, etc.). Los conectores que
// no necesitan nada extra usan `passthrough`.

const passthrough = require('./passthrough');

const list = [
  require('./app'),
  require('./creators'),
  require('./platforms'),
  require('./errors'),
  // Estos solo necesitan la fila generica en `events`:
  passthrough('tts'),
  passthrough('music'),
  passthrough('soundpad'),
  passthrough('obs'),
  passthrough('mobile'),
  passthrough('overlays'),
  passthrough('moderation'),
  passthrough('updates'),
  passthrough('settings'),
];

const registry = new Map(list.map((c) => [c.name, c]));

function get(name) {
  return registry.get(name) || null;
}

function names() {
  return [...registry.keys()];
}

module.exports = { get, names };
