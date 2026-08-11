import { api } from '../api.js';
import { el, clear, num, relative, skeleton } from '../format.js';
import { doughnutChart, updateChart } from '../charts.js';

// Compara versiones con orden semantico: "1.10.0" es mayor que "1.9.0".
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Deriva sorted/latest/onLatest/outdated de las filas crudas del endpoint.
// Compartido entre el render inicial y el refresh para no duplicar la logica.
function computeVersions(rows) {
  const sorted = [...rows].sort((a, b) => compareVersions(a.app_version, b.app_version));
  const latest = sorted[0];
  const onLatest = latest ? rows.find((r) => r.app_version === latest.app_version) : null;
  const outdated = rows.reduce((acc, r) => acc + (r.app_version === latest?.app_version ? 0 : r.users), 0);
  return { sorted, latest, onLatest, outdated };
}

// Reusado por el render inicial y por versionsRefresh: re-llena el tbody sin
// tocar el resto del DOM (asi no se pierde el scroll de la tabla).
function renderVersionRows(tbody, sorted, latest) {
  clear(tbody).append(
    ...(sorted.length
      ? sorted.map((r) => el('tr', {},
          el('td', {}, `v${r.app_version}`,
            r.app_version === latest.app_version
              ? el('span', { class: 'badge badge-new', style: 'margin-left:8px', text: 'ULTIMA' })
              : null),
          el('td', { class: 'right', text: num(r.users) }),
          el('td', { class: 'right', text: `${r.pct}%` }),
          el('td', { class: 'dim nowrap', text: relative(r.last_seen) })
        ))
      : [el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty', text: 'Sin datos' })))])
  );
}

// Referencias de modulo: se llenan en versionsPage y se reusan en
// versionsRefresh para patchear in-place sin reconstruir el DOM.
let kpiLatestEl = null;
let kpiAdoptionEl = null;
let kpiAdoptionSubEl = null;
let kpiOutdatedEl = null;
let tbodyEl = null;
let chart = null;
let renderId = 0;

export async function versionsPage(view) {
  const myId = ++renderId;
  view.append(skeleton(3));

  const rows = await api.get('/api/dashboard/versions');
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba
  const { sorted, latest, onLatest, outdated } = computeVersions(rows);

  kpiLatestEl = el('div', { class: 'kpi-value accent', text: latest ? `v${latest.app_version}` : '—' });
  kpiAdoptionEl = el('div', { class: 'kpi-value cyan', text: onLatest ? `${onLatest.pct}%` : '—' });
  kpiAdoptionSubEl = el('div', { class: 'kpi-sub', text: onLatest ? `${num(onLatest.users)} maquinas` : '' });
  kpiOutdatedEl = el('div', { class: 'kpi-value yellow', text: num(outdated) });
  tbodyEl = el('tbody', {});

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Versiones' }),
        el('div', { class: 'sub', text: 'Distribucion de la version instalada por maquina' }))
    ),

    el('div', { class: 'kpis' },
      el('div', { class: 'card' },
        el('div', { class: 'kpi-label', text: 'Ultima version vista' }),
        kpiLatestEl),
      el('div', { class: 'card' },
        el('div', { class: 'kpi-label', text: 'Adopcion de la ultima version' }),
        kpiAdoptionEl,
        kpiAdoptionSubEl),
      el('div', { class: 'card' },
        el('div', { class: 'kpi-label', text: 'Desactualizadas' }),
        kpiOutdatedEl),
    ),

    el('div', { class: 'grid-2' },
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Reparto' }),
        el('div', { class: 'chart-box' }, el('canvas', { id: 'c-versions' }))
      ),
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Detalle' }),
        el('div', { class: 'table-wrap' },
          el('table', {},
            el('thead', {}, el('tr', {},
              el('th', { text: 'Version' }),
              el('th', { class: 'right', text: 'Maquinas' }),
              el('th', { class: 'right', text: '%' }),
              el('th', { text: 'Ultima actividad' })
            )),
            tbodyEl
          )
        )
      )
    )
  );

  renderVersionRows(tbodyEl, sorted, latest);

  chart = sorted.length
    ? doughnutChart(
        document.getElementById('c-versions'),
        sorted.map((r) => `v${r.app_version}`),
        sorted.map((r) => r.users)
      )
    : null;
}

export async function versionsRefresh(view) {
  const myId = renderId;
  const rows = await api.get('/api/dashboard/versions');
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba
  const { sorted, latest, onLatest, outdated } = computeVersions(rows);

  if (kpiLatestEl) kpiLatestEl.textContent = latest ? `v${latest.app_version}` : '—';
  if (kpiAdoptionEl) kpiAdoptionEl.textContent = onLatest ? `${onLatest.pct}%` : '—';
  if (kpiAdoptionSubEl) kpiAdoptionSubEl.textContent = onLatest ? `${num(onLatest.users)} maquinas` : '';
  if (kpiOutdatedEl) kpiOutdatedEl.textContent = num(outdated);

  if (chart) {
    updateChart(chart, sorted.map((r) => `v${r.app_version}`), [sorted.map((r) => r.users)]);
  } else if (sorted.length) {
    chart = doughnutChart(
      document.getElementById('c-versions'),
      sorted.map((r) => `v${r.app_version}`),
      sorted.map((r) => r.users)
    );
  }

  if (tbodyEl) renderVersionRows(tbodyEl, sorted, latest);
}
