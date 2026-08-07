// Panel lateral de detalle, compartido por Creadores y Sesiones.

import { clear } from './format.js';

const node = () => document.getElementById('drawer');
const scrim = () => document.getElementById('drawer-scrim');

export function openDrawer(...content) {
  const d = node();
  clear(d).append(...content);
  d.hidden = false;
  scrim().hidden = false;
}

export function closeDrawer() {
  node().hidden = true;
  scrim().hidden = true;
  clear(node());
}

export function initDrawer() {
  scrim().addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });
}
