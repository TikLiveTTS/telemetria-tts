import { api } from '../api.js';
import { el, num, minutes, skeleton } from '../format.js';
import { barChart } from '../charts.js';

// Mapa en canvas con proyeccion Web Mercator. Sin libreria de mapas: son
// puntos sobre una rejilla, y eso no justifica 200 KB de dependencia.
function renderMap(canvas, points) {
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = parent.clientWidth;
  const h = parent.clientHeight;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = (h / 6) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  for (let i = 0; i <= 12; i++) {
    const x = (w / 12) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }

  const project = (lat, lon) => {
    const x = ((lon + 180) / 360) * w;
    const latRad = (lat * Math.PI) / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return { x, y: h / 2 - (w * mercN) / (2 * Math.PI) };
  };

  for (const p of points) {
    if (p.lat == null || p.lon == null) continue;
    const { x, y } = project(Number(p.lat), Number(p.lon));

    const glow = ctx.createRadialGradient(x, y, 0, x, y, 15);
    glow.addColorStop(0, 'rgba(254,44,85,.55)');
    glow.addColorStop(1, 'rgba(254,44,85,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#fe2c55';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  if (!points.length) {
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin usuarios activos en este momento', w / 2, h / 2);
  }
}

export async function geoPage(view) {
  view.append(skeleton(3));

  const [points, countries] = await Promise.all([
    api.get('/api/dashboard/geo/live'),
    api.get('/api/dashboard/geo/countries?limit=20'),
  ]);

  const canvas = el('canvas', { id: 'map-canvas' });

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Geografia' }),
        el('div', { class: 'sub', text: 'Puntos en vivo: instalaciones con heartbeat en los ultimos 5 minutos' }))
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Usuarios activos ahora' }),
      el('div', { id: 'map-wrap' },
        canvas,
        el('div', { class: 'map-badge' }, 'Activos: ', el('b', { text: String(points.length) }))
      )
    ),

    el('div', { class: 'grid-2' },
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Top paises' }),
        el('div', { class: 'chart-box' }, el('canvas', { id: 'c-countries' }))
      ),
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Detalle por pais' }),
        el('div', { class: 'table-wrap', style: 'max-height:250px;overflow-y:auto' },
          el('table', {},
            el('thead', {}, el('tr', {},
              el('th', { text: 'Pais' }),
              el('th', { class: 'right', text: 'Usuarios' }),
              el('th', { class: 'right', text: 'Sesiones' }),
              el('th', { class: 'right', text: 'Tiempo' })
            )),
            el('tbody', {}, countries.length
              ? countries.map((c) => el('tr', {},
                  el('td', { text: c.country || '—' }),
                  el('td', { class: 'right', text: num(c.users) }),
                  el('td', { class: 'right', text: num(c.sessions) }),
                  el('td', { class: 'right nowrap', text: minutes(c.minutes) })
                ))
              : el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty', text: 'Sin datos' })))
            )
          )
        )
      )
    )
  );

  renderMap(canvas, points);

  // Redibujar al cambiar de tamano: el canvas no es responsive por si solo.
  const onResize = () => {
    if (!document.body.contains(canvas)) return window.removeEventListener('resize', onResize);
    renderMap(canvas, points);
  };
  window.addEventListener('resize', onResize);

  if (countries.length) {
    barChart(
      document.getElementById('c-countries'),
      countries.slice(0, 10).map((c) => c.country || '—'),
      countries.slice(0, 10).map((c) => c.users),
      { horizontal: true, label: 'Usuarios' }
    );
  }
}
