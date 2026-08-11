// Router por hash. Sin build step, sin dependencias.

import { destroyCharts } from './charts.js';
import { destroyMap } from './pages/geo.js';
import { clear, el, toast } from './format.js';

const routes = new Map();
let current = null;

// refreshData es opcional: paginas sin migrar caen a un rebuild completo.
export function register(path, render, refreshData) {
  routes.set(path, { render, refreshData });
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
  if (routes.has(path)) return { ...routes.get(path), param: null };

  for (const [pattern, entry] of routes) {
    if (!pattern.endsWith('/:param')) continue;
    const prefix = pattern.slice(0, -'/:param'.length);
    if (path.startsWith(prefix + '/')) {
      return { ...entry, param: decodeURIComponent(path.slice(prefix.length + 1)) };
    }
  }
  return { ...routes.get('/overview'), param: null };
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

// Refresco periodico/manual: actualiza los datos de la pagina actual sin
// destruir el DOM (sin perder foco de busqueda, scroll de tabla, ni
// reiniciar charts/mapa). Si la pagina no tiene refreshData todavia, cae a
// un rebuild completo (mismo comportamiento que antes, sin regresion).
export async function refreshCurrent() {
  if (current === null) return renderCurrent();
  const { refreshData, param } = resolve(current);
  if (!refreshData) return renderCurrent();

  try {
    await refreshData(document.getElementById('view'), param);
  } catch (err) {
    if (err.message === 'unauthorized') return;
    toast(err.message, true);
  }
}

export function startRouter() {
  window.addEventListener('hashchange', renderCurrent);
  if (!location.hash) location.hash = '#/overview';
  return renderCurrent();
}
