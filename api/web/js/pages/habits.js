import { api, state } from '../api.js';
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

export async function habitsPage(view) {
  const myId = ++renderId;
  view.append(skeleton(4));

  const d = await api.get(`/api/dashboard/habits?days=${state.days}`);
  if (myId !== renderId) return;

  const totalHours = d.hours.rows.reduce((acc, r) => acc + r.hours, 0);
  const last = d.stickiness[d.stickiness.length - 1] || { dau: 0, wau: 0, mau: 0 };
  const avgStick = d.stickiness.length
    ? Math.round(d.stickiness.reduce((acc, r) => acc + pct(r.dau, r.mau), 0) / d.stickiness.length)
    : 0;
  const churned = d.churn.rows.reduce((acc, r) => acc + r.churned, 0);
  const recovered = d.churn.rows.reduce((acc, r) => acc + r.recovered, 0);

  const cDur = el('canvas');
  const cHours = el('canvas');
  const cStick = el('canvas');
  const cChurn = el('canvas');
  const unit = d.hours.unit === 'week' ? 'semana' : 'dia';

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Habitos' }),
        el('div', { class: 'sub', text: `Cuanto y con que constancia se usa la app en los ultimos ${state.days} dias` }))
    ),

    el('div', { class: 'kpis' },
      kpi('Horas de uso', num(Math.round(totalHours)), 'sesiones cerradas del periodo', 'accent'),
      kpi('DAU / MAU hoy', `${pct(last.dau, last.mau)}%`, `${num(last.dau)} hoy de ${num(last.mau)} en 30 dias`, 'cyan'),
      kpi('DAU / MAU medio', `${avgStick}%`, 'media del periodo'),
      kpi('Perdidos', num(churned), `${d.churn.days}+ dias sin abrir la app`, 'yellow'),
      kpi('Recuperados', num(recovered), `volvieron tras ${d.churn.days}+ dias`, 'green'),
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Cuando se usa la app (dia x hora)' }),
      el('div', { class: 'kpi-sub', style: 'margin:0 0 var(--s-3)', text: 'Usuarios distintos con la app abierta en cada hora, en la hora local de cada uno (aproximada por su ubicacion). Sirve para elegir cuando publicar actualizaciones o hacer mantenimiento.' }),
      heatmapGrid(d.heatmap)),
    section('Duracion de sesion',
      'Separa a quien abre y cierra la app de quien hace directos largos. La media esconde esa diferencia.', cDur),
    section(`Horas totales de uso por ${unit}`,
      'Crecimiento real de uso, no solo de usuarios. Por encima de 90 dias se agrupa por semana.', cHours),
    section('DAU / MAU (stickiness)',
      'Que porcentaje de los usuarios de los ultimos 30 dias abrio la app ese dia (DAU) o esa semana (WAU).', cStick),
    section('Usuarios perdidos y recuperados',
      `Perdido: su ultima sesion de la semana fue seguida de ${d.churn.days}+ dias sin volver. Recuperado: volvio tras un hueco igual. Las 2 ultimas semanas aun no son definitivas.`, cChurn),
  );

  barChart(cDur, d.durations.map((r) => r.bucket), d.durations.map((r) => r.sessions), { label: 'Sesiones' });
  barChart(cHours, d.hours.rows.map((r) => r.day.slice(5)), d.hours.rows.map((r) => r.hours),
    { label: 'Horas', color: COLORS.accent2 });
  lineChart(cStick, d.stickiness.map((r) => r.day.slice(5)), [
    { label: 'DAU / MAU %', data: d.stickiness.map((r) => pct(r.dau, r.mau)), color: COLORS.accent, fill: false },
    { label: 'WAU / MAU %', data: d.stickiness.map((r) => pct(r.wau, r.mau)), color: COLORS.accent2, fill: false },
  ], { max: 100 });
  groupedBarChart(cChurn, d.churn.rows.map((r) => r.week.slice(5)), [
    { label: 'Perdidos', data: d.churn.rows.map((r) => r.churned), color: COLORS.warn },
    { label: 'Recuperados', data: d.churn.rows.map((r) => r.recovered), color: COLORS.ok },
  ], { max: undefined });
}
