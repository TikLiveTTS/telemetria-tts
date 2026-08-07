import { api, state } from '../api.js';
import { el, num, date, relative, skeleton } from '../format.js';
import { openDrawer, closeDrawer } from '../drawer.js';

export async function errorsPage(view) {
  view.append(skeleton(3));

  const rows = await api.get(`/api/dashboard/errors?days=${state.days}`);

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
            el('th', { text: 'Donde' }),
            el('th', { class: 'right', text: 'Veces' }),
            el('th', { class: 'right', text: 'Maquinas' }),
            el('th', { text: 'Versiones' }),
            el('th', { text: 'Ultima vez' })
          )),
          el('tbody', {}, rows.length
            ? rows.map((e) => el('tr', { class: 'clickable', onclick: () => showError(e) },
                el('td', { style: 'max-width:380px' },
                  el('div', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: e.message })),
                el('td', { class: 'mono', text: e.where_at || '—' }),
                el('td', { class: 'right', text: num(e.occurrences) }),
                el('td', { class: 'right', text: num(e.machines) }),
                el('td', { class: 'dim', style: 'font-size:var(--fs-xs)',
                  text: (e.versions || []).filter(Boolean).map((v) => `v${v}`).join(', ') || '—' }),
                el('td', { class: 'dim nowrap', text: relative(e.last_seen) })
              ))
            : el('tr', {}, el('td', { colspan: 6 },
                el('div', { class: 'empty', text: 'Ningun error registrado en el periodo. Buena senal.' })))
          )
        )
      )
    )
  );
}

function showError(e) {
  openDrawer(
    el('div', { class: 'drawer-head' },
      el('div', {},
        el('h3', { text: 'Detalle del error' }),
        el('div', { class: 'mono', text: e.signature })
      ),
      el('button', { class: 'btn btn-sm', style: 'margin-left:auto', onclick: closeDrawer }, '✕')
    ),

    el('dl', { class: 'kv' },
      el('dt', { text: 'Donde' }),     el('dd', { class: 'mono', text: e.where_at || '—' }),
      el('dt', { text: 'Ocurrencias' }), el('dd', { text: num(e.occurrences) }),
      el('dt', { text: 'Maquinas' }),  el('dd', { text: num(e.machines) }),
      el('dt', { text: 'Versiones' }), el('dd', { text: (e.versions || []).filter(Boolean).map((v) => `v${v}`).join(', ') || '—' }),
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
