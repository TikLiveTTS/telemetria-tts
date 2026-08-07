'use strict';

// Conexiones a TikTok / Twitch / YouTube.
// Mantiene `sessions.platforms_used` al dia sin esperar al shutdown, que es
// justo lo que hoy nunca se llega a enviar.

const VALID = new Set(['tiktok', 'twitch', 'youtube']);

async function handle(ctx, event) {
  if (event.name !== 'connected') return;

  const platform = String(event.props.platform || '').toLowerCase();
  if (!VALID.has(platform)) return;

  await ctx.client.query(
    `UPDATE sessions
        SET platforms_used = CASE
              WHEN $2 = ANY(platforms_used) THEN platforms_used
              ELSE array_append(platforms_used, $2)
            END
      WHERE session_id = $1`,
    [ctx.session_id, platform]
  );
}

module.exports = { name: 'platforms', handle };
