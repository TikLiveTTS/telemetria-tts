import { api, state } from '../api.js';
import { el, num, skeleton, CONNECTOR_LABELS, prettyEvent } from '../format.js';
import { lineChart, updateChart, SERIES } from '../charts.js';

// Que partes de la app usa la gente de verdad. Una tarjeta por conector.

// Agrupar filas crudas por conector, quedandose con el pico de usuarios del periodo.
function groupByConnector(rows) {
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
  return [...byConnector.values()].sort((a, b) => b.users - a.users);
}

// Refs de modulo para poder patchear in-place en featuresRefresh sin
// reconstruir el DOM (asi no se pierde scroll ni estado de la pagina).
let cardRefs = new Map();
let cardsWrap = null;
let renderId = 0;

export async function featuresPage(view) {
  const myId = ++renderId;
  view.append(skeleton(4));

  const rows = await api.get(`/api/dashboard/features?days=${state.days}`);
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba
  const groups = groupByConnector(rows);

  cardRefs = new Map();
  cardsWrap = null;

  if (groups.length) {
    cardsWrap = el('div', { class: 'grid-3' });
    for (const g of groups) {
      const refs = buildCard(g);
      cardRefs.set(g.connector, refs);
      cardsWrap.append(refs.node);
    }
  }

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {},
        el('h2', { text: 'Funciones' }),
        el('div', { class: 'sub', text: `Uso por conector en los ultimos ${state.days} dias. El % es sobre usuarios activos del periodo.` })
      )
    ),
    cardsWrap
      ? cardsWrap
      : el('div', { class: 'card' },
          el('div', { class: 'empty', text: 'Todavia no hay eventos agregados. El rollup corre cada hora.' }))
  );
}

export async function featuresRefresh(view) {
  if (!cardsWrap) {
    // Estado vacio inicial (sin cards que patchear): rebuild completo.
    await featuresPage(view);
    return;
  }

  const myId = renderId;
  const rows = await api.get(`/api/dashboard/features?days=${state.days}`);
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba
  const groups = groupByConnector(rows);
  const seen = new Set();

  for (const g of groups) {
    seen.add(g.connector);
    const existing = cardRefs.get(g.connector);
    if (existing) {
      patchCard(existing, g);
    } else {
      // Conector nuevo que no estaba antes: crear su card al final.
      const refs = buildCard(g);
      cardRefs.set(g.connector, refs);
      cardsWrap.append(refs.node);
    }
  }

  for (const [connector, refs] of cardRefs) {
    if (!seen.has(connector)) {
      refs.node.remove();
      cardRefs.delete(connector);
    }
  }
}

function buildCard(g) {
  const pct = g.events.length ? Number(g.events[0].pct_users) : 0;

  const usersEl = el('div', { class: 'kpi-value accent', style: 'font-size:1.5rem', text: num(g.users) });
  const countEl = el('div', { class: 'kpi-sub', text: `${num(g.count)} eventos` });
  const barEl = el('div', { style: `height:100%;width:${Math.min(100, pct)}%;background:var(--accent)` });
  const pctEl = el('div', { class: 'kpi-sub', text: `${pct || 0}% de los activos del periodo` });
  const eventsEl = el('div', { style: 'margin-top:10px;font-size:var(--fs-xs);color:var(--muted)' });
  fillEvents(eventsEl, g);

  const node = el('div', { class: 'card clickable', style: 'cursor:pointer',
    onclick: () => { location.hash = `#/features/${g.connector}`; } },
    el('div', { class: 'kpi-label', text: CONNECTOR_LABELS[g.connector] || g.connector }),
    el('div', { class: 'dim', style: 'font-size:var(--fs-xs)', text: g.connector }),
    el('div', { style: 'display:flex;align-items:baseline;gap:8px' },
      usersEl,
      el('span', { class: 'dim', style: 'font-size:var(--fs-xs)', text: 'usuarios' })
    ),
    countEl,

    // Barra de penetracion
    el('div', { style: 'height:6px;border-radius:3px;background:var(--surface-3);margin-top:10px;overflow:hidden' },
      barEl),
    pctEl,

    eventsEl
  );

  return { node, usersEl, countEl, barEl, pctEl, eventsEl };
}

function patchCard(refs, g) {
  const pct = g.events.length ? Number(g.events[0].pct_users) : 0;

  refs.usersEl.textContent = num(g.users);
  refs.countEl.textContent = `${num(g.count)} eventos`;
  refs.barEl.style.width = `${Math.min(100, pct)}%`;
  refs.pctEl.textContent = `${pct || 0}% de los activos del periodo`;
  fillEvents(refs.eventsEl, g);
}

function fillEvents(eventsEl, g) {
  const top = g.events
    .slice()
    .sort((a, b) => Number(b.count) - Number(a.count))
    .slice(0, 4);

  const nodes = [];
  top.forEach((e, i) => {
    nodes.push(el('span', { title: e.name, text: `${prettyEvent(e.name)}: ${num(e.count)}` }));
    if (i < top.length - 1) nodes.push(document.createTextNode(' · '));
  });
  eventsEl.replaceChildren(...nodes);
}

// Refs de modulo para featureDetailRefresh: si el chart todavia no existe o
// cambio el conector mostrado, cae a un rebuild completo de la pagina.
let detailChart = null;
let detailConnector = null;

export async function featureDetailPage(view, connector) {
  const myId = ++renderId;
  view.append(skeleton(3));

  const rows = await api.get(`/api/dashboard/features/${encodeURIComponent(connector)}?days=${state.days}`);
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba

  // Pivot: una serie por nombre de evento.
  const days = [...new Set(rows.map((r) => String(r.day).slice(0, 10)))].sort();
  const names = [...new Set(rows.map((r) => r.name))];
  const index = new Map(rows.map((r) => [`${String(r.day).slice(0, 10)}|${r.name}`, r]));

  detailChart = null;
  detailConnector = connector;

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {},
        el('h2', { text: CONNECTOR_LABELS[connector] || connector }),
        el('div', { class: 'dim', style: 'font-size:var(--fs-xs)', text: connector }),
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

  detailChart = lineChart(
    document.getElementById('c-feat'),
    days.map((d) => d.slice(5)),
    names.map((name, i) => ({
      label: prettyEvent(name),
      data: days.map((d) => Number(index.get(`${d}|${name}`)?.count || 0)),
      color: SERIES[i % SERIES.length],
      fill: false,
    }))
  );
}

export async function featureDetailRefresh(view, param) {
  if (!detailChart || detailConnector !== param) {
    await featureDetailPage(view, param);
    return;
  }

  const myId = renderId;
  const rows = await api.get(`/api/dashboard/features/${encodeURIComponent(param)}?days=${state.days}`);
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba

  const days = [...new Set(rows.map((r) => String(r.day).slice(0, 10)))].sort();
  const names = [...new Set(rows.map((r) => r.name))];
  const index = new Map(rows.map((r) => [`${String(r.day).slice(0, 10)}|${r.name}`, r]));

  if (!days.length) {
    // Se quedo sin datos: cae a rebuild completo (pasa al estado vacio).
    await featureDetailPage(view, param);
    return;
  }

  updateChart(
    detailChart,
    days.map((d) => d.slice(5)),
    names.map((name) => days.map((d) => Number(index.get(`${d}|${name}`)?.count || 0)))
  );
}
