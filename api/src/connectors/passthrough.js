'use strict';

// Conector sin efectos secundarios: la fila en `events` que ya escribe
// ingest.js es todo lo que necesita. Existe para que el registry conozca el
// nombre y no descarte sus eventos como desconocidos.
module.exports = function passthrough(name) {
  return {
    name,
    async handle() {
      /* nada que hacer */
    },
  };
};
