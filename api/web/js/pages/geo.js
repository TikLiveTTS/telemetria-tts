import { api } from '../api.js';
import { el, num, compact, minutes, date, relative, skeleton, countryName, avatar, platformPill, prettyEvent, CONNECTOR_LABELS } from '../format.js';
import { barChart, updateChart } from '../charts.js';
import { openDrawer, closeDrawer } from '../drawer.js';

// Mapa real con MapLibre GL, sin API key: estilo vectorial gratis de CARTO
// (Positron) con sus propios tiles/sprite/glyphs, nitido a cualquier zoom.
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

let map = null;
let mapReady = false;
let pendingPoints = null; // llegados antes de que el mapa cargara

export function destroyMap() {
  if (map) { map.remove(); map = null; }
  mapReady = false;
}

function pointsToGeoJson(points) {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => ({
        type: 'Feature',
        properties: { machine_id: p.machine_id, city: p.city || '', country: countryName(p.country_code, p.country) },
        geometry: { type: 'Point', coordinates: [Number(p.lon), Number(p.lat)] },
      })),
  };
}

// Actualiza los puntos de un mapa YA cargado, sin recrearlo (usado por el
// refresco periodico: recrear el mapa cada 60s reiniciaria zoom/posicion).
export function updateMapPoints(points) {
  if (!mapReady) { pendingPoints = points; return; }
  const source = map.getSource('points');
  if (source) source.setData(pointsToGeoJson(points));
}

export function renderMap(container, points) {
  destroyMap();
  pendingPoints = null;

  map = new maplibregl.Map({
    container,
    style: BASEMAP_STYLE,
    center: [10, 20],
    zoom: 1.1,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.addControl(new maplibregl.FullscreenControl(), 'top-left');

  map.on('load', () => {
    map.addSource('points', {
      type: 'geojson',
      data: pointsToGeoJson(pendingPoints || points),
      cluster: true,
      clusterMaxZoom: 9,
      clusterRadius: 40,
    });

    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'points',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#fe2c55',
        'circle-opacity': 0.75,
        'circle-radius': ['step', ['get', 'point_count'], 14, 5, 20, 20, 28],
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(254,44,85,.25)',
      },
    });

    map.addLayer({
      id: 'point',
      type: 'circle',
      source: 'points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': '#fe2c55',
        'circle-radius': 6,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    });

    map.on('click', 'clusters', (e) => {
      const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
      const clusterId = feature.properties.cluster_id;
      map.getSource('points').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({ center: feature.geometry.coordinates, zoom });
      });
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    const showPopup = (lngLat, html) => {
      popup.setLngLat(lngLat).setHTML(`<div style="font-size:12px;color:#111;line-height:1.4">${html}</div>`).addTo(map);
    };

    map.on('mouseenter', 'clusters', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      showPopup(e.features[0].geometry.coordinates, `<b>${p.point_count}</b> usuarios agrupados en esta zona del mapa (zoom para separarlos)`);
    });
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; popup.remove(); });

    map.on('mouseenter', 'point', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      const label = [p.city, p.country].filter(Boolean).join(', ') || 'Ubicacion desconocida';
      showPopup(e.features[0].geometry.coordinates, `<b>${label}</b><br>1 usuario`);
    });
    map.on('mouseleave', 'point', () => { map.getCanvas().style.cursor = ''; popup.remove(); });
    // ponytail: si varios usuarios comparten coordenadas exactas, el clic abre solo el de arriba.
    map.on('click', 'point', (e) => {
      popup.remove();
      showInstall(e.features[0].properties.machine_id);
    });

    mapReady = true;
  });
}

// Ficha de la instalacion: perfil de creador, redes y su uso de la app.
async function showInstall(machineId) {
  openDrawer(skeleton(6));
  let p;
  try {
    p = await api.get(`/api/dashboard/installs/${encodeURIComponent(machineId)}`);
  } catch (err) {
    openDrawer(el('div', { class: 'empty', text: err.message }));
    return;
  }

  const main = p.creators[0];
  const name = main ? (main.display_name || `@${main.username}`) : 'Usuario sin canal vinculado';
  const location = [p.city, countryName(p.country_code, p.country)].filter((x) => x && x !== '—').join(', ');

  const list = (title, items, render) => items.length
    ? [el('div', { class: 'section-title', text: title }), el('div', { style: 'margin-bottom:var(--s-5)' }, ...items.map(render))]
    : [];
  const line = (...children) => el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:4px;font-size:var(--fs-sm)' }, ...children);

  openDrawer(
    el('div', { class: 'drawer-head' },
      avatar(main && main.avatar_url, name, true),
      el('div', {},
        el('h3', { text: name }),
        el('div', { class: 'dim', style: 'font-size:var(--fs-sm)', text: location || 'Ubicacion desconocida' })
      ),
      el('button', { class: 'btn btn-sm', style: 'margin-left:auto', onclick: closeDrawer }, '✕')
    ),

    ...list('Redes sociales', p.creators, (c) => line(
      platformPill(c.platform),
      el('a', { href: c.channel_url || '#', target: '_blank', rel: 'noopener noreferrer' }, `@${c.username}`),
      el('span', { class: 'dim', style: 'font-size:var(--fs-xs)', text: `${compact(c.follower_count)} seguidores` })
    )),

    el('dl', { class: 'kv', style: 'margin-bottom:var(--s-5)' },
      el('dt', { text: 'ID interno' }), el('dd', { class: 'mono', text: p.user_id || '—' }),
      el('dt', { text: 'Sesiones' }), el('dd', { text: num(p.total_sessions) }),
      el('dt', { text: 'Tiempo total' }), el('dd', { text: minutes(p.total_minutes) }),
      el('dt', { text: 'Primera vez' }), el('dd', { text: date(p.first_seen_at) }),
      el('dt', { text: 'Ultima vez' }), el('dd', { text: relative(p.last_seen_at) }),
      el('dt', { text: 'Version app' }), el('dd', { text: p.app_version ? `v${p.app_version}` : '—' }),
      el('dt', { text: 'Sistema' }), el('dd', { text: [p.os_platform, p.os_release].filter(Boolean).join(' ') || '—' }),
      el('dt', { text: 'Idioma' }), el('dd', { text: p.locale || '—' })
    ),

    ...list('Plataformas usadas', p.platforms, (x) => line(
      platformPill(x.platform), el('span', { class: 'dim', text: `${num(x.sessions)} sesiones` })
    )),

    ...list('Funciones mas usadas', p.features, (f) => line(
      el('span', { title: `${f.connector}.${f.name}`, text: `${CONNECTOR_LABELS[f.connector] || f.connector} · ${prettyEvent(f.name)}` }),
      el('span', { class: 'dim', style: 'margin-left:auto', text: num(f.uses) })
    )),

    ...list('Ultimas sesiones', p.recent_sessions, (s) => line(
      el('span', { text: date(s.started_at) }),
      el('span', { class: 'dim', text: s.ended_at ? minutes(s.session_duration_minutes) : 'abierta' }),
      el('span', { class: 'dim', style: 'margin-left:auto', text: s.app_version ? `v${s.app_version}` : '' })
    ))
  );
}

