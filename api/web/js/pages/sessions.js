import { api, qs } from '../api.js';
import { el, clear, num, minutes, date, relative, avatar, platformPill, skeleton, CONNECTOR_LABELS, prettyEvent } from '../format.js';
import { openDrawer, closeDrawer } from '../drawer.js';

const ui = { page: 1, pageSize: 50, platform: '', country: '', version: '', q: '' };

let tbody, pagerInfo, pagePrev, pageNext;

export async function sessionsPage(view) {
  const search = el('input', {
    class: 'field', type: 'search', placeholder: 'Buscar machine_id o usr_...',
    value: ui.q, style: 'min-width:220px',
  });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { ui.q = search.value.trim(); ui.page = 1; load(); }, 300);
  });

  const platformSel = el('select', { class: 'field' },
    ...[['', 'Todas'], ['tiktok', 'TikTok'], ['twitch', 'Twitch'], ['youtube', 'YouTube']]
      .map(([v, l]) => el('option', { value: v, selected: v === ui.platform || null }, l))
  );
  platformSel.addEventListener('change', () => { ui.platform = platformSel.value; ui.page = 1; load(); });

  tbody = el('tbody');
  pagerInfo = el('span', { text: '—' });
  pagePrev = el('button', { class: 'btn btn-sm', onclick: () => { ui.page--; load(); } }, '← Anterior');
  pageNext = el('button', { class: 'btn btn-sm', onclick: () => { ui.page++; load(); } }, 'Siguiente →');

  view.append(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Sesiones' }),
        el('div', { class: 'sub', text: 'Cada arranque de la app. Clic en una fila para ver su timeline de eventos.' })),
      el('div', { class: 'filters', style: 'margin:0' },
        search, platformSel,
        el('a', { class: 'btn btn-sm', href: '/api/export/sessions.csv' }, '⬇ CSV'),
        el('a', { class: 'btn btn-sm', href: '/api/export/sessions.json' }, '⬇ JSON')
      )
    ),
    el('div', { class: 'card' },
      el('div', { class: 'table-wrap' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { text: 'Usuario' }),
            el('th', { text: 'Creador' }),
            el('th', { text: 'Pais' }),
            el('th', { text: 'Version' }),
            el('th', { text: 'Plataformas' }),
            el('th', { class: 'right', text: 'Duracion' }),
            el('th', { text: 'Inicio' }),
            el('th', { text: 'Estado' })
          )),
          tbody
        )
      ),
      el('div', { class: 'pager' }, pagerInfo, el('div', { class: 'filters', style: 'margin:0' }, pagePrev, pageNext))
    )
  );

  await load();
}

export async function sessionsRefresh() {
  await load({ silent: true });
}

async function load({ silent = false } = {}) {
  if (!silent) clear(tbody).append(el('tr', {}, el('td', { colspan: 8 }, skeleton(3))));

  const data = await api.get('/api/dashboard/sessions' + qs({
    page: ui.page, pageSize: ui.pageSize,
    platform: ui.platform, country: ui.country, version: ui.version, q: ui.q,
  }));

  const from = (data.page - 1) * data.pageSize;
  pagerInfo.textContent = data.total
    ? `${from + 1}–${Math.min(from + data.pageSize, data.total)} de ${num(data.total)}`
    : 'Sin resultados';
  pagePrev.disabled = data.page <= 1;
  pageNext.disabled = from + data.pageSize >= data.total;

  clear(tbody);

  if (!data.rows.length) {
    tbody.append(el('tr', {}, el('td', { colspan: 8 },
      el('div', { class: 'empty', text: 'Sin sesiones' }))));
    return;
  }

  for (const s of data.rows) {
    const isMachineIdentity = !s.user_id;

    tbody.append(el('tr', { class: 'clickable', onclick: () => showTimeline(s) },
      el('td', {},
        el('div', {
          class: 'mono',
          text: s.user_id || (s.machine_id || '').slice(0, 10) + '…',
          title: isMachineIdentity ? 'ID de equipo/instalacion, no identifica a una persona' : null,
        }),
        s.first_seen ? el('span', { class: 'badge badge-new', text: 'PRIMERA' }) : null
      ),
      creatorCell(s),
      el('td', {}, s.country || el('span', { class: 'dim', text: '—' }),
        s.city ? el('div', { class: 'dim', style: 'font-size:var(--fs-xs)', text: s.city }) : null),
      el('td', { text: s.app_version ? `v${s.app_version}` : '—' }),
      el('td', {}, (s.platforms_used || []).length
        ? (s.platforms_used || []).map(platformPill)
        : el('span', { class: 'dim', text: '—' })),
      el('td', { class: 'right nowrap', text: minutes(s.session_duration_minutes) }),
      el('td', { class: 'dim nowrap', text: date(s.started_at) }),
      el('td', {}, sessionBadge(s))
    ));
  }
}

