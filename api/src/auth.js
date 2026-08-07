'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');

const COOKIE = 'ttt_session';

// El password del .env se hashea en memoria al arrancar. Nunca se guarda en la
// DB y nunca se compara en texto plano.
const passwordHash = bcrypt.hashSync(config.adminPassword, 10);

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function verifyCredentials(user, password) {
  // Se comprueba el password SIEMPRE, aunque el usuario no coincida, para que
  // el tiempo de respuesta no revele si el usuario existe.
  const userOk = timingSafeEqual(String(user || ''), config.adminUser);
  const passOk = await bcrypt.compare(String(password || ''), passwordHash);
  return userOk && passOk;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  if (!timingSafeEqual(mac, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function issueCookie(res) {
  const maxAgeMs = config.sessionHours * 3600 * 1000;
  const token = sign({ u: config.adminUser, exp: Date.now() + maxAgeMs });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // se expone por HTTP plano; poner true al montar TLS
    maxAge: maxAgeMs,
    path: '/',
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

function sessionFrom(req) {
  return verify(req.cookies && req.cookies[COOKIE]);
}

module.exports = { COOKIE, verifyCredentials, issueCookie, clearCookie, sessionFrom };
