import { api, qs } from '../api.js';
import { el, clear, num, compact, minutes, date, relative, avatar, platformPill, toast, skeleton } from '../format.js';
import { lineChart, COLORS, destroyCharts } from '../charts.js';
import { openDrawer, closeDrawer } from '../drawer.js';

// Estado de la tabla. Persiste mientras no se recargue la pagina, para que
// filtrar y volver del detalle no reinicie los filtros.
const ui = {
  page: 1,
  pageSize: 50,
  sort: 'last_seen',
  platform: '',
  q: '',
  onlyPublic: false,
  onlyNew: false,
  includeHidden: false,
  selected: new Set(),
};

const SORT_LABEL = {
  last_seen: 'Ultimos vistos',
  first_seen: 'Ultimos registrados',
  followers: 'Mas seguidores',
  minutes: 'Mas minutos',
  sessions: 'Mas sesiones',
  name: 'Nombre A-Z',
};

let tbody, pagerInfo, bulkbar, bulkCount, headStats, pagePrev, pageNext;

export async function creatorsPage(view) {
  ui.selected.clear();

  const search = el('input', {
    class: 'field', type: 'search', placeholder: 'Buscar @, nombre o usr_...',
    value: ui.q, style: 'min-width:220px',
  });

  // Debounce: no lanzar una consulta por tecla.
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { ui.q = search.value.trim(); ui.page = 1; load(); }, 300);
  });

  const platformSel = select(
    [['', 'Todas las plataformas'], ['tiktok', 'TikTok'], ['twitch', 'Twitch'], ['youtube', 'YouTube']],
    ui.platform,
    (v) => { ui.platform = v; ui.page = 1; load(); }
  );

  const sortSel = select(
    Object.entries(SORT_LABEL),
    ui.sort,
    (v) => { ui.sort = v; ui.page = 1; load(); }
  );

  headStats = el('div', { class: 'sub', text: 'Cargando...' });
  bulkCount = el('b', { text: '0' });

  bulkbar = el('div', { class: 'bulkbar', hidden: true },
    bulkCount, ' seleccionados',
    el('span', { style: 'flex:1' }),
    el('button', { class: 'btn btn-sm btn-accent', onclick: () => bulk('publish') }, 'Publicar'),
    el('button', { class: 'btn btn-sm', onclick: () => bulk('unpublish') }, 'Despublicar'),
    el('button', { class: 'btn btn-sm', onclick: () => bulk('hide') }, 'Ocultar'),
    el('button', { class: 'btn btn-sm', onclick: () => bulk('unhide') }, 'Mostrar'),
  );

  tbody = el('tbody');
  pagerInfo = el('span', { text: '—' });
  pagePrev = el('button', { class: 'btn btn-sm', onclick: () => { ui.page--; load(); } }, '← Anterior');
  pageNext = el('button', { class: 'btn btn-sm', onclick: () => { ui.page++; load(); } }, 'Siguiente →');

  const selectAll = el('input', { type: 'checkbox' });
  selectAll.addEventListener('change', () => {
    for (const cb of tbody.querySelectorAll('input[type=checkbox]')) {
      cb.checked = selectAll.checked;
      toggleSelect(Number(cb.dataset.id), selectAll.checked);
    }
  });

  view.append(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Creadores' }), headStats),
      el('div', { class: 'filters', style: 'margin:0' },
        search, platformSel, sortSel,
        checkbox('Solo publicos', ui.onlyPublic, (v) => { ui.onlyPublic = v; ui.page = 1; load(); }),
        checkbox('Solo nuevos (24h)', ui.onlyNew, (v) => { ui.onlyNew = v; ui.page = 1; load(); }),
        checkbox('Incluir ocultos', ui.includeHidden, (v) => { ui.includeHidden = v; ui.page = 1; load(); }),
        el('a', { class: 'btn btn-sm', href: '/api/export/creators.csv' }, '⬇ CSV'),
      )
    ),
    bulkbar,
    el('div', { class: 'card' },
      el('div', { class: 'table-wrap' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { style: 'width:32px' }, selectAll),
            el('th', { style: 'width:44px' }),
            el('th', { text: 'Creador' }),
            el('th', { text: 'Plataforma' }),
            el('th', { class: 'right', text: 'Seguidores' }),
            el('th', { class: 'right', text: 'Sesiones' }),
            el('th', { class: 'right', text: 'Tiempo' }),
            el('th', { text: 'Ultima vez' }),
            el('th', { class: 'right', text: 'Publico' }),
          )),
          tbody
        )
      ),
      el('div', { class: 'pager' }, pagerInfo, el('div', { class: 'filters', style: 'margin:0' }, pagePrev, pageNext))
    )
  );

  await load();
}

function select(options, value, onChange) {
  const s = el('select', { class: 'field' });
  for (const [v, label] of options) {
    s.append(el('option', { value: v, selected: v === value || null }, label));
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function checkbox(label, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked: checked || null });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'dim', style: 'display:flex;align-items:center;gap:6px;font-size:var(--fs-sm);cursor:pointer' },
    input, label);
}

