import { api, state } from '../api.js';
import { el, num, minutes, skeleton } from '../format.js';
import { lineChart, barChart, COLORS } from '../charts.js';

function kpi(label, value, cls, sub) {
  return el('div', { class: 'card' },
    el('div', { class: 'kpi-label', text: label }),
    el('div', { class: `kpi-value ${cls || ''}`, text: value }),
    sub ? el('div', { class: 'kpi-sub' }, sub) : null
  );
}

// Delta contra el periodo anterior de la misma longitud.
function delta(now, prev) {
  if (!prev) return el('span', { class: 'dim', text: 'sin referencia' });
  const pct = Math.round(((now - prev) / prev) * 100);
  const up = pct >= 0;
  return el('span', { class: `delta ${up ? 'up' : 'down'}`, text: `${up ? '▲' : '▼'} ${Math.abs(pct)}% vs periodo anterior` });
}

export async function overviewPage(view) {
  view.append(skeleton(3));

  const [s, daily, retention, platforms] = await Promise.all([
    api.get(`/api/dashboard/summary?days=${state.days}`),
    api.get(`/api/dashboard/daily?days=${Math.min(state.days, 180)}`),
    api.get('/api/dashboard/retention'),
    api.get(`/api/dashboard/platforms?days=${state.days}`),
  ]);

  view.replaceChildren(
    el('div', { class: 'kpis' },
      kpi('Instalaciones', num(s.total_installs), 'accent', el('span', { class: 'dim', text: 'maquinas unicas' })),
      kpi('Activos ahora', num(s.active_now), 'cyan', el('span', { class: 'dim', text: 'heartbeat < 5 min' })),
      kpi('Activos hoy', num(s.active_today), '', el('span', { class: 'dim', text: 'dia local' })),
      kpi('Activos periodo', num(s.active_period), '', delta(s.active_period, s.active_prev_period)),
      kpi('Nuevos periodo', num(s.new_period), 'green', delta(s.new_period, s.new_prev_period)),
      kpi('Sesion media', s.avg_session_min ? minutes(Math.round(s.avg_session_min)) : '—', 'yellow',
        el('span', { class: 'dim', text: 'por sesion cerrada' })),
      kpi('Creadores', num(s.creators_total), '',
        el('span', { class: 'dim', text: `${num(s.creators_public)} publicos` })),
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Actividad diaria' }),
      el('div', { class: 'chart-box' }, el('canvas', { id: 'c-daily' }))
    ),

    el('div', { class: 'grid-2' },
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Retencion por cohorte semanal' }),
        el('div', { class: 'chart-box' }, el('canvas', { id: 'c-ret' }))
      ),
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Plataformas usadas' }),
        el('div', { class: 'chart-box' }, el('canvas', { id: 'c-plat' }))
      )
    )
  );

  lineChart(
    document.getElementById('c-daily'),
    daily.map((d) => String(d.day).slice(5, 10)),
    [
      { label: 'Sesiones', data: daily.map((d) => d.sessions), color: COLORS.accent },
      { label: 'Usuarios unicos', data: daily.map((d) => d.users), color: COLORS.accent2 },
      { label: 'Instalaciones nuevas', data: daily.map((d) => d.installs), color: COLORS.ok },
    ]
  );

  if (retention.length) {
    lineChart(
      document.getElementById('c-ret'),
      retention.map((r) => String(r.week).slice(5, 10)),
      [
        { label: 'D1 %', data: retention.map((r) => Number(r.d1)), color: COLORS.accent, fill: false },
        { label: 'D7 %', data: retention.map((r) => Number(r.d7)), color: COLORS.accent2, fill: false },
        { label: 'D30 %', data: retention.map((r) => Number(r.d30)), color: COLORS.warn, fill: false },
      ]
    );
  } else {
    document.getElementById('c-ret').replaceWith(el('div', { class: 'empty', text: 'Sin cohortes todavia' }));
  }

  if (platforms.length) {
    barChart(
      document.getElementById('c-plat'),
      platforms.map((p) => p.platform),
      platforms.map((p) => Number(p.pct)),
      { horizontal: true, label: '% de sesiones' }
    );
  } else {
    document.getElementById('c-plat').replaceWith(el('div', { class: 'empty', text: 'Sin datos de plataformas' }));
  }
}
