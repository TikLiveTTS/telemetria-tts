import { el, num } from '../format.js';
import { lineChart, COLORS } from '../charts.js';

// "Cuando se usa la app": lineas por dia, reloj de 24 h y barras por dia.
// Todo sale de las mismas filas {dow 1..7, hour 0..23, users}.

const DAYS = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];
// Un tono por dia, de burdeos a rosa claro (la paleta roja del panel).
const TONES = ['#9f1239', '#be123c', '#e11d48', COLORS.accent, '#fb6f8a', '#fda4af', '#fecdd3'];
const hh = (h) => `${String(h % 24).padStart(2, '0')}:00`;
const dim = (c) => `color-mix(in srgb, ${c} 22%, transparent)`;
const WIN = 4; // ancho de las franjas "mas activa" / "menos activa"

// Ventana circular de WIN horas con mayor (dir=1) o menor (dir=-1) suma.
function window24(totals, dir) {
  let best = 0;
  let bestSum = null;
  for (let h = 0; h < 24; h++) {
    let s = 0;
    for (let k = 0; k < WIN; k++) s += totals[(h + k) % 24];
    if (bestSum === null || (s - bestSum) * dir > 0) { best = h; bestSum = s; }
  }
  return `${hh(best)}–${hh(best + WIN)}`;
}

function peakLabel(chart, peak) {
  return {
    id: 'peak',
    afterDatasetsDraw(c) {
      if (!c.isDatasetVisible(peak.dow)) return;
      const pt = c.getDatasetMeta(peak.dow).data[peak.hour];
      if (!pt) return;
      const { ctx, chartArea: a } = c;
      const text = `Pico: ${DAYS[peak.dow]} · ${hh(peak.hour)} · ${num(peak.users)} usuarios`;
      ctx.save();
      ctx.font = '600 11px sans-serif';
      const w = ctx.measureText(text).width + 16;
      const x = Math.max(a.left, Math.min(pt.x - w / 2, a.right - w));
      const y = Math.max(2, pt.y - 34);
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt.x, a.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#000'; ctx.strokeStyle = COLORS.accent;
      ctx.beginPath(); ctx.roundRect(x, y, w, 22, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 8, y + 11);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.restore();
    },
  };
}

// Lineas: una por dia. Leyenda propia (clic = ocultar, hover = resaltar).
function lines(grid, peak) {
  const canvas = el('canvas');
  const chart = lineChart(canvas, Array.from({ length: 24 }, (_, h) => hh(h)),
    DAYS.map((d, i) => ({ label: d, data: grid[i], color: TONES[i], fill: false, pointRadius: 0, pointHoverRadius: 4 })));
  chart.options.plugins.legend.display = false;
  chart.config.plugins = [peakLabel(chart, peak)];

  const paint = (hl) => {
    chart.data.datasets.forEach((ds, i) => {
      ds.borderColor = hl === null || hl === i ? TONES[i] : dim(TONES[i]);
      ds.borderWidth = hl === i ? 3 : 2;
    });
    chart.update('none');
  };
  chart.options.onHover = (e, active) => paint(active.length ? active[0].datasetIndex : null);
  chart.options.interaction = { mode: 'nearest', axis: 'x', intersect: false };
  chart.options.plugins.tooltip.mode = 'index';
  chart.options.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${num(c.parsed.y)}` };
  chart.update();

  const legend = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:var(--s-3);font-size:var(--fs-xs)' },
    ...DAYS.map((d, i) => {
      const b = el('button', {
        type: 'button', 'aria-pressed': 'true',
        style: `display:flex;align-items:center;gap:6px;background:none;border:0;color:var(--text-dim);cursor:pointer;padding:2px 0;font:inherit`,
      }, el('span', { style: `width:16px;height:3px;border-radius:2px;background:${TONES[i]}` }), d);
      b.addEventListener('mouseenter', () => paint(i));
      b.addEventListener('mouseleave', () => paint(null));
      b.addEventListener('click', () => {
        const on = !chart.isDatasetVisible(i);
        chart.setDatasetVisibility(i, on);
        b.setAttribute('aria-pressed', on);
        b.style.opacity = on ? 1 : .35;
        chart.update();
      });
      return b;
    }));
  return { node: el('div', {}, el('div', { class: 'chart-box tall' }, canvas), legend), chart };
}

// Anillo de 24 segmentos (0:00 arriba, sentido horario) coloreados por actividad.
function ring(totals) {
  const NS = 'http://www.w3.org/2000/svg';
  const max = Math.max(1, ...totals);
  const R = 92; const r = 66; const C = 110;
  const pt = (rad, a) => `${(C + rad * Math.sin(a)).toFixed(2)},${(C - rad * Math.cos(a)).toFixed(2)}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 220 220');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Actividad por hora en un reloj de 24 horas');
  svg.style.cssText = 'width:100%;max-width:240px;display:block';
  totals.forEach((n, h) => {
    const a0 = (h * 2 * Math.PI) / 24 + 0.02;
    const a1 = ((h + 1) * 2 * Math.PI) / 24 - 0.02;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${pt(R, a0)} A${R},${R} 0 0 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 0 0 ${pt(r, a0)}Z`);
    p.setAttribute('fill', `color-mix(in srgb, ${COLORS.accent} ${Math.round((n / max) * 100)}%, #2a1218)`);
    const t = document.createElementNS(NS, 'title');
    t.textContent = `${hh(h)} – ${hh(h + 1)}: ${num(n)} usuarios (suma de los 7 dias)`;
    p.append(t);
    svg.append(p);
  });
  [0, 6, 12, 18].forEach((h) => {
    const [x, y] = pt(R + 12, (h * 2 * Math.PI) / 24).split(',');
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('font-size', '9'); t.setAttribute('fill', COLORS.muted);
    t.textContent = hh(h);
    svg.append(t);
  });
  return el('div', { style: 'position:relative;width:240px;max-width:100%' }, svg,
    el('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center' },
      el('div', { style: 'font-size:22px', text: '👥' }),
      el('div', { style: 'font-size:var(--fs-sm);font-weight:600', text: 'Actividad por hora' }),
      el('div', { class: 'dim', style: 'font-size:var(--fs-xs)', text: '24 h' })));
}