function toggleSelect(id, on) {
  if (on) ui.selected.add(id); else ui.selected.delete(id);
  bulkCount.textContent = String(ui.selected.size);
  bulkbar.hidden = ui.selected.size === 0;
}

async function bulk(action) {
  try {
    const { updated } = await api.post('/api/dashboard/creators/bulk', {
      ids: [...ui.selected], action,
    });
    toast(`${updated} creador(es) actualizados`);
    ui.selected.clear();
    toggleSelect(0, false);
    await load();
  } catch (err) {
    toast(err.message, true);
  }
}

async function load() {
  clear(tbody).append(el('tr', {}, el('td', { colspan: 9 }, skeleton(3))));

  const data = await api.get('/api/dashboard/creators' + qs({
    page: ui.page, pageSize: ui.pageSize, sort: ui.sort,
    platform: ui.platform, q: ui.q,
    onlyPublic: ui.onlyPublic || null,
    onlyNew: ui.onlyNew || null,
    includeHidden: ui.includeHidden || null,
  }));

  headStats.textContent =
    `${num(data.stats.total)} registrados · ${num(data.stats.public)} publicos · ` +
    `${num(data.stats.new_today)} nuevos hoy · ${num(data.stats.hidden)} ocultos`;

  const from = (data.page - 1) * data.pageSize;
  pagerInfo.textContent = data.total
    ? `${from + 1}–${Math.min(from + data.pageSize, data.total)} de ${num(data.total)}`
    : 'Sin resultados';
  pagePrev.disabled = data.page <= 1;
  pageNext.disabled = from + data.pageSize >= data.total;

  clear(tbody);

  if (!data.rows.length) {
    tbody.append(el('tr', {}, el('td', { colspan: 9 },
      el('div', { class: 'empty', text: 'Ningun creador coincide con el filtro' }))));
    return;
  }

  for (const c of data.rows) tbody.append(row(c));
}

function row(c) {
  const cb = el('input', { type: 'checkbox', dataset: { id: c.id } });
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => toggleSelect(c.id, cb.checked));

  const toggleInput = el('input', { type: 'checkbox', checked: c.is_public || null });
  toggleInput.addEventListener('click', (e) => e.stopPropagation());
  toggleInput.addEventListener('change', async () => {
    try {
      await api.patch(`/api/dashboard/creators/${c.id}`, { is_public: toggleInput.checked });
      toast(toggleInput.checked ? `@${c.username} ya sale en la web` : `@${c.username} retirado de la web`);
    } catch (err) {
      toggleInput.checked = !toggleInput.checked;
      toast(err.message, true);
    }
  });

  const link = el('a', {
    href: c.channel_url || '#', target: '_blank', rel: 'noopener noreferrer',
    style: 'text-decoration:none;font-weight:600',
    onclick: (e) => e.stopPropagation(),
  }, `@${c.username} ↗`);

  const meta = [el('span', { class: 'mono', text: c.user_id || 'sin usuario' })];
  if (c.is_new) meta.push(' ', el('span', { class: 'badge badge-new', text: 'NUEVO' }));
  if (c.resolve_count < 2) meta.push(' ', el('span', { class: 'badge badge-mut', text: `resuelto ${c.resolve_count}/2` }));
  if (c.is_hidden) meta.push(' ', el('span', { class: 'badge badge-mut', text: 'OCULTO' }));

  const tr = el('tr', { class: 'clickable', onclick: () => showDetail(c.id) },
    el('td', {}, cb),
    el('td', {}, avatar(c.avatar_url, c.display_name || c.username)),
    el('td', {},
      el('div', {}, link),
      c.display_name && c.display_name !== c.username
        ? el('div', { class: 'dim', style: 'font-size:var(--fs-xs)', text: c.display_name })
        : null,
      el('div', { style: 'margin-top:2px' }, ...meta)
    ),
    el('td', {},
      platformPill(c.platform),
      c.platform_count > 1
        ? el('span', { class: 'badge badge-mut', style: 'margin-left:4px', text: `+${c.platform_count - 1}` })
        : null
    ),
    el('td', { class: 'right nowrap', text: compact(c.follower_count) }),
    el('td', { class: 'right', text: num(c.total_sessions) }),
    el('td', { class: 'right nowrap', text: minutes(c.total_minutes) }),
    el('td', { class: 'nowrap dim', text: relative(c.last_seen_at) }),
    el('td', { class: 'right' }, el('label', { class: 'toggle' }, toggleInput, el('span')))
  );

  return tr;
}

