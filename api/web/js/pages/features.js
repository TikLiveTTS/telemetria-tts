import { api, state } from '../api.js';
import { el, num, skeleton } from '../format.js';
import { lineChart, SERIES } from '../charts.js';

// Que partes de la app usa la gente de verdad. Una tarjeta por conector.

const LABELS = {
  app: 'Ciclo de vida',
  creators: 'Identidad de canales',
  platforms: 'Conexiones de chat',
  tts: 'Lectura TTS',
  music: 'Bot de musica',
  soundpad: 'Soundpad',
  obs: 'OBS',
  mobile: 'Panel movil',
  overlays: 'Overlays',
  moderation: 'Moderacion',
  updates: 'Actualizaciones',
  errors: 'Errores',
  settings: 'Ajustes',
};

export async function featuresPage(view) {
  view.append(skeleton(4));

  const rows = await api.get(`/api/dashboard/features?days=${state.days}`);

  // Agrupar por conector, quedandose con el pico de usuarios del periodo.
  const byConnector = new Map();
  for (const r of rows) {
    if (!byConnector.has(r.connector)) {
      byConnector.set(r.connector, { connector: r.connector, users: 0, count: 0, events: [] });
    }
    const g = byConnector.get(r.connector);
    g.users = Math.max(g.users, r.users);
    g.count += Number(r.count);
    g.events.push(r);
  }

  const groups = [...byConnector.values()].sort((a, b) => b.users - a.users);

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {},
        el('h2', { text: 'Funciones' }),
        el('div', { class: 'sub', text: `Uso por conector en los ultimos ${state.days} dias. El % es sobre usuarios activos del periodo.` })
      )
    ),
    groups.length
      ? el('div', { class: 'grid-3' }, ...groups.map(card))
      : el('div', { class: 'card' },
          el('div', { class: 'empty', text: 'Todavia no hay eventos agregados. El rollup corre cada hora.' }))
  );
}

function card(g) {
  const pct = g.events.length ? Number(g.events[0].pct_users) : 0;

  return el('div', { class: 'card clickable', style: 'cursor:pointer',
    onclick: () => { location.hash = `#/features/${g.connector}`; } },
    el('div', { class: 'kpi-label', text: LABELS[g.connector] || g.connector }),
    el('div', { style: 'display:flex;align-items:baseline;gap:8px' },
      el('div', { class: 'kpi-value accent', style: 'font-size:1.5rem', text: num(g.users) }),
      el('span', { class: 'dim', style: 'font-size:var(--fs-xs)', text: 'usuarios' })
    ),
    el('div', { class: 'kpi-sub', text: `${num(g.count)} eventos` }),

    // Barra de penetracion
    el('div', { style: 'height:6px;border-radius:3px;background:var(--surface-3);margin-top:10px;overflow:hidden' },
      el('div', { style: `height:100%;width:${Math.min(100, pct)}%;background:var(--accent)` })),
    el('div', { class: 'kpi-sub', text: `${pct || 0}% de los activos` }),

    el('div', { style: 'margin-top:10px;font-size:var(--fs-xs);color:var(--muted)' },
      g.events
        .sort((a, b) => Number(b.count) - Number(a.count))
        .slice(0, 4)
        .map((e) => `${e.name}: ${num(e.count)}`)
        .join(' · ')
    )
  );
}

export async function featureDetailPage(view, connector) {
  view.append(skeleton(3));

  const rows = await api.get(`/api/dashboard/features/${encodeURIComponent(connector)}?days=${state.days}`);

  // Pivot: una serie por nombre de evento.
  const days = [...new Set(rows.map((r) => String(r.day).slice(0, 10)))].sort();
  const names = [...new Set(rows.map((r) => r.name))];
  const index = new Map(rows.map((r) => [`${String(r.day).slice(0, 10)}|${r.name}`, r]));

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {},
        el('h2', { text: LABELS[connector] || connector }),
        el('div', { class: 'sub', text: `Conector "${connector}" · ultimos ${state.days} dias` })
      ),
      el('a', { class: 'btn btn-sm', href: '#/features' }, '← Volver')
    ),
    days.length
      ? el('div', { class: 'card' },
          el('div', { class: 'section-title', text: 'Eventos por dia' }),
          el('div', { class: 'chart-box tall' }, el('canvas', { id: 'c-feat' }))
        )
      : el('div', { class: 'card' }, el('div', { class: 'empty', text: 'Sin datos para este conector' }))
  );

  if (!days.length) return;

  lineChart(
    document.getElementById('c-feat'),
    days.map((d) => d.slice(5)),
    names.map((name, i) => ({
      label: name,
      data: days.map((d) => Number(index.get(`${d}|${name}`)?.count || 0)),
      color: SERIES[i % SERIES.length],
      fill: false,
    }))
  );
}
