import { api } from '../api.js';
import { el, num, skeleton } from '../format.js';
import { barChart, COLORS } from '../charts.js';
import { renderMap, updateMapPoints } from './geo.js';

// Historial de 48 h: un histograma de apps abiertas y un cursor para ver el
// mapa en cualquier instante de ese rango.
const HOURS = 48;
const BUCKET_MIN = 15;
const STEP_MIN = 15; // un paso del cursor = una barra
const PLAY_MS = 400;
// Igual que "app abierta" en vivo: sin latido en 5 min ya no cuenta.
const GRACE_MS = 5 * 60 * 1000;

const fmt = (ms) => new Date(ms).toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export async function geoHistoryPage(view) {
  view.append(skeleton(3));
  const rows = await api.get('/api/dashboard/geo/history');
  const sessions = rows.map((r) => ({ ...r, s: Date.parse(r.start), e: Date.parse(r.end) + GRACE_MS }));

  const now = Date.now();
  const from = now - HOURS * 3600 * 1000;
  const openAt = (t) => sessions.filter((x) => x.s <= t && x.e >= t);

  const buckets = HOURS * 60 / BUCKET_MIN;
  const bucketMs = BUCKET_MIN * 60 * 1000;
  const counts = Array.from({ length: buckets }, (_, i) => {
    const a = from + i * bucketMs, b = a + bucketMs;
    return sessions.filter((x) => x.s < b && x.e > a).length;
  });
  const labels = counts.map((_, i) => fmt(from + i * bucketMs));

  const slider = el('input', { type: 'range', min: 0, max: HOURS * 60 / STEP_MIN, value: HOURS * 60 / STEP_MIN });
  const timeLabel = el('b');
  const playBtn = el('button', { class: 'btn', title: 'Reproducir', text: '▶' });
  const countLabel = el('div', { class: 'map-stat-value' });
  const mapDiv = el('div', { id: 'map-canvas' });
  const canvas = el('canvas');

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Historial geografico' }),
        el('div', { class: 'sub', text: `Apps abiertas en las ultimas ${HOURS} h. Mueve el cursor o pulsa una barra para ver ese momento` }))
    ),
    el('div', { class: 'card' },
      el('div', { id: 'map-wrap' }, mapDiv,
        el('div', { class: 'map-stat-card' },
          el('div', { class: 'map-stat-label', text: 'Apps abiertas' }), countLabel)),
      el('div', { class: 'chart-box', style: 'height:120px;margin-top:var(--s-4)' }, canvas),
      el('div', { class: 'geo-time' }, playBtn, slider, timeLabel)
    )
  );

  const chart = barChart(canvas, labels, counts, { label: 'Apps abiertas' });

  const show = () => {
    const t = from + slider.value * STEP_MIN * 60 * 1000;
    const points = openAt(t);
    timeLabel.textContent = Number(slider.value) === Number(slider.max) ? 'Ahora' : fmt(t);
    countLabel.textContent = num(points.length);
    updateMapPoints(points);
    const active = Math.min(buckets - 1, Math.floor((t - from) / bucketMs));
    chart.data.datasets[0].backgroundColor = counts.map((_, i) => (i === active ? COLORS.accent : COLORS.muted + '80'));
    chart.update('none');
  };

  chart.options.onClick = (_, els) => {
    if (!els.length) return;
    slider.value = els[0].index;
    show();
  };
  slider.addEventListener('input', show);

  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; playBtn.textContent = '▶'; };
  playBtn.addEventListener('click', () => {
    if (timer) return stop();
    if (Number(slider.value) >= Number(slider.max)) slider.value = 0;
    playBtn.textContent = '❚❚';
    timer = setInterval(() => {
      // Se navego a otra pagina: el cursor ya no esta en el DOM.
      if (!slider.isConnected || Number(slider.value) >= Number(slider.max)) return stop();
      slider.value = Number(slider.value) + 1;
      show();
    }, PLAY_MS);
  });

  renderMap(mapDiv, openAt(now));
  show();
}
