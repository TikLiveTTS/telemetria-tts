import { api } from '../api.js';
import { el, num, date, toast, skeleton } from '../format.js';

// Descripcion de las columnas del CSV de analisis, lista para pegarla junto al archivo en una IA.
const ANALYSIS_DICTIONARY = `Archivo: telemetria-analisis.csv. Telemetria de TikLiveTTS (app de TTS para streamers). Una fila por instalacion de la app; la clave es "id" (seudonimo, sin datos personales).
Columnas:
- first_seen_date, last_seen_date: primera y ultima vez que se vio la app (fecha local, America/Guayaquil).
- age_days: dias desde la instalacion. days_since_last_seen: dias desde la ultima vez que se abrio.
- status: activo (visto en los ultimos 7 dias), enfriandose (7 a 14 dias sin abrir), perdido (14+ dias sin abrir).
- app_version, os_platform, os_release, os_arch, locale: version de la app y equipo/idioma.
- country_code, country, city: ubicacion aproximada por IP.
- total_sessions, total_minutes: totales de toda la vida.
- sessions_7d / sessions_30d / sessions_90d: sesiones en esas ventanas. minutes_30d: minutos de uso en 30 dias.
- avg_session_min, max_session_min: duracion media y maxima de sesiones cerradas.
- active_days: dias distintos con uso (toda la vida). active_days_30d: lo mismo en los ultimos 30 dias.
- peak_hour_local: hora del dia (0-23, aproximada por longitud) en que mas abre la app. peak_weekday_1mon: dia de la semana mas usado (1=lunes ... 7=domingo). weekend_sessions_pct: % de sesiones en fin de semana.
- returned_next_day / returned_within_7d / returned_within_30d: true si volvio a abrir la app tras el dia de instalacion en ese plazo (solo comparable entre instalaciones con age_days suficiente).
- minutes_to_first_connect: minutos entre instalar y conectar por primera vez una plataforma (vacio = nunca conecto).
- platforms_used, n_platforms: plataformas (tiktok, twitch, youtube, kick) usadas en sesiones.
- events_90d, distinct_features_90d: cantidad de eventos y de funciones distintas usadas en 90 dias.
- top_features_90d: las 5 funciones mas usadas en 90 dias, formato conector.funcion:veces separadas por "|".
- n_channels, channel_platforms, max_followers, is_public_creator: canales de creador vinculados, plataformas, seguidores maximos y si aparece en la web publica.
Valores vacios = sin dato. No incluye IP, coordenadas, correos ni nombres de canal.`;

let renderId = 0;