// Barras horizontales ordenadas de mas a menos actividad media.
function bars(grid) {
  const avg = grid.map((d) => d.reduce((a, b) => a + b, 0) / 24);
  const order = avg.map((v, i) => i).sort((a, b) => avg[b] - avg[a]);
  const top = avg[order[0]] || 1;
  return el('div', { style: 'display:grid;gap:10px' }, ...order.map((i, rank) => {
    const w = Math.max(2, (avg[i] / top) * 100);
    const fill = rank === 0 ? COLORS.accent : `color-mix(in srgb, ${COLORS.accent} ${Math.max(25, 80 - rank * 9)}%, #2a1218)`;
    return el('div', { style: 'display:grid;grid-template-columns:78px 1fr 54px;align-items:center;gap:10px;font-size:var(--fs-sm)' },
      el('span', { style: rank === 0 ? 'font-weight:600' : 'color:var(--text-dim)', text: DAYS[i] }),
      el('div', { style: 'background:var(--surface-2);border-radius:999px;height:12px' },
        el('div', { title: `${DAYS[i]}: ${avg[i].toFixed(1)} usuarios de media por hora`, style: `width:${w}%;height:100%;border-radius:999px;background:${fill}` })),
      el('span', { class: rank === 0 ? '' : 'dim', style: 'text-align:right', text: `≈ ${num(Math.round(avg[i]))}` }));
  }));
}

const stat = (label, value, color) => el('div', { style: `border-left:3px solid ${color};padding-left:var(--s-3)` },
  el('div', { class: 'dim', style: 'font-size:var(--fs-xs)', text: label }),
  el('div', { style: 'font-size:var(--fs-lg);font-weight:600', text: value }));

// Devuelve el chart de lineas para que `panel` lo destruya al cambiar de rango.
export function usageView(body, rows) {
  const peak = rows.reduce((a, r) => (r.users > (a?.users || 0) ? { dow: r.dow - 1, hour: r.hour, users: r.users } : a), null);
  if (!peak) { body.replaceChildren(el('div', { class: 'empty', text: 'Sin actividad en este periodo' })); return null; }

  const grid = DAYS.map(() => new Array(24).fill(0));
  rows.forEach((r) => { grid[r.dow - 1][r.hour] = r.users; });
  const totals = Array.from({ length: 24 }, (_, h) => grid.reduce((a, d) => a + d[h], 0));
  const quiet = window24(totals, -1);
  const { node, chart } = lines(grid, peak);

  const cols = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--s-6);margin-top:var(--s-5);padding-top:var(--s-5);border-top:1px solid var(--border-soft)';
  body.replaceChildren(node, el('div', { style: cols },
    el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--s-5);align-items:center' },
      ring(totals),
      el('div', { style: 'display:grid;gap:var(--s-4);flex:1;min-width:150px' },
        stat('Horas mas activas', window24(totals, 1), COLORS.accent),
        stat('Menor actividad', quiet, '#6b2230'),
        el('div', { style: 'display:flex;gap:var(--s-2);font-size:var(--fs-sm);color:var(--text-dim)' },
          el('span', { text: '🌙🛠' }),
          el('span', {}, 'Mejor momento para mantenimiento: ', el('b', { style: `color:${COLORS.accent}`, text: quiet }))))),
    el('div', {},
      el('div', { style: 'font-weight:600;margin-bottom:var(--s-3)', text: 'Actividad promedio por dia' }),
      bars(grid))));
  return chart;
}
