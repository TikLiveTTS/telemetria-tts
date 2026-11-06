import { api, state } from '../api.js';
import { el, clear, num, minutes, skeleton, toast, PLATFORM_LABELS } from '../format.js';
import { lineChart, barChart, updateChart, COLORS } from '../charts.js';

// Referencias de modulo: se llenan en buildLayout() (parte de overviewPage)
// y se leen/actualizan en applyData() (parte de overviewPage y de
// overviewRefresh) para poder refrescar sin reconstruir el DOM.
const refs = {};
let dailyBox = null;
let retBox = null;
let platBox = null;
let chartDaily = null;
let chartPlat = null;
let renderId = 0;

// Rango y agrupacion de la grafica de actividad (se conservan entre refrescos).
const DAILY_RANGES = [[7, '7 dias'], [30, '30 dias'], [90, '3 meses'], [180, '6 meses'], [365, '1 ano']];
const DAILY_UNITS = [['day', 'Por dia'], ['week', 'Por semana'], ['month', 'Por mes']];
let dailyDays = 365;
let dailyUnit = 'day';
let csvLink = null;

const dailyQuery = () => `days=${dailyDays}&unit=${dailyUnit}`;

function kpi(label, cls) {
  const valueEl = el('div', { class: `kpi-value ${cls || ''}` });
  const subEl = el('div', { class: 'kpi-sub' });
  const node = el('div', { class: 'card' },
    el('div', { class: 'kpi-label', text: label }),
    valueEl,
    subEl
  );
  return { node, valueEl, subEl };
}

// Delta contra el periodo anterior de la misma longitud.
function delta(now, prev) {
  if (prev === null || prev === undefined) {
    return el('span', { class: 'dim', text: `sin datos de los ${state.days} dias anteriores` });
  }
  const prevNum = Number(prev);
  const nowNum = Number(now);
  if (prevNum === 0) {
    if (nowNum === 0) return el('span', { class: 'dim', text: 'sin cambios' });
    return el('span', { class: 'delta up', text: `+${nowNum} vs 0 antes` });
  }
  const pct = Math.round(((nowNum - prevNum) / prevNum) * 100);
  const up = pct >= 0;
  return el('span', { class: `delta ${up ? 'up' : 'down'}`, text: `${up ? '▲' : '▼'} ${Math.abs(pct)}% vs ${state.days} dias anteriores` });
}

// Arma el DOM una sola vez: 8 tarjetas KPI (vacias) + los 3 contenedores de
// chart. Los valores/graficos se llenan despues via applyData().
// Selector que cambia el rango/agrupacion y recarga solo esta grafica.
function pick(label, options, get, set) {
  const sel = el('select', { class: 'field', 'aria-label': label },
    ...options.map(([v, text]) => el('option', { value: v, selected: String(v) === String(get()) }, text)));
  sel.addEventListener('change', async () => {
    set(sel.value);
    csvLink.href = `/api/export/daily.csv?${dailyQuery()}`;
    const myId = renderId;
    try {
      const daily = await api.get(`/api/dashboard/daily?${dailyQuery()}`);
      if (myId === renderId) applyDaily(daily);
    } catch (err) {
      toast(err.message, true);
    }
  });
  return sel;
}

