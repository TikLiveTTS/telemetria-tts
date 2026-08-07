'use strict';

const { query, pool } = require('../db');

const SORTS = {
  last_seen: 'c.last_seen_at DESC',
  first_seen: 'c.first_seen_at DESC',
  followers: 'c.follower_count DESC NULLS LAST',
  minutes: 'c.total_minutes DESC',
  sessions: 'c.total_sessions DESC',
  name: 'c.username ASC',
};

async function list({ page = 1, pageSize = 50, sort = 'last_seen', platform, q, onlyPublic, onlyNew, includeHidden }) {
  const where = [];
  const params = [];

  if (!includeHidden) where.push('NOT c.is_hidden');
  if (platform)  { params.push(platform); where.push(`c.platform = $${params.length}`); }
  if (onlyPublic) where.push('c.is_public');
  if (onlyNew)    where.push("c.first_seen_at > NOW() - INTERVAL '24 hours'");
  if (q) {
    params.push(`%${q}%`);
    where.push(`(c.username ILIKE $${params.length} OR c.display_name ILIKE $${params.length} OR c.user_id ILIKE $${params.length})`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = SORTS[sort] || SORTS.last_seen;
  params.push(pageSize, (page - 1) * pageSize);

  const { rows } = await query(
    `SELECT c.id, c.platform, c.username, c.user_id, c.display_name,
            c.channel_url, c.avatar_url, c.follower_count, c.peak_followers,
            c.country, c.app_version, c.resolve_count, c.force_resolve,
            c.first_seen_at, c.last_seen_at, c.total_sessions, c.total_minutes,
            c.is_public, c.is_hidden, c.featured_order, c.notes,
            (c.first_seen_at > NOW() - INTERVAL '24 hours') AS is_new,
            COUNT(*) OVER ()::int AS total_rows
       FROM creators c
       ${clause}
      ORDER BY ${order}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = rows.length ? rows[0].total_rows : 0;
  return { total, page, pageSize, rows: rows.map(({ total_rows, ...r }) => r) };
}

async function stats() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_public)::int AS public,
            COUNT(*) FILTER (WHERE is_hidden)::int AS hidden,
            COUNT(*) FILTER (WHERE first_seen_at > NOW() - INTERVAL '24 hours')::int AS new_today
       FROM creators`
  );
  return rows[0];
}

async function detail(id) {
  const { rows } = await query('SELECT * FROM creators WHERE id = $1', [id]);
  if (!rows.length) return null;
  const creator = rows[0];

  const [{ rows: history }, { rows: siblings }] = await Promise.all([
    query(
      `SELECT day, followers FROM creator_follower_history
        WHERE creator_id = $1 ORDER BY day`,
      [id]
    ),
    creator.user_id
      ? query(
          `SELECT id, platform, username, channel_url, follower_count
             FROM creators WHERE user_id = $1 AND id <> $2 ORDER BY platform`,
          [creator.user_id, id]
        )
      : Promise.resolve({ rows: [] }),
  ]);

  return { ...creator, history, siblings };
}

const PATCHABLE = ['is_public', 'is_hidden', 'featured_order', 'notes', 'display_name'];

async function patch(id, body) {
  const sets = [];
  const params = [id];

  for (const key of PATCHABLE) {
    if (!(key in body)) continue;
    let value = body[key];
    if (key === 'is_public' || key === 'is_hidden') value = !!value;
    if (key === 'featured_order') value = value == null || value === '' ? null : parseInt(value, 10) || null;
    if (key === 'notes' || key === 'display_name') {
      value = value == null ? null : String(value).slice(0, 1000);
    }
    params.push(value);
    sets.push(`${key} = $${params.length}`);
  }

  if (!sets.length) return null;

  const { rows } = await query(
    `UPDATE creators SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

const BULK_ACTIONS = {
  publish: 'is_public = TRUE',
  unpublish: 'is_public = FALSE',
  hide: 'is_hidden = TRUE, is_public = FALSE',
  unhide: 'is_hidden = FALSE',
};

async function bulk(ids, action) {
  const set = BULK_ACTIONS[action];
  if (!set) throw new Error('accion invalida');
  const { rowCount } = await query(
    `UPDATE creators SET ${set} WHERE id = ANY($1::bigint[])`,
    [ids]
  );
  return rowCount;
}

// Marca un canal para que la app lo vuelva a resolver una vez mas.
// resolve_count baja a 1 para que el cliente gaste exactamente una resolucion.
async function forceResolve(id) {
  const { rows } = await query(
    `UPDATE creators
        SET force_resolve = TRUE,
            resolve_count = LEAST(resolve_count, 1)
      WHERE id = $1
      RETURNING id, platform, username, resolve_count, force_resolve`,
    [id]
  );
  return rows[0] || null;
}

// Fusiona dos fichas del mismo creador (tipico tras reinstalar el sistema).
// `keepId` conserva la ficha; `mergeId` aporta sus acumulados y desaparece.
async function merge(keepId, mergeId) {
  if (String(keepId) === String(mergeId)) throw new Error('no se puede fusionar una ficha consigo misma');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id, total_sessions, total_minutes, first_seen_at, last_seen_at, peak_followers FROM creators WHERE id = ANY($1::bigint[]) FOR UPDATE',
      [[keepId, mergeId]]
    );
    if (rows.length !== 2) throw new Error('alguna de las dos fichas no existe');

    const keep = rows.find((r) => String(r.id) === String(keepId));
    const gone = rows.find((r) => String(r.id) === String(mergeId));

    await client.query(
      `UPDATE creators SET
         total_sessions = $2,
         total_minutes  = $3,
         first_seen_at  = LEAST(first_seen_at, $4),
         last_seen_at   = GREATEST(last_seen_at, $5),
         peak_followers = GREATEST(COALESCE(peak_followers, 0), COALESCE($6, 0))
       WHERE id = $1`,
      [
        keepId,
        keep.total_sessions + gone.total_sessions,
        keep.total_minutes + gone.total_minutes,
        gone.first_seen_at, gone.last_seen_at, gone.peak_followers,
      ]
    );

    // El historial de seguidores se traspasa; ante choque de dia gana el mayor.
    await client.query(
      `INSERT INTO creator_follower_history (creator_id, day, followers)
       SELECT $1, day, followers FROM creator_follower_history WHERE creator_id = $2
       ON CONFLICT (creator_id, day) DO UPDATE
         SET followers = GREATEST(creator_follower_history.followers, EXCLUDED.followers)`,
      [keepId, mergeId]
    );

    await client.query('DELETE FROM creators WHERE id = $1', [mergeId]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Lo unico que sale al mundo exterior. Nunca machine_id, IP ni notas.
async function publicList(limit = 200) {
  const { rows } = await query(
    `SELECT platform, username, display_name, channel_url, avatar_url, follower_count
       FROM creators
      WHERE is_public AND NOT is_hidden
      ORDER BY featured_order NULLS LAST, follower_count DESC NULLS LAST, last_seen_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    platform: r.platform,
    username: r.username,
    display_name: r.display_name || r.username,
    url: r.channel_url,
    avatar: r.avatar_url,
    followers: r.follower_count,
  }));
}

module.exports = { list, stats, detail, patch, bulk, forceResolve, merge, publicList };
