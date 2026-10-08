import { api } from '../api.js';
import { el, num, skeleton, countryName } from '../format.js';

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

export function destroyInstallMap() {
  if (map) { map.remove(); map = null; }
}

export async function installMapPage(view) {
  const myId = ++renderId;
  view.append(skeleton(3));

  const rows = await api.get('/api/dashboard/geo/countries?limit=250');
  if (myId !== renderId) return;

  const counts = rows.filter((r) => r.country_code);
  const total = counts.reduce((acc, r) => acc + r.installs, 0);
  let colors = gradient(Object.values(PALETTES)[0], BREAKS.length);

  const container = el('div', { style: 'height:520px;border-radius:var(--r-2, 8px);overflow:hidden' });
  const swatches = BREAKS.map(() => el('span', { style: 'width:14px;height:14px;border-radius:3px' }));
  const paintLegend = () => swatches.forEach((sw, i) => { sw.style.background = colors[i]; });
  paintLegend();

  const paletteSel = el('select', { class: 'field', 'aria-label': 'Colores del mapa', style: 'margin-left:auto' },
    ...Object.keys(PALETTES).map((name) => el('option', { value: name }, name)));
  paletteSel.addEventListener('change', () => {
    colors = gradient(PALETTES[paletteSel.value], BREAKS.length);
    paintLegend();
    if (map && map.getLayer('countries-fill')) map.setPaintProperty('countries-fill', 'fill-color', fillColor(installs, colors));
  });

  const legend = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-top:var(--s-3);flex-wrap:wrap' },
    el('span', { class: 'kpi-sub', style: 'margin:0', text: 'Instalaciones:' }),
    ...BREAKS.map((_, i) => el('span', { class: 'kpi-sub', style: 'margin:0;display:flex;align-items:center;gap:4px' },
      swatches[i], rangeLabel(i))),
    paletteSel,
  );

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Mapa de instalaciones' }),
        el('div', { class: 'sub', text: `Instalaciones de toda la historia por pais: ${num(total)} en ${num(counts.length)} paises. Cuanto mas intenso, mas usuarios.` }))
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

  const installs = ['match', ISO, ...counts.flatMap((r) => [r.country_code.toUpperCase(), r.installs]), 0];
  const byCode = new Map(counts.map((r) => [r.country_code.toUpperCase(), r]));

  map.on('load', () => {
    // Debajo de las etiquetas del mapa base, para que los nombres sigan legibles.
    const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addSource('countries', { type: 'geojson', data: COUNTRIES_URL });
    map.addLayer({
      id: 'countries-fill',
      type: 'fill',
      source: 'countries',
      paint: {
        'fill-color': fillColor(installs, colors),
        'fill-opacity': 0.85,
      },
    }, firstLabel);
    map.addLayer({
      id: 'countries-line', type: 'line', source: 'countries',
      paint: { 'line-color': '#ffffff', 'line-width': 0.5 },
    }, firstLabel);

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on('mousemove', 'countries-fill', (e) => {
      const p = e.features[0].properties;
      const code = p.ISO_A2_EH || p.ISO_A2;
      const r = byCode.get(code);
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
