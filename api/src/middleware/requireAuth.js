'use strict';

const { sessionFrom } = require('../auth');

function requireAuth(req, res, next) {
  const session = sessionFrom(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  req.session = session;
  next();
}

module.exports = { requireAuth };
