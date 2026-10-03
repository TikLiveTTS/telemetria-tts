'use strict';

const { query } = require('../db');
const config = require('../config');

function conditions({ lang, prefix }, params) {
  const where = [];
  if (lang) {
    params.push(lang);
    where.push(`ibw.language = $${params.length}`);
  }
  if (prefix) {
    params.push(`${prefix.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`ibw.word_norm ILIKE $${params.length} ESCAPE '\\'`);
  }
  return where.join(' AND ');
}

async function ranking({ days = 30, k = config.blockedWordsK, lang = null, prefix = null, page = 1, pageSize = 50 }) {
  const params = [config.activeDays];
  const where = conditions({ lang, prefix }, params);
  params.push(k, pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `WITH active AS (
       SELECT GREATEST(COUNT(*)::int, 1) AS users
         FROM installation_blocked_word_snapshots s
        WHERE $1::int = 0 OR s.last_seen >= NOW() - make_interval(days => $1::int)
     ), ranked AS (
       SELECT ibw.word_norm,
              COUNT(DISTINCT ibw.machine_id)::int AS usuarios_distintos,
              ROUND(100.0 * COUNT(DISTINCT ibw.machine_id) / (SELECT users FROM active), 1) AS porcentaje_de_usuarios_activos,
              MIN(ibw.first_seen) AS first_seen,
              MAX(ibw.last_seen) AS last_seen
         FROM installation_blocked_words ibw
         JOIN installation_blocked_word_snapshots s USING (machine_id)
        WHERE ($1::int = 0 OR s.last_seen >= NOW() - make_interval(days => $1::int))${where ? ` AND ${where}` : ''}
        GROUP BY ibw.word_norm
       HAVING COUNT(DISTINCT ibw.machine_id) >= $${params.length - 2}
     )
     SELECT *, COUNT(*) OVER ()::int AS total_rows
       FROM ranked
      ORDER BY usuarios_distintos DESC, word_norm
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = rows.length ? rows[0].total_rows : 0;
  return { total, page, pageSize, rows: rows.map(({ total_rows, ...row }) => row) };
}

async function summary({ days = 30, k = config.blockedWordsK, lang = null, prefix = null }) {
  const params = [config.activeDays];
  const where = conditions({ lang, prefix }, params);
  params.push(k);
  const [{ rows: totals }, { rows: weekly }] = await Promise.all([
    query(
      `WITH filtered AS (
         SELECT ibw.word_norm, ibw.machine_id
           FROM installation_blocked_words ibw
           JOIN installation_blocked_word_snapshots s USING (machine_id)
          WHERE ($1::int = 0 OR s.last_seen >= NOW() - make_interval(days => $1::int))${where ? ` AND ${where}` : ''}
       ), grouped AS (
         SELECT word_norm, COUNT(DISTINCT machine_id)::int AS users FROM filtered GROUP BY word_norm
       )
       SELECT (SELECT COUNT(DISTINCT machine_id)::int FROM filtered) AS installations_with_list,
              (SELECT COUNT(*)::int FROM grouped) AS unique_words,
              (SELECT COUNT(*)::int FROM grouped WHERE users >= $${params.length}) AS words_over_k`,
      params
    ),
    query(
      `SELECT to_char(week, 'YYYY-MM-DD') AS week, COUNT(*)::int AS words
         FROM blocked_word_weekly
        WHERE week >= (NOW() - make_interval(days => $1::int))::date
          AND users >= $2::int
        GROUP BY 1
        ORDER BY 1`,
      [days, k]
    ),
  ]);
  return { ...totals[0], weekly };
}

async function exportRows(options) {
  return (await ranking({ ...options, page: 1, pageSize: 10000 })).rows;
}

module.exports = { ranking, summary, exportRows };
