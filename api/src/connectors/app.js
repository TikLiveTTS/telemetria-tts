'use strict';

// Ciclo de vida de la app: startup / heartbeat / shutdown.
//
// La fila de `sessions` la crea ingest.ensureSession antes de llegar aqui, asi
// que `startup` solo necesita fijar la hora real de arranque.

async function handle(ctx, event) {
  const { client, machine_id, session_id } = ctx;

  if (event.name === 'startup') {
    await client.query(
      'UPDATE sessions SET started_at = $2, received_at = NOW() WHERE session_id = $1',
      [session_id, event.ts]
    );
    return;
  }

  if (event.name === 'heartbeat') {
    await client.query(
      `UPDATE sessions
          SET last_heartbeat_at = GREATEST(last_heartbeat_at, $2),
              received_at = NOW()
        WHERE session_id = $1 AND ended_at IS NULL`,
      [session_id, event.ts]
    );
    return;
  }

  if (event.name === 'shutdown') {
    const minutes = Number.isFinite(event.props.duration_minutes)
      ? Math.max(0, Math.round(event.props.duration_minutes))
      : null;
    const platforms = Array.isArray(event.props.platforms_used)
      ? event.props.platforms_used.filter((p) => typeof p === 'string').slice(0, 8)
      : null;

    const { rows } = await client.query(
      `UPDATE sessions
          SET ended_at = $2,
              session_duration_minutes = COALESCE($3, session_duration_minutes),
              platforms_used = COALESCE($4, platforms_used)
        WHERE session_id = $1 AND $2::timestamptz >= started_at
        RETURNING platforms_used`,
      [session_id, event.ts, minutes, platforms]
    );
    if (!rows.length) {
      console.warn('[app] late_shutdown_discarded', { session_id });
      return;
    }
    const usedPlatforms = rows[0]?.platforms_used || [];

    if (minutes != null) {
      await client.query(
        'UPDATE installs SET total_minutes = total_minutes + $2 WHERE machine_id = $1',
        [machine_id, minutes]
      );
      if (usedPlatforms.length) {
        await client.query(
          `UPDATE creators
              SET total_minutes = total_minutes + $2,
                  total_sessions = total_sessions + 1
            WHERE machine_id = $1 AND platform = ANY($3::text[])`,
          [machine_id, minutes, usedPlatforms]
        );
      }
    }
  }
}

module.exports = { name: 'app', handle };
