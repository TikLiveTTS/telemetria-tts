import { api, qs } from '../api.js';
import { el, num, skeleton, countryName, toast } from '../format.js';
import { showInstall } from './geo.js';

// Mapa coroplético: cada pais se colorea segun cuantas instalaciones ha
// tenido en toda la historia. Poligonos de Natural Earth 1:110m (v5.1.2)
// servidos desde el propio panel, en web/data/.
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
// MapLibre exige URL absoluta para los datos de una fuente geojson.
const COUNTRIES_URL = new URL('/data/countries-110m.geojson', location.origin).href;

// ISO_A2 vale "-99" en Francia y Noruega; ISO_A2_EH trae el codigo correcto.
const ISO = ['coalesce', ['get', 'ISO_A2_EH'], ['get', 'ISO_A2']];

// Tramos fijos: el mismo color significa lo mismo hoy y con 10x usuarios.
const BREAKS = [1, 5, 10, 25, 50, 75, 100, 250, 500, 1000];
// Degradado entre dos colores, interpolado en RGB.
const PALETTES = {
  'Amarillo a rojo': ['#fde047', '#b91c1c'],
  'Azul a morado': ['#7dd3fc', '#6b21a8'],
};

function gradient([from, to], n) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [rgb(from), rgb(to)];
  return Array.from({ length: n }, (_, i) =>
    `rgb(${a.map((v, k) => Math.round(v + ((b[k] - v) * i) / (n - 1))).join(',')})`);
}

// Expresion de color para MapLibre: transparente sin instalaciones, y un
// color por tramo a partir de 1.
function fillColor(installs, colors) {
  return ['case', ['==', installs, 0], 'rgba(0,0,0,0)',
    ['step', installs, colors[0], ...BREAKS.slice(1).flatMap((n, i) => [n, colors[i + 1]])]];
}

const rangeLabel = (i) => (i === BREAKS.length - 1
  ? `${num(BREAKS[i])}+`
  : BREAKS[i + 1] - 1 === BREAKS[i] ? num(BREAKS[i]) : `${num(BREAKS[i])}-${num(BREAKS[i + 1] - 1)}`);

let map = null;
let renderId = 0;
// Periodo elegido: se conserva al volver a la pagina.
let periodDays = 0;
let periodBy = 'first';
const PERIODS = [[0, 'Toda la historia'], [7, '7 dias'], [30, '30 dias'], [90, '3 meses'], [180, '6 meses'], [365, '1 ano']];
const BYS = [['first', 'Instalaron en el periodo'], ['last', 'Activas en el periodo']];

export function destroyInstallMap() {
  if (map) { map.remove(); map = null; }
}

// 'match' de MapLibre exige al menos una etiqueta: sin datos se devuelve 0.
const matchBy = (input, pairs) => (pairs.length ? ['match', input, ...pairs.flat(), 0] : 0);

// Datos del mapa listos para pintar. Un codigo por pais: MapLibre rechaza
// etiquetas repetidas en un 'match'.
function build(rows, installPoints) {
  const merged = new Map();
  for (const r of rows) {
    if (!r.country_code) continue;
    const code = r.country_code.toUpperCase();
    const prev = merged.get(code);
    merged.set(code, prev ? { ...prev, installs: prev.installs + r.installs } : { ...r, country_code: code });
  }
  const counts = [...merged.values()];
  const pairs = counts.map((r) => [r.country_code, r.installs]);
  return {
    counts,
    total: counts.reduce((acc, r) => acc + r.installs, 0),
    byCode: new Map(counts.map((r) => [r.country_code, r])),
    installs: matchBy(ISO, pairs),
    // Cada punto toma el color de su pais, con la misma escala que el relleno.
    pointInstalls: matchBy(['upcase', ['get', 'country_code']], pairs),
    pointsGeoJson: {
      type: 'FeatureCollection',
      features: installPoints.map((p) => ({
        type: 'Feature',
        properties: { machine_id: p.machine_id, country_code: p.country_code || '', city: p.city || '', country: countryName(p.country_code, p.country) },
        geometry: { type: 'Point', coordinates: [Number(p.lon), Number(p.lat)] },
      })),
    },
  };
}

const fetchData = () => {
  const period = { days: periodDays || null, by: periodDays ? periodBy : null };
  return Promise.all([
    api.get(`/api/dashboard/geo/countries${qs({ limit: 250, ...period })}`),
    api.get(`/api/dashboard/geo/installs${qs(period)}`),
  ]);
};

const subtitle = (d) => {
  const what = !periodDays ? 'de toda la historia'
    : periodBy === 'first' ? `instaladas en los ultimos ${periodDays} dias`
      : `activas en los ultimos ${periodDays} dias`;
  return `Instalaciones ${what} por pais: ${num(d.total)} en ${num(d.counts.length)} paises. Cuanto mas intenso, mas usuarios.`;
};

