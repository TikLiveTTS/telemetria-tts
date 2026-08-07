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
  const v = Number(m);
  if (v < 60) return `${v}m`;
  const h = Math.floor(v / 60);
  return `${h}h ${v % 60}m`;
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
  return el('span', { class: `pill pill-${platform}`, text: platform });
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
