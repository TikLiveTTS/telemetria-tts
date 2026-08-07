'use strict';

// Runner de migraciones idempotente. Corre al arrancar la API, antes de
// escuchar en el puerto. Cada archivo .sql de migrations/ se aplica una sola
// vez y queda anotado en schema_migrations.

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

const DIR = path.join(__dirname, 'migrations');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      // Cada migracion es atomica: o entra entera, o no entra.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] aplicada ${file}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migracion ${file} fallo: ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log(ran === 0 ? '[migrate] sin cambios' : `[migrate] ${ran} migracion(es) aplicadas`);
}

module.exports = { migrate };
