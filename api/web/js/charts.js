// Factories de Chart.js con el tema del panel aplicado una sola vez.
// Los graficos vivos se registran para poder destruirlos al cambiar de pagina:
// sin eso, Chart.js deja canvas huerfanos y se come la memoria.

const css = getComputedStyle(document.documentElement);
const token = (name, fallback) => (css.getPropertyValue(name) || fallback).trim();

export const COLORS = {
  accent: token('--accent', '#fe2c55'),
  accent2: token('--accent-2', '#25f4ee'),
  ok: token('--ok', '#22c55e'),
  warn: token('--warn', '#f59e0b'),
  err: token('--err', '#f87171'),
  twitch: token('--twitch', '#9146ff'),
  youtube: token('--youtube', '#ff4444'),
  muted: token('--muted', '#777'),
  surface: token('--surface', '#141414'),
};

export const SERIES = [
  COLORS.accent, COLORS.accent2, COLORS.warn, COLORS.ok,
  COLORS.twitch, '#60a5fa', COLORS.err, '#a78bfa',
];

const GRID = 'rgba(255,255,255,.05)';

const live = new Set();

export function destroyCharts() {
  for (const c of live) {
    try { c.destroy(); } catch (_) { /* ya destruido */ }
  }
  live.clear();
}

function build(canvas, config) {
  const chart = new Chart(canvas, config);
  live.add(chart);
  return chart;
}

const axis = (extra = {}) => ({
  ticks: { color: COLORS.muted, font: { size: 10 }, ...extra },
  grid: { color: GRID, drawBorder: false },
});

const base = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { labels: { color: '#ccc', font: { size: 11 }, boxWidth: 12, usePointStyle: true } },
    tooltip: {
      backgroundColor: '#000', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
      padding: 10, titleFont: { size: 11 }, bodyFont: { size: 11 },
    },
  },
};

export function lineChart(canvas, labels, datasets) {
  return build(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        tension: .35,
        pointRadius: labels.length > 45 ? 0 : 2.5,
        pointHoverRadius: 4,
        borderWidth: 2,
        borderColor: d.color || SERIES[i % SERIES.length],
        backgroundColor: (d.color || SERIES[i % SERIES.length]) + '20',
        fill: d.fill !== false,
        ...d,
      })),
    },
    options: { ...base, scales: { x: axis({ maxTicksLimit: 12 }), y: axis({ beginAtZero: true, precision: 0 }) } },
  });
}

export function barChart(canvas, labels, data, { horizontal = false, color = COLORS.accent, label = '' } = {}) {
  return build(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: color + 'b3',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...base,
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { ...base.plugins, legend: { display: false } },
      scales: { x: axis({ beginAtZero: true }), y: axis({ beginAtZero: true, precision: 0 }) },
    },
  });
}

export function doughnutChart(canvas, labels, data) {
  return build(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => SERIES[i % SERIES.length]),
        borderColor: COLORS.surface,
        borderWidth: 2,
      }],
    },
    options: {
      ...base,
      cutout: '62%',
      plugins: {
        ...base.plugins,
        legend: { position: 'right', labels: { color: '#ccc', font: { size: 11 }, boxWidth: 10, padding: 10, usePointStyle: true } },
      },
    },
  });
}

export function groupedBarChart(canvas, labels, datasets) {
  return build(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        backgroundColor: (d.color || SERIES[i % SERIES.length]) + 'b3',
        borderColor: d.color || SERIES[i % SERIES.length],
        borderWidth: 1,
        borderRadius: 4,
        ...d,
      })),
    },
    options: { ...base, scales: { x: axis(), y: axis({ beginAtZero: true, max: 100 }) } },
  });
}
