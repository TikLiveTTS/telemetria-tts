'use strict';

const MAX_WORDS = 500;
const MAX_LANGUAGE = 16;
const HASH_RE = /^[a-f0-9]{64}$/i;

function normalizeWord(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 40 || raw.includes('@')) return null;
  if (/(?:https?:\/\/|www\.)/i.test(raw) || /\S+@\S+\.\S+/.test(raw) || /\d{6,}/.test(raw)) return null;

  const word = raw.toLowerCase()
    .replace(/ñ/g, '\uE000')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uE000/g, 'ñ')
    .replace(/\s+/g, ' ')
    .trim();
  return word && word.length <= 40 && word.split(' ').length <= 3 ? word : null;
}

function snapshot(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  if (!Object.keys(props).every((key) => ['words', 'lang', 'snapshot_at', 'list_hash'].includes(key))) return null;
  if (!Array.isArray(props.words) || props.words.length > MAX_WORDS) return null;
  if (props.lang != null && (typeof props.lang !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(props.lang) || props.lang.length > MAX_LANGUAGE)) return null;
  if (typeof props.list_hash !== 'string' || !HASH_RE.test(props.list_hash)) return null;
  const snapshotAt = new Date(props.snapshot_at);
  if (Number.isNaN(snapshotAt.getTime()) || snapshotAt.getTime() > Date.now() + 5 * 60 * 1000) return null;

  const words = props.words.map(normalizeWord).filter((word) => word !== null);
  return {
    words: [...new Set(words)], language: props.lang ? props.lang.toLowerCase() : null,
    snapshotAt, listHash: props.list_hash.toLowerCase(),
  };
}

function ignoreSnapshot(existing, data) {
  if (!existing) return false;
  const savedAt = new Date(existing.snapshot_at);
  return data.snapshotAt <= savedAt;
}

async function handle(ctx, event) {
  if (event.name !== 'blocked_words_snapshot') return;

  const data = snapshot(event.props);
  if (!data) return false;

  const saved = await ctx.client.query(
    `SELECT snapshot_at, list_hash FROM installation_blocked_word_snapshots
      WHERE machine_id = $1 FOR UPDATE`,
    [ctx.machine_id]
  );
  if (ignoreSnapshot(saved.rows[0], data)) return false;

  const { words, language } = data;
  if (words.length) {
    await ctx.client.query(
      `INSERT INTO blocked_words (word_norm, first_seen, last_seen)
       SELECT word, $2, NOW() FROM unnest($1::text[]) AS word
       ON CONFLICT (word_norm) DO UPDATE SET last_seen = NOW()`,
      [words, data.snapshotAt]
    );
    await ctx.client.query(
      `INSERT INTO installation_blocked_words (machine_id, word_norm, language, first_seen, last_seen)
       SELECT $1, word, $3, $4, NOW() FROM unnest($2::text[]) AS word
       ON CONFLICT (machine_id, word_norm) DO UPDATE SET
         language = EXCLUDED.language,
         last_seen = NOW()`,
      [ctx.machine_id, words, language, data.snapshotAt]
    );
  }
  await ctx.client.query(
    `INSERT INTO installation_blocked_word_snapshots (machine_id, snapshot_at, list_hash, last_seen)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (machine_id) DO UPDATE SET
       snapshot_at = EXCLUDED.snapshot_at, list_hash = EXCLUDED.list_hash, last_seen = NOW()`,
    [ctx.machine_id, data.snapshotAt, data.listHash]
  );
  return false; // Nunca persiste el snapshot crudo en events.
}

module.exports = { name: 'moderation', handle, normalizeWord, snapshot, ignoreSnapshot };
