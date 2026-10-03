import { api, state, qs } from '../api.js';
import { el, clear, num, date, skeleton } from '../format.js';
import { lineChart, updateChart, COLORS } from '../charts.js';

const ui = { k: 3, q: '', page: 1, pageSize: 50, sort: 'users' };
let refs = {};
let chart = null;
let timer;

function options() {
  return { days: state.days, k: ui.k, q: ui.q, page: ui.page, pageSize: ui.pageSize };
}

export async function blockedWordsPage(view) {
  view.append(skeleton(4));
  const search = el('input', { class: 'field', type: 'search', placeholder: 'Buscar por prefijo', value: ui.q, 'aria-label': 'Buscar palabra bloqueada' });
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { ui.q = search.value.trim(); ui.page = 1; load(); }, 250);
  });
  const k = el('select', { class: 'field', 'aria-label': 'Mínimo de usuarios' }, ...[1, 2, 3, 4, 5, 10].map((n) =>
    el('option', { value: n, selected: n === ui.k || null, text: `K ≥ ${n}` })
  ));
  k.addEventListener('change', () => { ui.k = Number(k.value); ui.page = 1; load(); });

  refs = {
    installations: el('div', { class: 'kpi-value accent', text: '—' }),
    unique: el('div', { class: 'kpi-value cyan', text: '—' }),
    overK: el('div', { class: 'kpi-value green', text: '—' }),
    note: el('div', { class: 'privacy-note', text: '' }),
    tbody: el('tbody'),
    pager: el('span', { text: '—' }),
    prev: el('button', { class: 'btn btn-sm', onclick: () => { ui.page--; load(); } }, '← Anterior'),
    next: el('button', { class: 'btn btn-sm', onclick: () => { ui.page++; load(); } }, 'Siguiente →'),
  };
  const download = (format) => el('a', { class: 'btn btn-sm', href: exportUrl(format) }, `⬇ ${format.toUpperCase()}`);
  refs.csv = download('csv');
  refs.tsv = download('tsv');

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Palabras bloqueadas' }),
        el('div', { class: 'sub', text: 'Ranking agregado; nunca se muestran listas por usuario.' })),
      el('div', { class: 'filters', style: 'margin:0' }, search, k, refs.tsv, refs.csv)
    ),
    refs.note,
    el('div', { class: 'kpis' },
      kpi('Instalaciones con lista', refs.installations),
      kpi('Palabras únicas', refs.unique),
      kpi('Palabras con K usuarios', refs.overK)
    ),
    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Palabras nuevas por semana' }),
      el('div', { class: 'chart-box' }, el('canvas', { id: 'c-blocked-words' }))
    ),
    el('div', { class: 'card' },
      el('div', { class: 'table-wrap' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { class: 'sortable', text: 'Palabra', onclick: () => { ui.sort = 'word'; load(); } }),
            el('th', { class: 'sortable right', text: 'Usuarios', onclick: () => { ui.sort = 'users'; load(); } }),
            el('th', { class: 'right', text: '% activos' }),
            el('th', { text: 'Primera vez' }),
            el('th', { text: 'Última vez' })
          )), refs.tbody
        )
      ),
      el('div', { class: 'pager' }, refs.pager, el('div', { class: 'filters', style: 'margin:0' }, refs.prev, refs.next))
    )
  );
  await load();
}

function kpi(label, value) {
  return el('div', { class: 'card' }, el('div', { class: 'kpi-label', text: label }), value);
}

function exportUrl(format) {
  return `/api/export/blocked-words.${format}` + qs({ days: state.days, k: ui.k, q: ui.q });
}

export async function blockedWordsRefresh() {
  await load(true);
}

async function load(silent = false) {
  if (!refs.tbody) return;
  if (!silent) clear(refs.tbody).append(el('tr', {}, el('td', { colspan: 5 }, skeleton(3))));
  const [summary, data] = await Promise.all([
    api.get('/api/dashboard/blocked-words/summary' + qs(options())),
    api.get('/api/dashboard/blocked-words' + qs(options())),
  ]);
  refs.installations.textContent = num(summary.installations_with_list);
  refs.unique.textContent = num(summary.unique_words);
  refs.overK.textContent = num(summary.words_over_k);
  refs.note.textContent = `Solo se muestran palabras bloqueadas por al menos ${ui.k} usuarios.`;
  refs.csv.href = exportUrl('csv');
  refs.tsv.href = exportUrl('tsv');

  const rows = ui.sort === 'word'
    ? [...data.rows].sort((a, b) => a.word_norm.localeCompare(b.word_norm, 'es'))
    : data.rows;
  clear(refs.tbody).append(...(rows.length ? rows.map(row) : [emptyRow()]));
  const from = (data.page - 1) * data.pageSize;
  refs.pager.textContent = data.total ? `${from + 1}–${Math.min(from + data.pageSize, data.total)} de ${num(data.total)}` : 'Sin resultados';
  refs.prev.disabled = data.page <= 1;
  refs.next.disabled = from + data.pageSize >= data.total;

  const labels = summary.weekly.map((r) => r.week.slice(5));
  const values = summary.weekly.map((r) => Number(r.words));
  if (chart) updateChart(chart, labels, [values]);
  else chart = lineChart(document.getElementById('c-blocked-words'), labels, [{ label: 'Palabras nuevas', data: values, color: COLORS.accent2 }]);
}

function row(word) {
  const pct = Number(word.porcentaje_de_usuarios_activos || 0);
  return el('tr', {},
    el('td', { class: 'mono', text: word.word_norm }),
    el('td', { class: 'right', text: num(word.usuarios_distintos) }),
    el('td', { class: 'right' }, el('div', { class: 'pct-bar', title: `${pct}% de usuarios activos` },
      el('span', { style: `width:${Math.min(100, pct)}%` }), el('b', { text: `${pct}%` })
    )),
    el('td', { class: 'dim nowrap', text: date(word.first_seen) }),
    el('td', { class: 'dim nowrap', text: date(word.last_seen) })
  );
}

function emptyRow() {
  return el('tr', {}, el('td', { colspan: 5 }, el('div', { class: 'empty', text: 'No hay palabras que cumplan el umbral seleccionado.' })));
}