function buildLayout(view) {
  csvLink = el('a', { class: 'btn btn-sm', href: `/api/export/daily.csv?${dailyQuery()}`, title: 'Descargar esta serie en CSV' }, '⬇ CSV');
  refs.installs = kpi('Instalaciones', 'accent');
  refs.activeNow = kpi('Apps abiertas', 'cyan');
  refs.connectedNow = kpi('Conectado a plataforma', 'cyan');
  refs.activeToday = kpi('Activos hoy', '');
  refs.activePeriod = kpi(`Activos ${state.days} dias`, '');
  refs.newPeriod = kpi(`Nuevos ${state.days} dias`, 'green');
  refs.avgSession = kpi('Duracion media de sesion', 'yellow');
  refs.creators = kpi('Creadores', '');

  dailyBox = el('div', { class: 'chart-box' });
  retBox = el('div');
  platBox = el('div', { class: 'chart-box' });
  chartDaily = null;
  chartPlat = null;

  view.replaceChildren(
    el('div', { class: 'kpis' },
      refs.installs.node, refs.activeNow.node, refs.connectedNow.node, refs.activeToday.node, refs.activePeriod.node,
      refs.newPeriod.node, refs.avgSession.node, refs.creators.node
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', style: 'display:flex;align-items:center;gap:var(--s-3);flex-wrap:wrap' },
        'Actividad',
        el('span', { style: 'margin-left:auto;display:flex;gap:var(--s-2);flex-wrap:wrap' },
          pick('Rango de la grafica', DAILY_RANGES, () => dailyDays, (v) => { dailyDays = Number(v); }),
          pick('Agrupacion', DAILY_UNITS, () => dailyUnit, (v) => { dailyUnit = v; }),
          csvLink)),
      dailyBox
    ),

    el('div', { class: 'grid-2' },
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Cuantos vuelven tras instalar' }),
        el('div', { class: 'kpi-sub', style: 'margin:0 0 var(--s-3)', text: 'Agrupa las instalaciones por semana y mira que porcentaje volvio a abrir la app despues. Sirve para saber si la app engancha: si el % baja en las semanas nuevas, algo empeoro.' }),
        retBox
      ),
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Plataformas usadas' }),
        platBox
      )
    )
  );
}

// Grafica de actividad: el chart siempre existe.
function applyDaily(daily) {
  // Mes: AAAA-MM. Dia o semana: AA-MM-DD (el rango puede cruzar anos).
  const dailyLabels = daily.map((d) => (dailyUnit === 'month' ? String(d.day).slice(0, 7) : String(d.day).slice(2, 10)));
  const dailySeries = [
    { label: 'Sesiones', data: daily.map((d) => d.sessions), color: COLORS.accent },
    { label: 'Usuarios unicos', data: daily.map((d) => d.users), color: COLORS.accent2 },
    { label: 'Instalaciones nuevas', data: daily.map((d) => d.installs), color: COLORS.ok },
  ];
  if (chartDaily) {
    updateChart(chartDaily, dailyLabels, dailySeries.map((d) => d.data));
  } else {
    const canvas = el('canvas', { id: 'c-daily' });
    dailyBox.replaceChildren(canvas);
    chartDaily = lineChart(canvas, dailyLabels, dailySeries);
  }
}

const DAY_MS = 86400000;

// Cohortes semanales como tabla: cada fila es la semana en que instalaron y
// cada columna que % volvio a abrir la app en 1, 7 o 30 dias despues.
// Una celda solo se muestra si ya paso todo el plazo para toda la semana;
// si no, el % estaria artificialmente bajo y engana.
function paintRetention(rows) {
  if (!rows.length) { retBox.replaceChildren(el('div', { class: 'empty', text: 'Sin cohortes todavia' })); return; }
  const now = Date.now();
  const WINDOWS = [['d1', 1, 'Al dia siguiente'], ['d7', 7, 'En 7 dias'], ['d30', 30, 'En 30 dias']];
  const done = (r, n) => new Date(`${String(r.week).slice(0, 10)}T00:00:00`).getTime() + (6 + n + 1) * DAY_MS <= now;

  // Resumen: media ponderada por usuarios, solo con cohortes completas.
  const avg = (key, n) => {
    const ok = rows.filter((r) => done(r, n));
    const users = ok.reduce((a, r) => a + r.users, 0);
    return users ? Math.round(ok.reduce((a, r) => a + r.users * Number(r[key]), 0) / users) : null;
  };
  const cell = (r, [key, n]) => {
    if (!done(r, n)) return el('td', { class: 'right dim', title: 'Aun no ha pasado el plazo completo', text: 'en curso' });
    const v = Number(r[key]);
    return el('td', { class: 'right nowrap', style: `background:linear-gradient(90deg,color-mix(in srgb,${COLORS.accent} 35%,transparent) ${v}%,transparent ${v}%)`, text: `${v}%` });
  };
  const summary = el('div', { style: 'display:flex;gap:var(--s-5);flex-wrap:wrap;margin-bottom:var(--s-3)' },
    ...WINDOWS.map(([key, n, label]) => el('div', {},
      el('div', { class: 'kpi-value', style: 'font-size:var(--fs-xl)', text: avg(key, n) === null ? '—' : `${avg(key, n)}%` }),
      el('div', { class: 'kpi-sub', text: label }))));

  retBox.replaceChildren(summary, el('div', { class: 'table-wrap', style: 'max-height:200px;overflow-y:auto' },
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', { text: 'Semana del' }), el('th', { class: 'right', text: 'Instalaron' }),
        ...WINDOWS.map(([, , label]) => el('th', { class: 'right', text: label })))),
      el('tbody', {}, [...rows].reverse().map((r) => el('tr', {},
        el('td', { text: String(r.week).slice(0, 10) }),
        el('td', { class: 'right', text: num(r.users) }),
        ...WINDOWS.map((w) => cell(r, w))))))));
}

