'use strict';

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.postgresUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[db] error en cliente idle:', err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

// Espera a que Postgres acepte conexiones. depends_on + healthcheck ya cubre
// el caso normal, pero un reinicio del contenedor de la DB no deberia tumbar
// la API.
async function waitForDb(attempts = 30, delayMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[db] esperando a Postgres (${i}/${attempts})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = { pool, query, waitForDb };
