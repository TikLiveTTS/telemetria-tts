'use strict';

function requireSession(session, req, res, next) {
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  req.session = session;
  next();
}

function requireAuth(req, res, next) {
  const { sessionFrom } = require('../auth');
  return requireSession(sessionFrom(req), req, res, next);
}

module.exports = { requireAuth, requireSession };
