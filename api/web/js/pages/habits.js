import { api } from '../api.js';
import { el, num, skeleton } from '../format.js';
import { lineChart, barChart, groupedBarChart, COLORS } from '../charts.js';
import { usageView } from './habits-usage.js';

let renderId = 0;

// Cada grafico va en su propio apartado: titulo, que responde y el canvas.
export function section(title, sub, canvas, extra) {
  return el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
    el('div', { class: 'section-title', text: title }),
    el('div', { class: 'kpi-sub', style: 'margin:0 0 var(--s-3)', text: sub }),
    extra || null,
    el('div', { class: 'chart-box' }, canvas)
  );
}

export function kpi(label, value, sub, cls = '') {
  return el('div', { class: 'card' },
    el('div', { class: 'kpi-label', text: label }),
    el('div', { class: `kpi-value ${cls}`, text: value }),
    el('div', { class: 'kpi-sub', text: sub || '' })
  );
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

const RANGES = [[7, '7 dias'], [30, '30 dias'], [90, '3 meses'], [180, '6 meses'], [365, '1 ano']];

// Apartado con su propio rango de tiempo y descarga CSV. `draw(body, data)`
// pinta los datos dentro de `body` y devuelve el chart (o null) para poder
// destruirlo al cambiar de rango. Cada apartado se pide por separado.
function panel({ title, sub, section: name, draw, onData, isCurrent }) {
  let days = 30;
  let chart = null;
  let token = 0;
  const body = el('div');
  const subEl = el('div', { class: 'kpi-sub', style: 'margin:0 0 var(--s-3)' });
  const csv = el('a', { class: 'btn btn-sm', title: 'Descargar estos datos en CSV' }, '⬇ CSV');
  const sel = el('select', { class: 'field', 'aria-label': `Rango de ${title}` },
    ...RANGES.map(([v, text]) => el('option', { value: v, selected: v === days }, text)));

  const load = async () => {
    const mine = ++token;
    csv.href = `/api/export/habits-${name}.csv?days=${days}`;
    let data;
    try {
      data = await api.get(`/api/dashboard/habits?section=${name}&days=${days}`);
    } catch (err) {
      if (mine === token && isCurrent()) body.replaceChildren(el('div', { class: 'empty', text: err.message }));
      return;
    }
    if (mine !== token || !isCurrent()) return; // otro rango o otra pagina mientras esperaba
    if (chart) { chart.destroy(); chart = null; }
    subEl.textContent = typeof sub === 'function' ? sub(data) : sub;
    chart = draw(body, data, days);
    onData(name, data, days);
  };
  sel.addEventListener('change', () => { days = Number(sel.value); load(); });

  const node = el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
    el('div', { class: 'section-title', style: 'display:flex;align-items:center;gap:var(--s-3);flex-wrap:wrap' },
      title, el('span', { style: 'margin-left:auto;display:flex;gap:var(--s-2)' }, sel, csv)),
    subEl, body);
  return { node, load };
}

// Pinta un grafico en un canvas nuevo dentro de su caja.
function chartIn(body, build) {
  const canvas = el('canvas');
  body.replaceChildren(el('div', { class: 'chart-box' }, canvas));
  return build(canvas);
}

