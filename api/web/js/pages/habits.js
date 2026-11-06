import { api } from '../api.js';
import { el, num, skeleton } from '../format.js';
import { lineChart, barChart, groupedBarChart, COLORS } from '../charts.js';

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

const DAYS = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];
const LEVELS = 5;
const EMPTY = 'rgba(255,255,255,.04)';
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

// Nivel 1..LEVELS de una celda: tramos iguales entre 1 y el pico.
const levelOf = (n, max) => (n ? Math.min(LEVELS, Math.ceil((n / max) * LEVELS)) : 0);
// Color de cada nivel: el acento del panel, cada vez mas opaco.
const levelColor = (lv) => (lv ? `color-mix(in srgb, ${COLORS.accent} ${Math.round((100 * lv) / LEVELS)}%, transparent)` : EMPTY);

// Rejilla 7 x 24 en CSS: Chart.js no trae heatmap y no vale una dependencia.
function heatmapGrid(rows) {
  const cell = new Map(rows.map((r) => [`${r.dow}-${r.hour}`, r.users]));
  const max = Math.max(1, ...rows.map((r) => r.users));
  const peak = rows.reduce((a, r) => (r.users > (a?.users || 0) ? r : a), null);
  const dayTotal = DAYS.map((_, i) => Math.max(0, ...Array.from({ length: 24 }, (_, h) => cell.get(`${i + 1}-${h}`) || 0)));

  const grid = el('div', {
    style: 'display:grid;grid-template-columns:72px repeat(24,minmax(0,1fr));gap:2px;font-size:10px;color:var(--muted)',
  });
  grid.append(el('span'), ...Array.from({ length: 24 }, (_, h) => el('span', { style: 'text-align:center', text: h % 3 ? '' : hh(h) })));
  DAYS.forEach((day, i) => {
    grid.append(el('span', { style: 'align-self:center', text: day }));
    for (let h = 0; h < 24; h++) {
      const n = cell.get(`${i + 1}-${h}`) || 0;
      grid.append(el('span', {
        dataset: { day: i, hour: h, n },
        style: `height:22px;border-radius:3px;cursor:crosshair;background:${levelColor(levelOf(n, max))}`,
      }));
    }
  });

  // Tooltip propio: el `title` nativo tarda en salir y no admite varias lineas.
  const tip = el('div', {
    style: 'position:absolute;pointer-events:none;display:none;z-index:5;background:#000;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5;white-space:nowrap',
  });
  const wrap = el('div', { style: 'position:relative' }, grid, tip);
  let hovered = null;
  grid.addEventListener('mousemove', (e) => {
    const c = e.target.dataset && e.target.dataset.hour !== undefined ? e.target : null;
    if (hovered && hovered !== c) hovered.style.outline = '';
    if (!c) { tip.style.display = 'none'; hovered = null; return; }
    hovered = c;
    c.style.outline = '2px solid #fff';
    const n = Number(c.dataset.n);
    const d = Number(c.dataset.day);
    const h = Number(c.dataset.hour);
    tip.replaceChildren(
      el('div', { style: 'font-weight:600', text: `${DAYS[d]}, ${hh(h)} – ${hh((h + 1) % 24)}` }),
      el('div', { text: n ? `${num(n)} usuarios con la app abierta` : 'Nadie con la app abierta' }),
      el('div', { class: 'dim', text: `Intensidad ${levelOf(n, max)} de ${LEVELS} · ${pct(n, max)}% del pico` }),
      el('div', { class: 'dim', text: `Hora mas fuerte del ${DAYS[d].toLowerCase()}: ${num(dayTotal[d])} usuarios` }),
    );
    tip.style.display = 'block';
    const box = wrap.getBoundingClientRect();
    const x = e.clientX - box.left + 14;
    tip.style.left = `${Math.min(x, box.width - tip.offsetWidth)}px`;
    tip.style.top = `${e.clientY - box.top + 14}px`;
  });
  grid.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
    if (hovered) hovered.style.outline = '';
    hovered = null;
  });

  // Leyenda: que es cada cuadro y que significa cada intensidad, con su tramo.
  // Valores que caen en cada nivel (inverso de levelOf); vacio si el pico es pequeno.
  const range = (lv) => {
    const lo = Math.floor(((lv - 1) * max) / LEVELS) + 1;
    const hi = Math.floor((lv * max) / LEVELS);
    if (lo > hi) return null;
    return lo === hi ? num(hi) : `${num(lo)}–${num(hi)}`;
  };
  const swatch = (lv, label) => el('span', { style: 'display:flex;align-items:center;gap:4px' },
    el('span', { style: `width:16px;height:16px;border-radius:3px;background:${levelColor(lv)}` }), label);
  const legend = el('div', { style: 'margin-top:var(--s-3);font-size:var(--fs-xs);color:var(--muted)' },
    el('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap' },
      el('span', { text: 'Usuarios a la vez:' }),
      swatch(0, '0'),
      ...Array.from({ length: LEVELS }, (_, k) => (range(k + 1) ? swatch(k + 1, range(k + 1)) : null))),
    el('div', { style: 'margin-top:6px', text:
      `Como se lee: cada cuadro es una hora de un dia de la semana (filas = dias, columnas = horas). Cuanto mas intenso el color, mas usuarios distintos tenian la app abierta en esa hora, sumando todas las semanas del periodo.${peak ? ` Pico: ${DAYS[peak.dow - 1].toLowerCase()} a las ${hh(peak.hour)} con ${num(peak.users)} usuarios.` : ''}` }),
  );

  return el('div', {}, wrap, legend);
}

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
    draw: (body, rows) => { body.replaceChildren(heatmapGrid(rows)); return null; },
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
