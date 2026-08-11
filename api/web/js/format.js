// Utilidades de formato y construccion de DOM.
// Todo el texto entra por textContent: nunca se interpola HTML con datos que
// vienen de la DB (un @ de TikTok puede contener cualquier cosa).

export function num(n) {
  if (n === null || n === undefined || n === '') return '0';
  return Number(n).toLocaleString('es');
}

export function compact(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(v);
}

export function minutes(m) {
  if (m == null) return '—';
  const v = Math.round(Number(m));
  if (v < 60) return `${v}m`;
  const h = Math.floor(v / 60);
  return `${h}h ${v % 60}m`;
}

// Nombre legible por plataforma. platformPill() sigue usando la clave en
// minuscula para la clase CSS (pill-tiktok, etc.), solo el texto cambia.
export const PLATFORM_LABELS = { tiktok: 'TikTok', twitch: 'Twitch', youtube: 'YouTube' };

// Nombre legible por conector. Compartido entre Funciones y Sesiones.
export const CONNECTOR_LABELS = {
  app: 'App', creators: 'Creadores', platforms: 'Plataformas', errors: 'Errores',
  tts: 'TTS', music: 'Musica', soundpad: 'Soundpad', obs: 'OBS',
  mobile: 'Movil', overlays: 'Overlays', moderation: 'Moderacion',
  updates: 'Actualizaciones', settings: 'Ajustes',
};

// tts_queue_overflow -> "Tts queue overflow". Cosmetico: el nombre tecnico
// original va como title (tooltip) en el llamador, nunca se pierde del todo.
export function prettyEvent(name) {
  const s = String(name || '').replace(/[_.]/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
}

// Nombre de pais en español via Intl.DisplayNames. Sin mapa a mano: cubre
// casi todos los codigos ISO automaticamente. Cae al string crudo si el
// codigo falta o el navegador no soporta la API.
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['es'], { type: 'region' }); } catch (_) { /* navegador viejo */ }

export function countryName(code, fallback) {
  if (code && regionNames) {
    try {
      const name = regionNames.of(String(code).toUpperCase());
      if (name) return name;
    } catch (_) { /* codigo invalido */ }
  }
  return fallback || '—';
}

// ["a","b","c","d","e","f"] -> "a, b, c, d, e +1 mas"
export function truncatedList(items, max = 5) {
  if (!items || !items.length) return '—';
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} +${items.length - max} mas`;
}

export function date(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function relative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} d`;
  return date(ts);
}

// el(tag, props, ...children) — constructor de elementos sin innerHTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // solo para markup estatico
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function platformPill(platform) {
  return el('span', { class: `pill pill-${platform}`, text: PLATFORM_LABELS[platform] || platform });
}

// Avatar con fallback a la inicial: las URLs de TikTok caducan.
export function avatar(url, name, big = false) {
  const cls = big ? 'avatar avatar-lg' : 'avatar';
  if (url) {
    const img = el('img', { class: cls, src: url, alt: name || '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(initials(name, cls)));
    return img;
  }
  return initials(name, cls);
}

function initials(name, cls) {
  return el('div', { class: `${cls} avatar-ph`, text: (name || '?').charAt(0).toUpperCase() });
}

export function toast(message, isError = false) {
  const node = el('div', { class: `toast${isError ? ' err' : ''}`, text: message });
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}

export function skeleton(rows = 4) {
  return el('div', { class: 'stack' }, Array.from({ length: rows }, () => el('div', { class: 'skel' })));
}
