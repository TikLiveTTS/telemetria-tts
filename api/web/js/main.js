import { api, setUnauthorizedHandler } from './api.js';
import { register, startRouter, renderCurrent, refreshCurrent } from './router.js';
import { initDrawer, closeDrawer } from './drawer.js';
import { initModal } from './modal.js';
import { toast } from './format.js';

import { overviewPage, overviewRefresh } from './pages/overview.js';
import { creatorsPage, creatorsRefresh } from './pages/creators.js';
import { geoPage, geoRefresh } from './pages/geo.js';
import { geoHistoryPage } from './pages/geo-history.js';
import { featuresPage, featureDetailPage, featuresRefresh, featureDetailRefresh } from './pages/features.js';
import { versionsPage, versionsRefresh } from './pages/versions.js';
import { sessionsPage, sessionsRefresh } from './pages/sessions.js';
import { settingsPage } from './pages/settings.js';
import { blockedWordsPage, blockedWordsRefresh } from './pages/blocked-words.js';
import { habitsPage } from './pages/habits.js';
import { activationPage } from './pages/activation.js';
import { installMapPage } from './pages/install-map.js';

const loginEl = () => document.getElementById('login');
const appEl = () => document.getElementById('app');

register('/overview', overviewPage, overviewRefresh);
register('/creators', creatorsPage, creatorsRefresh);
register('/geo', geoPage, geoRefresh);
// Sin refresco: el historial es una foto de 48 h; recargarla cada 60 s moveria el cursor.
register('/geo-history', geoHistoryPage, () => {});
register('/features', featuresPage, featuresRefresh);
register('/features/:param', featureDetailPage, featureDetailRefresh);
register('/versions', versionsPage, versionsRefresh);
register('/sessions', sessionsPage, sessionsRefresh);
register('/blocked-words', blockedWordsPage, blockedWordsRefresh);
// Sin refresco: son agregados de dias; recargarlos cada 60 s solo haria parpadear los graficos.
register('/habits', habitsPage, () => {});
register('/activation', activationPage, () => {});
register('/install-map', installMapPage, () => {});
register('/settings', settingsPage, settingsPage);

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

// fullRefresh reconstruye la vista de cero (login, cambio de ruta).
// dataRefresh solo re-pide los datos y actualiza el DOM existente
// (auto-refresco cada 60s) — sin destruir
// tablas/charts/mapa ni perder foco de busqueda o scroll.
async function fullRefresh() {
  await renderCurrent();
  stampRefresh();
}

let refreshing = false;

async function dataRefresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    await refreshCurrent();
    stampRefresh();
  } catch (_) {
    // El router ya avisó con un toast; "Actualizado" conserva la hora del último éxito.
  } finally {
    refreshing = false;
  }
}

function wireChrome() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await api.post('/api/auth/logout').catch(() => {});
    showLogin();
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
      await fullRefresh();
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
    if (document.visibilityState === 'visible' && !appEl().hidden) dataRefresh();
  }, 60000);
}

async function boot() {
  initDrawer();
  initModal();
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