async function showDetail(id) {
  openDrawer(skeleton(6));
  const c = await api.get(`/api/dashboard/creators/${id}`);

  const notes = el('textarea', {
    class: 'field', rows: 3, style: 'width:100%;resize:vertical',
    placeholder: 'Notas privadas (no se publican)',
  });
  notes.value = c.notes || '';

  const content = [
    el('div', { class: 'drawer-head' },
      avatar(c.avatar_url, c.display_name || c.username, true),
      el('div', {},
        el('h3', { text: `@${c.username}` }),
        el('div', { class: 'dim', style: 'font-size:var(--fs-sm)', text: c.display_name || '' }),
        el('div', { style: 'margin-top:6px' }, platformPill(c.platform))
      ),
      el('button', { class: 'btn btn-sm', style: 'margin-left:auto', onclick: closeDrawer }, '✕')
    ),

    c.channel_url
      ? el('p', { style: 'margin-bottom:var(--s-4)' },
          el('a', { href: c.channel_url, target: '_blank', rel: 'noopener noreferrer',
            style: 'color:var(--accent-2);font-size:var(--fs-sm)' }, c.channel_url))
      : null,

    el('dl', { class: 'kv' },
      el('dt', { text: 'Usuario' }),   el('dd', { class: 'mono', text: c.user_id || '—' }),
      el('dt', { text: 'Seguidores' }), el('dd', { text: `${num(c.follower_count)} (pico ${num(c.peak_followers)})` }),
      el('dt', { text: 'Sesiones' }),  el('dd', { text: num(c.total_sessions) }),
      el('dt', { text: 'Tiempo total' }), el('dd', { text: minutes(c.total_minutes) }),
      el('dt', { text: 'Primera vez' }), el('dd', { text: date(c.first_seen_at) }),
      el('dt', { text: 'Ultima vez' }),  el('dd', { text: date(c.last_seen_at) }),
      el('dt', { text: 'Pais' }),        el('dd', { text: c.country || '—' }),
      el('dt', { text: 'Version app' }), el('dd', { text: c.app_version ? `v${c.app_version}` : '—' }),
      el('dt', { text: 'Resolucion' }),  el('dd', { text: `${c.resolve_count}/2${c.force_resolve ? ' · re-resolucion pendiente' : ''}` }),
    ),
  ];

  if (c.siblings && c.siblings.length) {
    content.push(
      el('div', { class: 'section-title', text: 'Otros canales del mismo usuario' }),
      el('div', { style: 'margin-bottom:var(--s-5)' },
        ...c.siblings.map((s) => el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:4px' },
          platformPill(s.platform),
          el('a', { href: s.channel_url || '#', target: '_blank', rel: 'noopener noreferrer',
            style: 'font-size:var(--fs-sm)' }, `@${s.username}`),
          el('span', { class: 'dim', style: 'font-size:var(--fs-xs)', text: compact(s.follower_count) })
        ))
      )
    );
  }

  if (c.history && c.history.length > 1) {
    content.push(
      el('div', { class: 'section-title', text: 'Seguidores en el tiempo' }),
      el('div', { class: 'chart-box', style: 'height:180px;margin-bottom:var(--s-5)' },
        el('canvas', { id: 'c-follow' }))
    );
  }

  content.push(
    el('div', { class: 'section-title', text: 'Notas' }),
    notes,
    el('div', { class: 'filters', style: 'margin-top:var(--s-3)' },
      el('button', { class: 'btn btn-sm btn-accent', onclick: async () => {
        try {
          await api.patch(`/api/dashboard/creators/${c.id}`, { notes: notes.value });
          toast('Notas guardadas');
        } catch (err) { toast(err.message, true); }
      } }, 'Guardar notas'),
      el('button', { class: 'btn btn-sm', onclick: async () => {
        try {
          await api.post(`/api/dashboard/creators/${c.id}/re-resolve`);
          toast('Se volvera a resolver en la proxima conexion de la app');
        } catch (err) { toast(err.message, true); }
      } }, 'Re-resolver'),
      el('button', { class: 'btn btn-sm', onclick: () => promptMerge(c) }, 'Fusionar'),
      el('button', { class: 'btn btn-sm', onclick: async () => {
        try {
          await api.patch(`/api/dashboard/creators/${c.id}`, { is_hidden: !c.is_hidden });
          toast(c.is_hidden ? 'Visible de nuevo' : 'Oculto');
          closeDrawer();
          await load();
        } catch (err) { toast(err.message, true); }
      } }, c.is_hidden ? 'Mostrar' : 'Ocultar')
    )
  );

  openDrawer(...content.filter(Boolean));

  if (c.history && c.history.length > 1) {
    lineChart(
      document.getElementById('c-follow'),
      c.history.map((h) => String(h.day).slice(5, 10)),
      [{ label: 'Seguidores', data: c.history.map((h) => h.followers), color: COLORS.accent }]
    );
  }
}

async function promptMerge(c) {
  const otherId = window.prompt(
    `Fusionar OTRA ficha dentro de @${c.username} (id ${c.id}).\n` +
    'Escribe el id de la ficha que quieres absorber. Esa ficha se borrara y sus\n' +
    'sesiones y minutos se sumaran a esta.'
  );
  if (!otherId) return;

  try {
    await api.post('/api/dashboard/creators/merge', { keep_id: c.id, merge_id: Number(otherId) });
    toast('Fichas fusionadas');
    closeDrawer();
    destroyCharts();
    await load();
  } catch (err) {
    toast(err.message, true);
  }
}
