import { api, state } from '../api.js';
import { el, clear, num, relative, skeleton, toast } from '../format.js';
import { openModal, closeModal } from '../modal.js';
import { renderCurrent } from '../router.js';
import { doughnutChart, lineChart, updateChart, SERIES } from '../charts.js';
import { section } from './habits.js';

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

// El grafico muestra las N versiones mas recientes y suma el resto en
// "Anteriores"; la tabla sigue listandolas todas.
const CHART_MAX = 6;
function chartData(sorted) {
  const top = sorted.slice(0, CHART_MAX);
  const rest = sorted.slice(CHART_MAX).reduce((acc, r) => acc + r.users, 0);
  return {
    labels: [...top.map((r) => `v${r.app_version}`), ...(rest ? ['Anteriores'] : [])],
    data: [...top.map((r) => r.users), ...(rest ? [rest] : [])],
  };
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

  const rows = await api.get(`/api/dashboard/versions?days=${state.days}`);
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
        el('div', { class: 'sub', text: `Version actual de cada maquina que abrio la app en los ultimos ${state.days} dias. Al actualizar, la maquina pasa a la nueva version` }))
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
        el('div', { style: 'display:flex;align-items:center;justify-content:space-between' },
          el('div', { class: 'section-title', text: 'Reparto' }),
          el('button', { class: 'btn btn-sm', onclick: openVersionManager }, 'Gestionar versiones')),
        el('div', { class: 'chart-box', style: 'cursor:pointer', title: 'Clic para gestionar versiones', onclick: openVersionManager },
          el('canvas', { id: 'c-versions' }))
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

  const cd = chartData(sorted);
  chart = sorted.length ? doughnutChart(document.getElementById('c-versions'), cd.labels, cd.data) : null;

  const rollout = await api.get(`/api/dashboard/versions/rollout?days=${state.days}`);
  if (myId !== renderId) return;
  renderRollout(view, rollout);
}

// Area apilada con el % de usuarios activos de cada dia en cada version, y
// cuantos dias tardo cada version en llegar al 80 %.
const ROLLOUT_TOP = 5;
const ROLLOUT_TARGET = 80;

function renderRollout(view, { series, checks }) {
  const days = [...new Set(series.map((r) => r.day))].sort();
  const versions = [...new Set(series.map((r) => r.app_version))].sort(compareVersions);
  const top = versions.slice(0, ROLLOUT_TOP);
  const key = (v) => (top.includes(v) ? `v${v}` : 'Anteriores');
  const keys = [...top.map((v) => `v${v}`), ...(versions.length > ROLLOUT_TOP ? ['Anteriores'] : [])];

  const share = new Map(keys.map((k) => [k, days.map(() => 0)]));
  const totals = days.map(() => 0);
  for (const r of series) {
    const i = days.indexOf(r.day);
    share.get(key(r.app_version))[i] += r.users;
    totals[i] += r.users;
  }
  for (const arr of share.values()) arr.forEach((n, i) => { arr[i] = totals[i] ? Math.round((1000 * n) / totals[i]) / 10 : 0; });

  const speed = top.map((v) => {
    const arr = share.get(`v${v}`);
    const first = arr.findIndex((n) => n > 0);
    const hit = arr.findIndex((n) => n >= ROLLOUT_TARGET);
    const text = hit >= 0
      ? `${ROLLOUT_TARGET}% en ${Math.round((new Date(days[hit]) - new Date(days[first])) / 86400000)} dias`
      : `aun no (max ${Math.max(...arr)}%)`;
    return el('span', { class: 'badge', style: 'margin:0 8px 6px 0' }, `v${v}: ${text}`);
  });

  const totalChecks = checks.reduce((acc, r) => acc + r.checks, 0);
  speed.push(el('span', { class: 'badge', style: 'margin:0 8px 6px 0' }, `${num(totalChecks)} comprobaciones de actualizacion en el periodo`));
  const canvas = el('canvas');
  view.append(section('Velocidad de actualizacion',
    `Reparto diario de los usuarios activos por version. Cuantos dias tarda una version nueva en llegar al ${ROLLOUT_TARGET}% (se cuenta desde el primer dia en que aparece).`,
    canvas, days.length ? el('div', {}, ...speed) : el('div', { class: 'empty', text: 'Sin datos' })));
  if (!days.length) return;

  lineChart(canvas, days.map((d) => d.slice(5)), keys.map((k, i) => ({
    label: k, data: share.get(k), color: SERIES[i % SERIES.length],
    fill: i === 0 ? 'origin' : '-1', pointRadius: 0,
  })), { stacked: true, max: 100 });
}

