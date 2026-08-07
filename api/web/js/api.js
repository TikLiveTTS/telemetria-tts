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
  const data = text ? JSON.parse(text) : null;

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
