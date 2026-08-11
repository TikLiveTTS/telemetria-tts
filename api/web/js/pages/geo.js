import { api } from '../api.js';
import { el, num, minutes, skeleton, countryName } from '../format.js';
import { barChart, updateChart } from '../charts.js';

// Mapa real con MapLibre GL, sin API key: estilo vectorial gratis de CARTO
// (Positron) con sus propios tiles/sprite/glyphs, nitido a cualquier zoom.
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

let map = null;
let mapReady = false;

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
        properties: { city: p.city || '', country: countryName(p.country_code, p.country) },
        geometry: { type: 'Point', coordinates: [Number(p.lon), Number(p.lat)] },
      })),
  };
}

// Actualiza los puntos de un mapa YA cargado, sin recrearlo (usado por el
// refresco periodico: recrear el mapa cada 60s reiniciaria zoom/posicion).
export function updateMapPoints(points) {
  if (!mapReady) return; // el proximo refresco lo toma cuando el mapa termine de cargar
  const source = map.getSource('points');
  if (source) source.setData(pointsToGeoJson(points));
}

function renderMap(container, points) {
  destroyMap();

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
      data: pointsToGeoJson(points),
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

    mapReady = true;
  });
}

let statValueEl = null;
let statTrendEl = null;

function trendText(trendPct) {
  if (trendPct == null) return '';
  return `${trendPct >= 0 ? '↗' : '↘'} ${Math.abs(trendPct)}% vs 5 min atras`;
}

function statCard(count, trendPct) {
  statValueEl = el('div', { class: 'map-stat-value', text: num(count) });
  statTrendEl = el('div', {
    class: 'map-trend',
    style: `color:${trendPct >= 0 ? 'var(--accent-2)' : 'var(--err)'}`,
    text: trendText(trendPct),
  });

  return el('div', { class: 'map-stat-card' },
    el('div', { class: 'map-stat-label', text: 'Usuarios activos' }),
    statValueEl,
    statTrendEl
  );
}

function updateStatCard(count, trendPct) {
  if (!statValueEl) return;
  statValueEl.textContent = num(count);
  statTrendEl.style.color = trendPct >= 0 ? 'var(--accent-2)' : 'var(--err)';
  statTrendEl.textContent = trendText(trendPct);
}

let countriesChart = null;
let countriesTbody = null;
let renderId = 0;

function countryRow(c) {
  return el('tr', {},
    el('td', { text: countryName(c.country_code, c.country) }),
    el('td', { class: 'right', text: num(c.users) }),
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
        el('div', { class: 'sub', text: 'Puntos en vivo: instalaciones con actividad en los ultimos 5 minutos' }))
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Usuarios activos ahora' }),
      el('div', { id: 'map-wrap' },
        mapDiv,
        statCard(live.count, live.trendPct)
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
        countries.slice(0, 10).map((c) => c.users),
        { horizontal: true, label: 'Usuarios' }
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
  updateStatCard(live.count, live.trendPct);

  if (countries.length) {
    const labels = countries.slice(0, 10).map((c) => countryName(c.country_code, c.country));
    const data = countries.slice(0, 10).map((c) => c.users);
    if (countriesChart) updateChart(countriesChart, labels, [data]);
    else countriesChart = barChart(document.getElementById('c-countries'), labels, data, { horizontal: true, label: 'Usuarios' });
  }

  if (countriesTbody) {
    countriesTbody.replaceChildren(...(countries.length
      ? countries.map(countryRow)
      : [el('tr', {}, el('td', { colspan: 4 }, el('div', { class: 'empty', text: 'Sin datos' })))]));
  }
}
