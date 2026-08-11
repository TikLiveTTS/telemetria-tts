import { api } from '../api.js';
import { el, num, minutes, skeleton } from '../format.js';
import { barChart } from '../charts.js';

// Mapa real con MapLibre GL, sin API key: tiles gratis de CARTO (Positron,
// raster). El estilo se define inline (sin fetch a un style.json externo) asi
// no hace falta tocar la CSP mas alla de imgSrc, que ya permite https:.
const BASEMAP_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
};

let map = null;

export function destroyMap() {
  if (map) { map.remove(); map = null; }
}

function pointsToGeoJson(points) {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => ({
        type: 'Feature',
        properties: { city: p.city || '', country: p.country || '' },
        geometry: { type: 'Point', coordinates: [Number(p.lon), Number(p.lat)] },
      })),
  };
}

function renderMap(container, points) {
  if (map) { map.remove(); map = null; }

  map = new maplibregl.Map({
    container,
    style: BASEMAP_STYLE,
    center: [10, 20],
    zoom: 1.1,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.scrollZoom.disable();

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

    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on('mouseenter', 'point', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      const label = [p.city, p.country].filter(Boolean).join(', ') || 'Ubicacion desconocida';
      popup.setLngLat(e.features[0].geometry.coordinates).setHTML(`<span style="font-size:12px">${label}</span>`).addTo(map);
    });
    map.on('mouseleave', 'point', () => { map.getCanvas().style.cursor = ''; popup.remove(); });
  });
}

export async function geoPage(view) {
  view.append(skeleton(3));

  const [points, countries] = await Promise.all([
    api.get('/api/dashboard/geo/live'),
    api.get('/api/dashboard/geo/countries?limit=20'),
  ]);

  const mapDiv = el('div', { id: 'map-canvas' });

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Geografia' }),
        el('div', { class: 'sub', text: 'Puntos en vivo: instalaciones con heartbeat en los ultimos 5 minutos' }))
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Usuarios activos ahora' }),
      el('div', { id: 'map-wrap' },
        mapDiv,
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

  renderMap(mapDiv, points);

  if (countries.length) {
    barChart(
      document.getElementById('c-countries'),
      countries.slice(0, 10).map((c) => c.country || '—'),
      countries.slice(0, 10).map((c) => c.users),
      { horizontal: true, label: 'Usuarios' }
    );
  }
}
