import { api } from '../api.js';
import { el, num, skeleton } from '../format.js';
import { barChart, COLORS } from '../charts.js';
import { renderMap, updateMapPoints } from './geo.js';

// Historial geografico: un histograma de apps abiertas y un cursor para ver el
// mapa en cualquier momento del rango. Cuanto mas largo el rango, mas gruesa la barra.
const H = 3600 * 1000;
const RANGES = [
  { label: '48 h', days: 2, bucketMs: H / 4 },
  { label: '7 dias', days: 7, bucketMs: H },
  { label: '30 dias', days: 30, bucketMs: 6 * H },
  { label: '90 dias', days: 90, bucketMs: 24 * H },
  { label: '365 dias', days: 365, bucketMs: 24 * H },
];
const PLAY_MS = 400; // por barra a velocidad x1
const SPEEDS = [1, 2, 4, 8];
// Igual que "app abierta" en vivo: sin latido en 5 min ya no cuenta.
const GRACE_MS = 5 * 60 * 1000;

let range = RANGES[0];
let speed = 1;
let onKey = null;

export async function geoHistoryPage(view) {
  view.append(skeleton(3));
  const rows = await api.get(`/api/dashboard/geo/history?days=${range.days}`);
  const sessions = rows.map((r) => ({ ...r, s: Date.parse(r.start), e: Date.parse(r.end) + GRACE_MS }));

  const { bucketMs } = range;
  const buckets = Math.ceil(range.days * 24 * H / bucketMs);
  const now = Date.now();
  const from = now - buckets * bucketMs;
  const daily = bucketMs >= 24 * H;
  const fmt = (ms) => new Date(ms).toLocaleString('es', daily
    ? { day: '2-digit', month: 'short', year: '2-digit' }
    : { weekday: 'short', day: range.days > 2 ? '2-digit' : undefined, hour: '2-digit', minute: '2-digit' });

  // Una app por usuario y tramo: la ultima sesion que se solapa con el tramo.
  const openIn = (i) => {
    const a = from + i * bucketMs, b = a + bucketMs;
    const byUser = new Map();
    for (const x of sessions) if (x.s < b && x.e > a && (!byUser.has(x.machine_id) || x.s > byUser.get(x.machine_id).s)) byUser.set(x.machine_id, x);
    return [...byUser.values()];
  };
  const last = buckets - 1;
  const points = Array.from({ length: buckets }, (_, i) => openIn(i));
  const counts = points.map((p) => p.length);
  const labels = counts.map((_, i) => fmt(from + i * bucketMs));

  const slider = el('input', { type: 'range', min: 0, max: last, value: last });
  const timeLabel = el('b');
  const playBtn = el('button', { class: 'btn', title: 'Reproducir', text: '▶' });
  const countLabel = el('div', { class: 'map-stat-value' });
  const mapDiv = el('div', { id: 'map-canvas' });
  const canvas = el('canvas');
  const prevBtn = el('button', { class: 'btn', title: 'Paso atras (←)', text: '◀' });
  const nextBtn = el('button', { class: 'btn', title: 'Paso adelante (→)', text: '▶|' });
  const speedSel = el('select', { class: 'field', 'aria-label': 'Velocidad', title: 'Velocidad de reproduccion' },
    ...SPEEDS.map((v) => el('option', { value: v, selected: v === speed }, `x${v}`)));
  const sel = el('select', { class: 'field', 'aria-label': 'Rango del historial' },
    ...RANGES.map((r) => el('option', { value: r.days, selected: r === range }, r.label)));
  sel.addEventListener('change', () => {
    range = RANGES.find((r) => r.days === Number(sel.value));
    geoHistoryPage(view);
  });

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Historial geografico' }),
        el('div', { class: 'sub', text: `Apps abiertas en los ultimos ${range.label}. Mueve el cursor o pulsa una barra para ver ese momento` })),
      sel
    ),
    el('div', { class: 'card' },
      el('div', { id: 'map-wrap' }, mapDiv,
        el('div', { class: 'map-stat-card' },
          el('div', { class: 'map-stat-label', text: 'Apps abiertas' }), countLabel)),
      el('div', { class: 'chart-box', style: 'height:120px;margin-top:var(--s-4)' }, canvas),
      el('div', { class: 'geo-time' }, prevBtn, playBtn, nextBtn, slider, speedSel, timeLabel)
    )
  );

  const chart = barChart(canvas, labels, counts, { label: 'Apps abiertas' });
  // Pocas etiquetas, rectas: con cientos de barras las rotadas no se leen.
  Object.assign(chart.options.scales.x.ticks ||= {}, { maxTicksLimit: 12, maxRotation: 0, autoSkip: true });

  const show = () => {
    const i = Number(slider.value);
    timeLabel.textContent = i === last ? 'Ahora' : fmt(from + i * bucketMs);
    countLabel.textContent = num(counts[i]);
    updateMapPoints(points[i]);
    chart.data.datasets[0].backgroundColor = counts.map((_, k) => (k === i ? COLORS.accent : COLORS.muted + '80'));
    chart.update('none');
  };

  chart.options.onClick = (_, els) => {
    if (!els.length) return;
    slider.value = els[0].index;
    show();
  };
  slider.addEventListener('input', show);

  const go = (i) => { slider.value = Math.min(last, Math.max(0, i)); show(); };
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; playBtn.textContent = '▶'; };
  const play = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      // Se navego a otra pagina: el cursor ya no esta en el DOM.
      if (!slider.isConnected || Number(slider.value) >= last) return stop();
      go(Number(slider.value) + 1);
    }, PLAY_MS / speed);
  };
  const toggle = () => {
    if (timer) return stop();
    if (Number(slider.value) >= last) slider.value = 0;
    playBtn.textContent = '❚❚';
    play();
  };
  playBtn.addEventListener('click', toggle);
  prevBtn.addEventListener('click', () => { stop(); go(Number(slider.value) - 1); });
  nextBtn.addEventListener('click', () => { stop(); go(Number(slider.value) + 1); });
  speedSel.addEventListener('change', () => { speed = Number(speedSel.value); if (timer) play(); });

  // Teclado: ← → un paso, espacio reproduce. Se desengancha solo al salir de la pagina.
  if (onKey) document.removeEventListener('keydown', onKey);
  onKey = (e) => {
    if (!slider.isConnected) { document.removeEventListener('keydown', onKey); return stop(); }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target !== slider) return;
    if (e.key === 'ArrowLeft') { stop(); go(Number(slider.value) - 1); }
    else if (e.key === 'ArrowRight') { stop(); go(Number(slider.value) + 1); }
    else if (e.key === ' ') toggle();
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  renderMap(mapDiv, points[last]);
  show();
}
