'use strict';

// Cache en memoria de las consultas pesadas del panel. jobs.warm() la rellena
// cada hora, asi que el usuario casi siempre lee un resultado ya calculado.
// ponytail: se pierde al reiniciar (warm lo repone al arrancar); tabla en DB si hace falta persistirla.
const TTL = 70 * 60 * 1000; // algo mas que el intervalo del job
const store = new Map();

function memo(name, fn, arg) {
  const key = `${name}:${arg}`;
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = fn(arg);
  store.set(key, { at: Date.now(), p });
  p.catch(() => store.delete(key));
  return p;
}

// Recalcula siempre y reemplaza la entrada solo si salio bien.
async function refresh(name, fn, arg) {
  const p = fn(arg);
  const v = await p;
  store.set(`${name}:${arg}`, { at: Date.now(), p: Promise.resolve(v) });
  return v;
}

module.exports = { memo, refresh };
