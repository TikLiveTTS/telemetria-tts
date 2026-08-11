import { api } from '../api.js';
import { el, num, date, toast, skeleton } from '../format.js';

export async function settingsPage(view) {
  view.append(skeleton(3));

  const s = await api.get('/api/dashboard/status');
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
