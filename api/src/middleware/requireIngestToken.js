'use strict';

const crypto = require('crypto');
const config = require('../config');

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function requireIngestToken(req, res, next) {
  const token = req.get('X-Ingest-Token');
  if (!token || !timingSafeEqual(token, config.ingestToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireIngestToken };
