// Router por hash. Sin build step, sin dependencias.

import { destroyCharts } from './charts.js';
import { destroyMap } from './pages/geo.js';
import { clear, el } from './format.js';

const routes = new Map();
let current = null;

export function register(path, render) {
  routes.set(path, render);
}

export function currentRoute() {
  return current;
}

function pathFromHash() {
  const raw = (location.hash || '#/overview').slice(1);
  return raw.split('?')[0] || '/overview';
}

// Resuelve la ruta. Soporta un parametro final: '/features/:name' captura
// '#/features/tts'.
function resolve(path) {
  if (routes.has(path)) return { render: routes.get(path), param: null };

  for (const [pattern, render] of routes) {
    if (!pattern.endsWith('/:param')) continue;
    const prefix = pattern.slice(0, -'/:param'.length);
    if (path.startsWith(prefix + '/')) {
      return { render, param: decodeURIComponent(path.slice(prefix.length + 1)) };
    }
  }
  return { render: routes.get('/overview'), param: null };
}

export async function renderCurrent() {
  const path = pathFromHash();
  const { render, param } = resolve(path);
  current = path;

  // El item de nav activo es el que comparte prefijo, para que el detalle de
  // un conector siga marcando "Funciones".
  for (const link of document.querySelectorAll('#nav a')) {
    const href = link.getAttribute('href').slice(1);
    link.classList.toggle('active', path === href || path.startsWith(href + '/'));
  }

  const view = document.getElementById('view');
  destroyCharts();
  destroyMap();
  clear(view);

  try {
    await render(view, param);
  } catch (err) {
    if (err.message === 'unauthorized') return;
    clear(view).append(
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Error' }),
        el('div', { text: err.message })
      )
    );
  }
}

export function startRouter() {
  window.addEventListener('hashchange', renderCurrent);
  if (!location.hash) location.hash = '#/overview';
  return renderCurrent();
}