let statValueEl = null;
let statWithoutGeoEl = null;

function statCard(live) {
  statValueEl = el('div', { class: 'map-stat-value' });
  statWithoutGeoEl = el('div', { class: 'map-stat-label' });
  updateStatCard(live);

  return el('div', { class: 'map-stat-card' },
    el('div', { class: 'map-stat-label', text: 'Apps abiertas' }),
    statValueEl,
    statWithoutGeoEl
  );
}

function updateStatCard(live) {
  if (!statValueEl) return;
  statValueEl.textContent = num(live.count);
  statWithoutGeoEl.textContent = `+${num(live.without_geo)} sin ubicacion`;
  statWithoutGeoEl.hidden = !live.without_geo;
}

let countriesChart = null;
let countriesTbody = null;
let renderId = 0;

function countryRow(c) {
  return el('tr', {},
    el('td', { text: countryName(c.country_code, c.country) }),
    el('td', { class: 'right', text: num(c.installs) }),
    el('td', { class: 'right', text: num(c.sessions) }),
    el('td', { class: 'right nowrap', title: 'Tiempo total acumulado (formato h m)', text: minutes(c.minutes) })
  );
}

export async function geoPage(view) {
  const myId = ++renderId;
  view.append(skeleton(3));

  const [live, countries] = await Promise.all([
    api.get('/api/dashboard/geo/live'),
    api.get('/api/dashboard/geo/countries?limit=20'),
  ]);

  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba

  const mapDiv = el('div', { id: 'map-canvas' });
  countriesTbody = el('tbody', {}, countries.length
    ? countries.map(countryRow)
    : el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty', text: 'Sin datos' })))
  );

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Geografia' }),
        el('div', { class: 'sub', text: 'Puntos: sesiones con la app abierta (latido en los ultimos 5 minutos). No indica transmision en vivo' }))
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Apps abiertas ahora' }),
      el('div', { id: 'map-wrap' },
        mapDiv,
        statCard(live)
      )
    ),

    el('div', { class: 'grid-2' },
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Instalaciones historicas por pais' }),
        el('div', { class: 'sub', text: 'Acumuladas desde el inicio' }),
        el('div', { class: 'chart-box' }, el('canvas', { id: 'c-countries' }))
      ),
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Detalle historico por pais' }),
        el('div', { class: 'table-wrap', style: 'max-height:250px;overflow-y:auto' },
          el('table', {},
            el('thead', {}, el('tr', {},
              el('th', { text: 'Pais' }),
              el('th', { class: 'right', text: 'Instalaciones' }),
              el('th', { class: 'right', text: 'Sesiones historicas' }),
              el('th', { class: 'right', text: 'Tiempo historico' })
            )),
            countriesTbody
          )
        )
      )
    )
  );

  renderMap(mapDiv, live.points);

  countriesChart = countries.length
    ? barChart(
        document.getElementById('c-countries'),
        countries.slice(0, 10).map((c) => countryName(c.country_code, c.country)),
        countries.slice(0, 10).map((c) => c.installs),
        { horizontal: true, label: 'Instalaciones historicas' }
      )
    : null;
}

// Refresco periodico: solo pide datos nuevos y los aplica al mapa/chart/tabla
// existentes. Nunca destruye el mapa (perderia zoom/posicion) ni el chart.
export async function geoRefresh() {
  const myId = renderId;
  const [live, countries] = await Promise.all([
    api.get('/api/dashboard/geo/live'),
    api.get('/api/dashboard/geo/countries?limit=20'),
  ]);
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba

  updateMapPoints(live.points);
  updateStatCard(live);

  if (countries.length) {
    const labels = countries.slice(0, 10).map((c) => countryName(c.country_code, c.country));
    const data = countries.slice(0, 10).map((c) => c.installs);
    if (countriesChart) updateChart(countriesChart, labels, [data]);
    else countriesChart = barChart(document.getElementById('c-countries'), labels, data, { horizontal: true, label: 'Instalaciones historicas' });
  }

  if (countriesTbody) {
    countriesTbody.replaceChildren(...(countries.length
      ? countries.map(countryRow)
      : [el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty', text: 'Sin datos' })))]));
  }
}