// Actualiza valores de KPI y los 3 charts con datos frescos, sin tocar el
// resto del DOM. Usada tanto en la carga inicial como en cada refresco.
function applyData(s, daily, retention, platforms) {
  refs.installs.valueEl.textContent = num(s.total_installs);
  clear(refs.installs.subEl).append(el('span', { class: 'dim', text: 'maquinas unicas, desde el inicio' }));

  refs.activeNow.valueEl.textContent = num(s.active_now);
  clear(refs.activeNow.subEl).append(el('span', {
    class: 'dim', text: 'con latido en los ultimos 5 minutos', title: 'App abierta con latido hace menos de 5 minutos. No indica que este transmitiendo en vivo',
  }));

  refs.connectedNow.valueEl.textContent = num(s.connected_now);
  clear(refs.connectedNow.subEl).append(el('span', { class: 'dim', text: 'con señal recibida en los ultimos 150 segundos' }));

  refs.activeToday.valueEl.textContent = num(s.active_today);
  clear(refs.activeToday.subEl).append(el('span', { class: 'dim', text: 'dia local' }));

  refs.activePeriod.valueEl.textContent = num(s.active_period);
  clear(refs.activePeriod.subEl).append(delta(s.active_period, s.active_prev_period));

  refs.newPeriod.valueEl.textContent = num(s.new_period);
  clear(refs.newPeriod.subEl).append(delta(s.new_period, s.new_prev_period));

  refs.avgSession.valueEl.textContent = s.avg_session_min ? minutes(s.avg_session_min) : '—';
  clear(refs.avgSession.subEl).append(el('span', { class: 'dim', text: 'por sesion cerrada' }));

  refs.creators.valueEl.textContent = num(s.creators_total);
  clear(refs.creators.subEl).append(el('span', { class: 'dim', text: `${num(s.creators_public)} publicos` }));

  applyDaily(daily);

  paintRetention(retention);

  // Plataformas: mismo caso, puede aparecer/desaparecer entre refrescos.
  if (platforms.length) {
    const platLabels = platforms.map((p) => PLATFORM_LABELS[p.platform] || p.platform);
    const platData = platforms.map((p) => Number(p.pct));
    if (chartPlat) {
      updateChart(chartPlat, platLabels, [platData]);
    } else {
      const canvas = el('canvas', { id: 'c-plat' });
      platBox.replaceChildren(canvas);
      chartPlat = barChart(canvas, platLabels, platData, { horizontal: true, label: '% de sesiones' });
    }
  } else {
    if (chartPlat) {
      chartPlat.destroy();
      chartPlat = null;
    }
    platBox.replaceChildren(el('div', { class: 'empty', text: 'Sin datos de plataformas' }));
  }
}

async function fetchAll() {
  return Promise.all([
    api.get(`/api/dashboard/summary?days=${state.days}`),
    api.get(`/api/dashboard/daily?${dailyQuery()}`),
    api.get('/api/dashboard/retention'),
    api.get(`/api/dashboard/platforms?days=${state.days}`),
  ]);
}

export async function overviewPage(view) {
  const myId = ++renderId;
  view.replaceChildren(skeleton(3));

  const [s, daily, retention, platforms] = await fetchAll();
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba

  buildLayout(view);
  applyData(s, daily, retention, platforms);
}

export async function overviewRefresh() {
  const myId = renderId;
  const [s, daily, retention, platforms] = await fetchAll();
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba
  applyData(s, daily, retention, platforms);
}
