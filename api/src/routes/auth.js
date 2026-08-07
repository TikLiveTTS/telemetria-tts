'use strict';

const express = require('express');
const config = require('../config');
const { verifyCredentials, issueCookie, clearCookie, sessionFrom } = require('../auth');
const { makeRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// 5 intentos cada 15 minutos por IP.
const loginLimit = makeRateLimit({
  max: 5,
  windowMs: 15 * 60 * 1000,
  message: 'Demasiados intentos. Prueba en unos minutos.',
});

router.post('/login', loginLimit, async (req, res) => {
  const { user, password } = req.body || {};
  const ok = await verifyCredentials(user, password);
  if (!ok) return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });

  issueCookie(res);
  res.json({ ok: true, user: config.adminUser });
});

router.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const session = sessionFrom(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: session.u, expires_at: session.exp, tz: config.tzDisplay });
});

module.exports = router;
