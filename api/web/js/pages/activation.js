import { api } from '../api.js';
import { el, num, minutes, skeleton } from '../format.js';
import { lineChart, barChart, updateChart, COLORS } from '../charts.js';
import { section, kpi } from './habits.js';

// Periodo propio de esta pagina (el resto del panel usa 30 dias fijos).
const PERIODS = [[1, 'Dia'], [3, '3 dias'], [7, 'Semana'], [14, '2 semanas'], [30, '1 mes']];
let days = 30;
let renderId = 0;

export async function activationPage(view) {
  const myId = ++renderId;
  view.append(skeleton(3));

  const d = await api.get(`/api/dashboard/activation?days=${days}`);
  if (myId !== renderId) return;

  const sub = el('div', { class: 'sub' });
  const kpis = el('div', { class: 'kpis' });
  const cFirst = el('canvas');
  const cPareto = el('canvas');

  const buttons = PERIODS.map(([n, label]) => el('button', {
    type: 'button',
    onclick: async () => {
      if (n === days) return;
      days = n;
      paintButtons();
      const id = renderId;
      const fresh = await api.get(`/api/dashboard/activation?days=${days}`);
      // Si mientras tanto se eligio otro periodo, esta respuesta ya no vale.
      if (id === renderId && n === days) apply(fresh);
    },
  }, label));
  const paintButtons = () => buttons.forEach((b, i) => {
    const on = PERIODS[i][0] === days;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  view.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {}, el('h2', { text: 'Activacion' }), sub),
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Periodo' }, ...buttons)
    ),
    kpis,
    section('Tiempo hasta el primer uso real',
      'Minutos desde que aparece una instalacion nueva hasta que conecta por primera vez a TikTok, Twitch, YouTube o Kick. Si se acumulan a la derecha, configurar la app cuesta trabajo.', cFirst),
    section('Pareto de usuarios',
      'Porcentaje de las horas de uso que aporta el X% de usuarios que mas la usan. Cuanto mas pegada arriba a la izquierda, mas concentrado esta el uso.', cPareto),
  );
  paintButtons();

  let chartFirst = null;
  let chartPareto = null;

  function apply(data) {
    const fu = data.first_use;
    const never = fu.rows.find((r) => r.bucket === 'Nunca')?.users || 0;
    const label = PERIODS.find(([n]) => n === days)[1].toLowerCase();

    sub.textContent = `Instalaciones nuevas y concentracion del uso: ${days === 1 ? 'ultimas 24 horas' : `ultimos ${days} dias`} (${label})`;
    kpis.replaceChildren(
      kpi('Instalaciones nuevas', num(fu.total), 'en el periodo', 'accent'),
      kpi('Mediana hasta conectar', fu.median_min === null ? '—' : minutes(fu.median_min), 'desde que aparece la instalacion', 'cyan'),
      kpi('Nunca conectaron', num(never), fu.total ? `${Math.round((100 * never) / fu.total)}% de las nuevas` : '', 'yellow'),
      kpi('Top 10% de usuarios', data.pareto.top10 === null ? '—' : `${data.pareto.top10}%`, 'de las horas de uso'),
      kpi('Top 20% de usuarios', data.pareto.top20 === null ? '—' : `${data.pareto.top20}%`, 'de las horas de uso'),
    );

    const firstLabels = fu.rows.map((r) => r.bucket);
    const firstData = fu.rows.map((r) => r.users);
    const paretoLabels = data.pareto.rows.map((r) => `${r.pct_users}%`);
    const paretoData = data.pareto.rows.map((r) => r.pct_hours);

    if (chartFirst) updateChart(chartFirst, firstLabels, [firstData]);
    else chartFirst = barChart(cFirst, firstLabels, firstData, { label: 'Instalaciones' });
    if (chartPareto) updateChart(chartPareto, paretoLabels, [paretoData]);
    else chartPareto = lineChart(cPareto, paretoLabels, [
      { label: '% de horas acumuladas', data: paretoData, color: COLORS.accent2 },
    ], { max: 100 });
  }

  apply(d);
}