export async function settingsPage(view) {
  const myId = ++renderId;
  view.append(skeleton(3));

  const s = await api.get('/api/dashboard/status');
  if (myId !== renderId) return; // se navego a otra pagina mientras esperaba
  const base = location.origin;

  const snippet =
    `<div id="ttt-creators"></div>\n` +
    `<script src="${base}/embed/creators.js"><\/script>`;

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Ajustes' }),
        el('div', { class: 'sub', text: 'Estado del servicio y utilidades de mantenimiento' }))
    ),

    el('div', { class: 'grid-2' },
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Configuracion activa' }),
        el('dl', { class: 'kv' },
          el('dt', { text: 'Zona horaria' }),  el('dd', { text: s.timezone }),
          el('dt', { text: 'Retencion' }),     el('dd', { text: `${s.retention_days} dias de eventos crudos` }),
          el('dt', { text: 'IP anonimizada' }), el('dd', { text: s.anonymize_ip ? 'si, se recorta el ultimo tramo de la IP antes de guardarla' : 'no, se guarda completa' }),
          el('dt', { text: 'Origen publico' }), el('dd', { class: 'mono', text: s.public_origin }),
        )
      ),
      el('div', { class: 'card' },
        el('div', { class: 'section-title', text: 'Base de datos' }),
        el('dl', { class: 'kv' },
          el('dt', { text: 'Tamano' }),       el('dd', { text: s.db_size }),
          el('dt', { text: 'Instalaciones' }), el('dd', { text: num(s.installs_rows) }),
          el('dt', { text: 'Sesiones' }),      el('dd', { text: num(s.sessions_rows) }),
          el('dt', { text: 'Eventos' }),       el('dd', { text: num(s.events_rows) }),
          el('dt', { text: 'Creadores' }),     el('dd', { text: num(s.creators_rows) }),
          el('dt', { text: 'Evento mas viejo' }), el('dd', { text: s.oldest_event ? date(s.oldest_event) : '—' }),
          el('dt', { text: 'Rollup hasta', title: 'Ultima vez que se recalcularon los totales diarios' }),  el('dd', { text: s.rollup_last_day ? String(s.rollup_last_day).slice(0, 10) : 'nunca' }),
        )
      )
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Widget de creadores para tu web' }),
      el('p', { class: 'dim', style: 'font-size:var(--fs-sm);margin-bottom:var(--s-3)' },
        'Pega esto donde quieras la rejilla de creadores. Un visitante de tu web vera una grilla de tarjetas, una por cada creador marcado como publico, con su avatar, su nombre y un link a su canal. La grilla se actualiza sola: no hace falta tocar nada cuando sumes o saques creadores.'),
      el('code', { class: 'snippet', text: snippet }),
      el('div', { class: 'filters', style: 'margin-top:var(--s-3)' },
        el('button', { class: 'btn btn-sm', onclick: async () => {
          try {
            await navigator.clipboard.writeText(snippet);
            toast('Copiado al portapapeles');
          } catch (_) {
            toast('No se pudo copiar; seleccionalo a mano', true);
          }
        } }, 'Copiar'),
        el('a', { class: 'btn btn-sm', href: '/api/public/creators', target: '_blank' }, 'Ver JSON publico')
      )
    ),

    el('div', { class: 'card', style: 'margin-bottom:var(--s-5)' },
      el('div', { class: 'section-title', text: 'Datos para analizar (IA o a mano)' }),
      el('p', { class: 'dim', style: 'font-size:var(--fs-sm);margin-bottom:var(--s-3)' },
        'El CSV de analisis trae una fila por instalacion con metricas ya calculadas: antiguedad, uso en 7/30/90 dias, horas y dias preferidos, retencion, tiempo hasta conectar, funciones mas usadas, plataformas y creador. Sirve para buscar patrones, segmentos y causas de abandono. No incluye IP, coordenadas, correos ni nombres de canal. Pegale a la IA la descripcion de columnas junto al archivo.'),
      el('div', { class: 'filters', style: 'margin:0' },
        el('a', { class: 'btn btn-sm btn-accent', href: '/api/export/analysis.csv' }, '⬇ CSV de analisis'),
        el('a', { class: 'btn btn-sm', href: '/api/export/daily.csv?days=365&unit=day', title: 'Sesiones, usuarios unicos e instalaciones nuevas por dia' }, '⬇ Serie diaria (365 dias)'),
        el('button', { class: 'btn btn-sm', onclick: async () => {
          try {
            await navigator.clipboard.writeText(ANALYSIS_DICTIONARY);
            toast('Descripcion de columnas copiada');
          } catch (_) {
            toast('No se pudo copiar', true);
          }
        } }, 'Copiar descripcion de columnas')
      )
    ),

    el('div', { class: 'card' },
      el('div', { class: 'section-title', text: 'Mantenimiento' }),
      el('p', { class: 'dim', style: 'font-size:var(--fs-sm);margin-bottom:var(--s-3)' },
        'Ambas tareas corren solas cada hora. Estos botones solo las adelantan.'),
      el('div', { class: 'filters', style: 'margin:0' },
        el('button', { class: 'btn btn-sm', onclick: (e) => run(e, '/api/dashboard/maintenance/rollup',
          (r) => `Rollup recalculado (${num(r.rows)} filas)`) }, 'Recalcular rollup'),
        el('button', { class: 'btn btn-sm', onclick: (e) => run(e, '/api/dashboard/maintenance/purge',
          (r) => `Purga hecha (${num(r.deleted)} eventos borrados)`) }, 'Purgar eventos viejos')
      )
    )
  );
}

async function run(event, url, message) {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    toast(message(await api.post(url)));
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}
