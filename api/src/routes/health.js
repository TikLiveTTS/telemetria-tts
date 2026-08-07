'use strict';

const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'db unavailable' });
  }
});

module.exports = router;