export async function habitsPage(view) {
  const myId = ++renderId;
  const isCurrent = () => myId === renderId;
  const latest = {}; // ultimo dato y rango de cada apartado, para las tarjetas de arriba
  const kpis = el('div', { class: 'kpis' });

  const paintKpis = () => {
    const { hours, stickiness, churn } = latest;
    const cards = [];
    if (hours) {
      const total = hours.data.rows.reduce((acc, r) => acc + r.hours, 0);
      cards.push(kpi('Horas de uso', num(Math.round(total)), `sesiones cerradas, ${hours.days} dias`, 'accent'));
    }
    if (stickiness) {
      const rows = stickiness.data;
      const last = rows[rows.length - 1] || { dau: 0, wau: 0, mau: 0 };
      const avg = rows.length ? Math.round(rows.reduce((acc, r) => acc + pct(r.dau, r.mau), 0) / rows.length) : 0;
      cards.push(
        kpi('DAU / MAU hoy', `${pct(last.dau, last.mau)}%`, `${num(last.dau)} hoy de ${num(last.mau)} en 30 dias`, 'cyan'),
        kpi('DAU / MAU medio', `${avg}%`, `media de ${stickiness.days} dias`));
    }
    if (churn) {
      const lost = churn.data.rows.reduce((acc, r) => acc + r.churned, 0);
      const back = churn.data.rows.reduce((acc, r) => acc + r.recovered, 0);
      cards.push(
        kpi('Perdidos', num(lost), `${churn.data.days}+ dias sin abrir la app`, 'yellow'),
        kpi('Recuperados', num(back), `volvieron tras ${churn.data.days}+ dias`, 'green'));
    }
    kpis.replaceChildren(...cards);
  };
  const onData = (name, data, days) => { latest[name] = { data, days }; paintKpis(); };
  const base = { onData, isCurrent };

  const heatmap = panel({
    ...base, section: 'heatmap', title: 'Cuando se usa la app (dia x hora)',
    sub: 'Usuarios distintos con la app abierta en cada hora, en la hora local de cada uno (aproximada por su ubicacion). Sirve para elegir cuando publicar actualizaciones o hacer mantenimiento.',
    draw: usageView,
  });
  const durations = panel({
    ...base, section: 'durations', title: 'Duracion de sesion',
    sub: 'Separa a quien abre y cierra la app de quien hace directos largos. La media esconde esa diferencia.',
    draw: (body, rows) => chartIn(body, (c) => barChart(c, rows.map((r) => r.bucket), rows.map((r) => r.sessions), { label: 'Sesiones' })),
  });
  const hours = panel({
    ...base, section: 'hours',
    title: 'Horas totales de uso',
    sub: (d) => `Crecimiento real de uso, no solo de usuarios. Agrupado por ${d.unit === 'week' ? 'semana (por encima de 90 dias)' : 'dia'}.`,
    draw: (body, d) => chartIn(body, (c) => barChart(c, d.rows.map((r) => r.day.slice(5)), d.rows.map((r) => r.hours), { label: 'Horas', color: COLORS.accent2 })),
  });
  const stickiness = panel({
    ...base, section: 'stickiness', title: 'DAU / MAU (stickiness)',
    sub: 'Que porcentaje de los usuarios de los ultimos 30 dias abrio la app ese dia (DAU) o esa semana (WAU).',
    draw: (body, rows) => chartIn(body, (c) => lineChart(c, rows.map((r) => r.day.slice(5)), [
      { label: 'DAU / MAU %', data: rows.map((r) => pct(r.dau, r.mau)), color: COLORS.accent, fill: false },
      { label: 'WAU / MAU %', data: rows.map((r) => pct(r.wau, r.mau)), color: COLORS.accent2, fill: false },
    ], { max: 100 })),
  });
  const churn = panel({
    ...base, section: 'churn', title: 'Usuarios perdidos y recuperados',
    sub: (d) => `Perdido: su ultima sesion de la semana fue seguida de ${d.days}+ dias sin volver. Recuperado: volvio tras un hueco igual. Las 2 ultimas semanas aun no son definitivas.`,
    draw: (body, d) => chartIn(body, (c) => groupedBarChart(c, d.rows.map((r) => r.week.slice(5)), [
      { label: 'Perdidos', data: d.rows.map((r) => r.churned), color: COLORS.warn },
      { label: 'Recuperados', data: d.rows.map((r) => r.recovered), color: COLORS.ok },
    ], { max: undefined })),
  });
  const panels = [heatmap, durations, hours, stickiness, churn];

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Habitos' }),
        el('div', { class: 'sub', text: 'Cada apartado tiene su propio rango de tiempo y se puede descargar en CSV' }))
    ),
    kpis,
    ...panels.map((p) => p.node),
  );
  panels.forEach((p) => p.load());
}
