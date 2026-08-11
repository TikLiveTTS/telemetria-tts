// Modal centrado generico, mismo patron que drawer.js pero para dialogos
// cortos (confirmaciones, formularios chicos) en vez de detalle lateral.

import { clear } from './format.js';

const node = () => document.getElementById('modal');
const scrim = () => document.getElementById('modal-scrim');

export function openModal(...content) {
  const m = node();
  clear(m).append(...content);
  m.hidden = false;
  scrim().hidden = false;
}

export function closeModal() {
  node().hidden = true;
  scrim().hidden = true;
  clear(node());
}

export function initModal() {
  scrim().addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !node().hidden) closeModal();
  });
}
