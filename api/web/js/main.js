import { api, state, setUnauthorizedHandler } from './api.js';
import { register, startRouter, renderCurrent } from './router.js';
import { initDrawer, closeDrawer } from './drawer.js';
import { toast } from './format.js';

import { overviewPage } from './pages/overview.js';
import { creatorsPage } from './pages/creators.js';
import { geoPage } from './pages/geo.js';
import { featuresPage, featureDetailPage } from './pages/features.js';
import { versionsPage } from './pages/versions.js';
import { sessionsPage } from './pages/sessions.js';
import { errorsPage } from './pages/errors.js';
import { settingsPage } from './pages/settings.js';

const loginEl = () => document.getElementById('login');
const appEl = () => document.getElementById('app');

register('/overview', overviewPage);
register('/creators', creatorsPage);
register('/geo', geoPage);
register('/features', featuresPage);
register('/features/:param', featureDetailPage);
register('/versions', versionsPage);
register('/sessions', sessionsPage);
register('/errors', errorsPage);
register('/settings', settingsPage);

function showLogin() {
  closeDrawer();
  appEl().hidden = true;
  loginEl().hidden = false;
  document.getElementById('f-user').focus();
}

function showApp() {
  loginEl().hidden = true;
  appEl().hidden = false;
}

setUnauthorizedHandler(showLogin);

function stampRefresh() {
  document.getElementById('last-refresh').textContent =
    'Actualizado ' + new Date().toLocaleTimeString('es');
}

async function refresh() {
  await renderCurrent();
  stampRefresh();
}

function wireChrome() {
  document.getElementById('btn-refresh').addEventListener('click', refresh);

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await api.post('/api/auth/logout').catch(() => {});
    showLogin();
  });

  document.getElementById('period').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-days]');
    if (!btn) return;
    state.days = Number(btn.dataset.days);
    for (const b of e.currentTarget.children) b.classList.toggle('active', b === btn);
    refresh();
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('login-error');
    errBox.textContent = '';

    try {
      await api.post('/api/auth/login', {
        user: document.getElementById('f-user').value,
        password: document.getElementById('f-pass').value,
      });
      document.getElementById('f-pass').value = '';
      showApp();
      await refresh();
    } catch (err) {
      // El handler global de 401 no debe expulsar del propio login.
      errBox.textContent = err.message === 'unauthorized'
        ? 'Usuario o contrasena incorrectos'
        : err.message;
    }
  });

  // Refresco automatico cada 60 s, solo si la pestana esta visible: no tiene
  // sentido machacar la DB con el panel abierto en segundo plano.
  setInterval(() => {
    if (document.visibilityState === 'visible' && !appEl().hidden) refresh();
  }, 60000);
}

async function boot() {
  initDrawer();
  wireChrome();

  try {
    await api.get('/api/auth/me');
  } catch (_) {
    return showLogin();
  }

  showApp();
  await startRouter();
  stampRefresh();
}

boot().catch((err) => toast(err.message, true));