export async function versionsRefresh(view) {
  const myId = renderId;
  const rows = await api.get(`/api/dashboard/versions?days=${state.days}`);
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba
  const { sorted, latest, onLatest, outdated } = computeVersions(rows);

  if (kpiLatestEl) kpiLatestEl.textContent = latest ? `v${latest.app_version}` : '—';
  if (kpiAdoptionEl) kpiAdoptionEl.textContent = onLatest ? `${onLatest.pct}%` : '—';
  if (kpiAdoptionSubEl) kpiAdoptionSubEl.textContent = onLatest ? `${num(onLatest.users)} maquinas` : '';
  if (kpiOutdatedEl) kpiOutdatedEl.textContent = num(outdated);

  const cd = chartData(sorted);
  if (chart) updateChart(chart, cd.labels, [cd.data]);
  else if (sorted.length) chart = doughnutChart(document.getElementById('c-versions'), cd.labels, cd.data);

  if (tbodyEl) renderVersionRows(tbodyEl, sorted, latest);
}

// Pop-up de gestion: ocultar una version la saca del reparto, la tabla y el
// despliegue (queda guardado en hidden_versions). No borra datos y se puede
// volver a mostrar. Ocultar pide escribir la version para evitar clics sueltos.
async function openVersionManager() {
  const rows = await api.get('/api/dashboard/versions/catalog');
  const errBox = el('div', { class: 'login-error' });

  const setHidden = async (version, hidden) => {
    try {
      await api.post('/api/dashboard/versions/hidden', { version, hidden });
      toast(hidden ? `v${version} oculta` : `v${version} visible de nuevo`);
      closeModal();
      await renderCurrent();
    } catch (err) {
      errBox.textContent = err.message;
    }
  };

  // Fila de confirmacion bajo la version elegida: el boton se habilita al
  // escribir exactamente la version.
  const confirmRow = (r, tr) => {
    const input = el('input', { class: 'field', placeholder: r.app_version, style: 'width:120px', 'aria-label': `Escribe ${r.app_version} para confirmar` });
    const ok = el('button', { class: 'btn btn-sm btn-accent', disabled: true, onclick: () => setHidden(r.app_version, true) }, 'Ocultar');
    input.addEventListener('input', () => { ok.disabled = input.value.trim() !== r.app_version; });
    const row = el('tr', {}, el('td', { colspan: 5 },
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:var(--fs-sm)' },
        el('span', { class: 'dim', text: `Escribe ${r.app_version} para ocultarla:` }), input, ok)));
    tr.after(row);
    input.focus();
  };

  const body = el('tbody', {}, ...rows.map((r) => {
    const tr = el('tr', {},
      el('td', {}, `v${r.app_version}`,
        r.hidden_at ? el('span', { class: 'badge', style: 'margin-left:8px', text: 'OCULTA' }) : null),
      el('td', { class: 'right', text: num(r.installs) }),
      el('td', { class: 'right', text: num(r.sessions) }),
      el('td', { class: 'dim nowrap', text: relative(r.last_seen) }),
      el('td', { class: 'right' }),
    );
    let open = false;
    tr.lastChild.append(r.hidden_at
      ? el('button', { class: 'btn btn-sm', onclick: () => setHidden(r.app_version, false) }, 'Mostrar')
      : el('button', { class: 'btn btn-sm', onclick: () => { if (!open) { open = true; confirmRow(r, tr); } } }, 'Ocultar'));
    return tr;
  }));

  openModal(
    el('h3', { text: 'Gestionar versiones' }),
    el('p', { class: 'dim', style: 'font-size:var(--fs-sm);margin-bottom:var(--s-4)' },
      'Ocultar una version la quita del reparto, la tabla y el grafico de actualizacion. Los datos no se borran: puedes volver a mostrarla cuando quieras.'),
    el('div', { class: 'table-wrap', style: 'max-height:50vh;overflow:auto' },
      el('table', {},
        el('thead', {}, el('tr', {},
          el('th', { text: 'Version' }),
          el('th', { class: 'right', text: 'Maquinas hoy' }),
          el('th', { class: 'right', text: 'Sesiones' }),
          el('th', { text: 'Ultima sesion' }),
          el('th', {}))),
        body)),
    errBox,
    el('div', { class: 'modal-actions' }, el('button', { class: 'btn btn-sm', onclick: closeModal }, 'Cerrar')),
  );
}