function creatorCell(s) {
  if (!s.creator_username) {
    return el('td', {}, el('span', { class: 'dim', text: 'sin canal identificado' }));
  }

  const username = `@${s.creator_username}`;
  const identity = s.creator_channel_url
    ? el('a', {
        href: s.creator_channel_url, target: '_blank', rel: 'noopener noreferrer',
        style: 'text-decoration:none;font-weight:600', onclick: (event) => event.stopPropagation(),
      }, username)
    : el('span', { text: username });

  return el('td', {}, el('div', { style: 'display:flex;gap:8px;align-items:center' },
    avatar(s.creator_avatar_url, s.creator_username), identity
  ));
}

// El estado lo decide el servidor (app_open ya excluye sesiones cerradas).
// "App abierta" no afirma una transmision: aun no hay senal LIVE verificada.
function sessionBadge(s) {
  if (s.ended_at) return el('span', { class: 'badge badge-mut', text: 'cerrada' });
  if (s.app_open || s.connected) {
    return el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' },
      s.app_open ? el('span', { class: 'badge badge-live', text: 'App abierta' }) : null,
      s.connected ? el('span', { class: 'badge badge-live', text: 'Conectado a plataforma' }) : null
    );
  }
  return el('span', { class: 'badge badge-mut', text: 'sin cierre' });
}

async function showTimeline(s) {
  openDrawer(skeleton(6));
  const [events, status] = await Promise.all([
    api.get(`/api/dashboard/sessions/${s.session_id}/events`),
    api.get('/api/dashboard/status'),
  ]);

  openDrawer(
    el('div', { class: 'drawer-head' },
      el('div', {},
        el('h3', { text: s.user_id || 'Sesion' }),
        el('div', { class: 'mono', text: s.session_id })
      ),
      el('button', { class: 'btn btn-sm', style: 'margin-left:auto', onclick: closeDrawer }, '✕')
    ),

    el('dl', { class: 'kv' },
      el('dt', { text: 'ID de equipo', title: 'Identifica el equipo/instalacion de la app, no a una persona' }),
      el('dd', { class: 'mono', text: s.machine_id || '—' }),
      el('dt', { text: 'Version' }),   el('dd', { text: s.app_version ? `v${s.app_version}` : '—' }),
      el('dt', { text: 'Ubicacion' }), el('dd', { text: [s.city, s.country].filter(Boolean).join(', ') || '—' }),
      el('dt', { text: 'Inicio' }),    el('dd', { text: date(s.started_at) }),
      el('dt', { text: 'Fin' }),       el('dd', { text: s.ended_at ? date(s.ended_at) : 'sin cierre registrado' }),
      el('dt', { text: 'Duracion' }),  el('dd', { text: minutes(s.session_duration_minutes) }),
      el('dt', { text: 'Ultimo latido' }), el('dd', { text: relative(s.last_heartbeat_at) }),
      el('dt', { text: 'Errores' }),   el('dd', {}, glitchtipLink(status.glitchtip_issues_url, s.session_id)),
    ),

    el('div', { class: 'section-title', text: `Eventos (${events.length})` }),
    events.length
      ? el('div', { class: 'table-wrap' },
          el('table', {},
            el('tbody', {}, ...events.map((e) => el('tr', {},
              el('td', { class: 'nowrap dim mono', text: new Date(e.ts).toLocaleTimeString('es') }),
              el('td', {
                class: 'nowrap',
                text: `${CONNECTOR_LABELS[e.connector] || e.connector} · ${prettyEvent(e.name)}`,
                title: `${e.connector}.${e.name}`,
              }),
              el('td', { class: 'mono', text: propsSummary(e.props) })
            )))
          )
        )
      : el('div', { class: 'empty', text: 'Sin eventos registrados' })
  );
}

function glitchtipLink(issuesUrl, sessionId) {
  const query = encodeURIComponent(`telemetry_session_id:${sessionId}`);
  return el('a', { href: `${issuesUrl}/?query=${query}`, target: '_blank', rel: 'noopener noreferrer' },
    'Ver errores en GlitchTip');
}

function propsSummary(props) {
  if (!props || typeof props !== 'object') return '';
  const parts = Object.entries(props)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 4)
    .map(([k, v]) => {
      const key = k.replace(/_/g, ' ');
      const value = typeof v === 'object' ? JSON.stringify(v) : (typeof v === 'number' ? num(v) : v);
      return `${key}=${value}`;
    });
  return parts.join(' ').slice(0, 120);
}
