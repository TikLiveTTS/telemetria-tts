// Wrapper de fetch. Un 401 en cualquier punto devuelve al login.

let onUnauthorized = () => {};

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });

  if (res.status === 401) {
    onUnauthorized();
    throw new Error('unauthorized');
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    // El proxy (Caddy/Traefik) responde texto o HTML si la API esta reiniciando
    // o tarda demasiado: no es JSON, pero tampoco un fallo del panel.
    throw new Error(res.ok
      ? 'Respuesta inesperada del servidor, reintenta en unos segundos'
      : `El servidor no esta disponible (HTTP ${res.status}), reintenta en unos segundos`);
  }

  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: (url) => request(url),
  post: (url, body) => request(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: (url, body) => request(url, { method: 'PATCH', body: JSON.stringify(body) }),
};

// Estado compartido: el periodo elegido en la cabecera.
export const state = {
  days: 30,
};

export function qs(params) {
  const clean = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return clean.length ? '?' + new URLSearchParams(clean).toString() : '';
}