export async function installMapPage(view) {
  const myId = ++renderId;
  view.append(skeleton(3));

  const [rows, installPoints] = await fetchData();
  if (myId !== renderId) return;

  let data = build(rows, installPoints);
  let colors = gradient(Object.values(PALETTES)[0], BREAKS.length);

  const container = el('div', { style: 'height:520px;border-radius:var(--r-2, 8px);overflow:hidden' });
  const swatches = BREAKS.map(() => el('span', { style: 'width:14px;height:14px;border-radius:3px' }));
  const paintLegend = () => swatches.forEach((sw, i) => { sw.style.background = colors[i]; });
  paintLegend();

  // Aplica `data` y `colors` al mapa ya cargado, sin recrearlo (se conserva el zoom).
  const repaint = () => {
    if (!map || !map.getLayer('countries-fill')) return;
    map.setPaintProperty('countries-fill', 'fill-color', fillColor(data.installs, colors));
    map.setPaintProperty('installs-points', 'circle-color', fillColor(data.pointInstalls, colors));
  };

  const paletteSel = el('select', { class: 'field', 'aria-label': 'Colores del mapa', style: 'margin-left:auto' },
    ...Object.keys(PALETTES).map((name) => el('option', { value: name }, name)));
  paletteSel.addEventListener('change', () => {
    colors = gradient(PALETTES[paletteSel.value], BREAKS.length);
    paintLegend();
    repaint();
  });

  const subEl = el('div', { class: 'sub', text: subtitle(data) });

  const reload = async () => {
    try {
      const [r, pts] = await fetchData();
      if (myId !== renderId) return;
      data = build(r, pts);
      subEl.textContent = subtitle(data);
      if (map && map.getSource('installs')) map.getSource('installs').setData(data.pointsGeoJson);
      repaint();
    } catch (err) {
      toast(err.message, true);
    }
  };

  // "Instalaron / Activas" solo tiene sentido con un periodo elegido.
  const byWrap = el('span');
  const pick = (label, options, get, set) => {
    const sel = el('select', { class: 'field', 'aria-label': label },
      ...options.map(([v, text]) => el('option', { value: v, selected: String(v) === String(get()) }, text)));
    sel.addEventListener('change', () => { set(sel.value); byWrap.hidden = !periodDays; reload(); });
    return sel;
  };

  const toggle = (text, layers) => {
    const box = el('input', { type: 'checkbox', checked: true });
    box.addEventListener('change', () => layers.forEach((id) => map && map.getLayer(id) &&
      map.setLayoutProperty(id, 'visibility', box.checked ? 'visible' : 'none')));
    return el('label', { class: 'kpi-sub', style: 'margin:0;display:flex;align-items:center;gap:4px' }, box, text);
  };

  byWrap.append(pick('Criterio del periodo', BYS, () => periodBy, (v) => { periodBy = v; }));
  byWrap.hidden = !periodDays;
  const periodSel = pick('Periodo', PERIODS, () => periodDays, (v) => { periodDays = Number(v); });

  const legend = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-top:var(--s-3);flex-wrap:wrap' },
    el('span', { class: 'kpi-sub', style: 'margin:0', text: 'Instalaciones:' }),
    ...BREAKS.map((_, i) => el('span', { class: 'kpi-sub', style: 'margin:0;display:flex;align-items:center;gap:4px' },
      swatches[i], rangeLabel(i))),
    toggle('Paises', ['countries-fill', 'countries-line']),
    toggle('Usuarios', ['installs-points']),
    paletteSel,
  );

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Mapa de instalaciones' }), subEl),
      el('div', { class: 'filters', style: 'margin:0' }, periodSel, byWrap)
    ),
    el('div', { class: 'card' }, container, legend),
  );

  destroyInstallMap();
  map = new maplibregl.Map({
    container, style: BASEMAP_STYLE, center: [10, 20], zoom: 1.1,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.addControl(new maplibregl.FullscreenControl(), 'top-left');

  map.on('load', () => {
    // Debajo de las etiquetas del mapa base, para que los nombres sigan legibles.
    const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addSource('countries', { type: 'geojson', data: COUNTRIES_URL });
    map.addLayer({
      id: 'countries-fill',
      type: 'fill',
      source: 'countries',
      paint: {
        'fill-color': fillColor(data.installs, colors),
        'fill-opacity': 0.85,
      },
    }, firstLabel);
    map.addLayer({
      id: 'countries-line', type: 'line', source: 'countries',
      paint: { 'line-color': '#ffffff', 'line-width': 0.5 },
    }, firstLabel);

    map.addSource('installs', { type: 'geojson', data: data.pointsGeoJson });
    map.addLayer({
      id: 'installs-points', type: 'circle', source: 'installs',
      paint: {
        'circle-color': fillColor(data.pointInstalls, colors),
        'circle-radius': 5,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
      },
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on('mouseenter', 'installs-points', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features[0].properties;
      popup.setLngLat(e.features[0].geometry.coordinates)
        .setDOMContent(el('div', { style: 'color:#111;font-size:12px' },
          el('strong', { text: [p.city, p.country].filter(Boolean).join(', ') || 'Ubicacion desconocida' }),
          el('div', { text: '1 instalacion' })))
        .addTo(map);
    });
    map.on('mouseleave', 'installs-points', () => { map.getCanvas().style.cursor = ''; popup.remove(); });
    map.on('click', 'installs-points', (e) => { popup.remove(); showInstall(e.features[0].properties.machine_id); });
    map.on('mousemove', 'countries-fill', (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ['installs-points'] }).length) return;
      const p = e.features[0].properties;
      const code = p.ISO_A2_EH || p.ISO_A2;
      const r = data.byCode.get(code);
      map.getCanvas().style.cursor = 'pointer';
      popup.setLngLat(e.lngLat)
        .setDOMContent(el('div', { style: 'color:#111;font-size:12px' },
          el('strong', { text: countryName(code, p.NAME) }),
          el('div', { text: `${num(r ? r.installs : 0)} instalaciones` })))
        .addTo(map);
    });
    map.on('mouseleave', 'countries-fill', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
  });
}
