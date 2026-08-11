import { api, state } from '../api.js';
import { el, clear, num, date, relative, skeleton, truncatedList } from '../format.js';
import { openDrawer, closeDrawer } from '../drawer.js';

// Nodo <tbody> de la tabla, guardado a nivel de modulo para que errorsRefresh
// pueda actualizar las filas in-place sin reconstruir toda la vista.
let tbody = null;

export async function errorsPage(view) {
  view.append(skeleton(3));

  const rows = await api.get(`/api/dashboard/errors?days=${state.days}`);

  tbody = el('tbody', {}, ...errorRows(rows));

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {},
        el('h2', { text: 'Errores' }),
        el('div', { class: 'sub', text: 'Agrupados por firma: mismo sitio + mismo mensaje normalizado' })
      )
    ),
    el('div', { class: 'card' },
      el('div', { class: 'table-wrap' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { text: 'Error' }),
            el('th', { text: 'Donde', title: 'Archivo o funcion donde se detecto el error' }),
            el('th', { class: 'right', text: 'Veces' }),
            el('th', { class: 'right', text: 'Maquinas' }),
            el('th', { text: 'Versiones' }),
            el('th', { text: 'Ultima vez' })
          )),
          tbody
        )
      )
    )
  );
}

export async function errorsRefresh(view) {
  if (!tbody) return errorsPage(view);

  const rows = await api.get(`/api/dashboard/errors?days=${state.days}`);
  clear(tbody).append(...errorRows(rows));
}

function errorRows(rows) {
  return rows.length
    ? rows.map(errorRow)
    : [el('tr', {}, el('td', { colspan: 6 },
        el('div', { class: 'empty', text: 'Ningun error registrado en el periodo. Buena senal.' })))];
}

function errorRow(e) {
  const versions = (e.versions || []).filter(Boolean).map((v) => `v${v}`);

  return el('tr', { class: 'clickable', onclick: () => showError(e) },
    el('td', { style: 'max-width:380px' },
      el('div', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: e.message })),
    el('td', { class: 'mono', text: e.where_at || '—' }),
    el('td', { class: 'right', text: num(e.occurrences) }),
    el('td', { class: 'right', text: num(e.machines) }),
    el('td', { class: 'dim', style: 'font-size:var(--fs-xs)', text: truncatedList(versions) }),
    el('td', { class: 'dim nowrap', text: relative(e.last_seen) })
  );
}

function showError(e) {
  const versions = (e.versions || []).filter(Boolean).map((v) => `v${v}`);

  openDrawer(
    el('div', { class: 'drawer-head' },
      el('div', {},
        el('h3', { text: 'Detalle del error' }),
        el('div', { class: 'mono', text: e.signature }),
        el('div', { class: 'dim', style: 'font-size:var(--fs-xs)',
          text: 'Huella para agrupar errores identicos: mismo lugar + mismo mensaje' })
      ),
      el('button', { class: 'btn btn-sm', style: 'margin-left:auto', onclick: closeDrawer }, '✕')
    ),

    el('dl', { class: 'kv' },
      el('dt', { text: 'Donde' }),     el('dd', { class: 'mono', text: e.where_at || '—' }),
      el('dt', { text: 'Ocurrencias' }), el('dd', { text: num(e.occurrences) }),
      el('dt', { text: 'Maquinas' }),  el('dd', { text: num(e.machines) }),
      el('dt', { text: 'Versiones' }), el('dd', { text: truncatedList(versions) }),
      el('dt', { text: 'Primera vez' }), el('dd', { text: date(e.first_seen) }),
      el('dt', { text: 'Ultima vez' }),  el('dd', { text: date(e.last_seen) }),
    ),

    el('div', { class: 'section-title', text: 'Mensaje' }),
    el('code', { class: 'snippet', style: 'white-space:pre-wrap', text: e.message || '' }),

    e.stack
      ? el('div', {},
          el('div', { class: 'section-title', style: 'margin-top:var(--s-5)', text: 'Stack (recortado)' }),
          el('code', { class: 'snippet', style: 'white-space:pre-wrap', text: e.stack }))
      : null
  );
}
