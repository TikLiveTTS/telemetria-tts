'use strict';

// Ciclo de vida de la app: startup / heartbeat / shutdown.
//
// La fila de `sessions` la crea ingest.ensureSession antes de llegar aqui, asi
// que `startup` solo necesita fijar la hora real de arranque.

async function handle(ctx, event) {
  const { client, machine_id, session_id } = ctx;

  if (event.name === 'startup') {
    await client.query(
      'UPDATE sessions SET started_at = $2 WHERE session_id = $1',
      [session_id, event.ts]
    );
    return;
  }

  if (event.name === 'heartbeat') {
    await client.query(
      'UPDATE sessions SET last_heartbeat_at = $2 WHERE session_id = $1',
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

    await client.query(
      `UPDATE sessions
          SET ended_at = $2,
              session_duration_minutes = COALESCE($3, session_duration_minutes),
              platforms_used = COALESCE($4, platforms_used)
        WHERE session_id = $1`,
      [session_id, event.ts, minutes, platforms]
    );

    if (minutes != null) {
      await client.query(
        'UPDATE installs SET total_minutes = total_minutes + $2 WHERE machine_id = $1',
        [machine_id, minutes]
      );
      // Los minutos tambien se acumulan en los canales de este usuario, que es
      // lo que se muestra en la tabla de creadores.
      await client.query(
        `UPDATE creators
            SET total_minutes = total_minutes + $2,
                total_sessions = total_sessions + 1
          WHERE machine_id = $1`,
        [machine_id, minutes]
      );
    }
  }
}

module.exports = { name: 'app', handle };
