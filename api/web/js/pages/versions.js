import { api } from '../api.js';
import { el, num, relative, skeleton } from '../format.js';
import { doughnutChart } from '../charts.js';

// Compara versiones con orden semantico: "1.10.0" es mayor que "1.9.0".
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

export async function versionsPage(view) {
  view.append(skeleton(3));

  const rows = await api.get('/api/dashboard/versions');
  const sorted = [...rows].sort((a, b) => compareVersions(a.app_version, b.app_version));
  const latest = sorted[0];
  const onLatest = latest ? rows.find((r) => r.app_version === latest.app_version) : null;
  const outdated = rows.reduce((acc, r) => acc + (r.app_version === latest?.app_version ? 0 : r.users), 0);

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Versiones' }),
        el('div', { class: 'sub', text: 'Distribucion de la version instalada por maquina' }))
    ),

    el('div', { class: 'kpis' },
      el('div', { class: 'card' },
        el('div', { class: 'kpi-label', text: 'Ultima version vista' }),
        el('div', { class: 'kpi-value accent', text: latest ? `v${latest.app_version}` : '—' })),
      el('div', { class: 'card' },
        el('div', { class: 'kpi-label', text: 'Adopcion' }),
        el('div', { class: 'kpi-value cyan', text: onLatest ? `${onLatest.pct}%` : '—' }),
        el('div', { class: 'kpi-sub', text: onLatest ? `${num(onLatest.users)} maquinas` : '' })),
      el('div', { class: 'card' },
        el('div', { class: 'kpi-label', text: 'Desactualizadas' }),
        el('div', { class: 'kpi-value yellow', text: num(outdated) })),
    ),

    el('div', { class: 'grid-2' },
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Reparto' }),
        el('div', { class: 'chart-box' }, el('canvas', { id: 'c-versions' }))
      ),
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Detalle' }),
        el('div', { class: 'table-wrap' },
          el('table', {},
            el('thead', {}, el('tr', {},
              el('th', { text: 'Version' }),
              el('th', { class: 'right', text: 'Maquinas' }),
              el('th', { class: 'right', text: '%' }),
              el('th', { text: 'Ultima actividad' })
            )),
            el('tbody', {}, sorted.length
              ? sorted.map((r) => el('tr', {},
                  el('td', {}, `v${r.app_version}`,
                    r.app_version === latest.app_version
                      ? el('span', { class: 'badge badge-new', style: 'margin-left:8px', text: 'ULTIMA' })
                      : null),
                  el('td', { class: 'right', text: num(r.users) }),
                  el('td', { class: 'right', text: `${r.pct}%` }),
                  el('td', { class: 'dim nowrap', text: relative(r.last_seen) })
                ))
              : el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty', text: 'Sin datos' })))
            )
          )
        )
      )
    )
  );

  if (sorted.length) {
    doughnutChart(
      document.getElementById('c-versions'),
      sorted.map((r) => `v${r.app_version}`),
      sorted.map((r) => r.users)
    );
  }
}
