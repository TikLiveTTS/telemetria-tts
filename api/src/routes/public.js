'use strict';

const express = require('express');
const config = require('../config');
const c = require('../queries/creators');
const { makeRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Endpoints sin autenticacion, pensados para incrustarse en la web publica.
// Solo exponen creadores que han sido aprobados a mano en el panel.

const limit = makeRateLimit({ max: 120, windowMs: 60 * 1000 });

// Cada entrada de config.publicOrigin admite un unico comodin "*" (ej. para
// hashes de preview de Vercel). "*" a secas permite cualquier origen.
function originAllowed(origin) {
  if (!origin) return false;
  return config.publicOrigin.some((pattern) => {
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return pattern === origin;
    const [prefix, suffix] = pattern.split('*');
    return origin.startsWith(prefix) && origin.endsWith(suffix);
  });
}

function cors(req, res, next) {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (config.publicOrigin.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  next();
}

router.get('/api/public/creators', limit, cors, async (req, res) => {
  try {
    const creators = await c.publicList(Math.min(500, parseInt(req.query.limit, 10) || 200));
    res.json({ count: creators.length, creators });
  } catch (err) {
    console.error('[public]', err.message);
    res.status(500).json({ error: 'error interno' });
  }
});

// Widget de una linea para la web:
//   <div id="ttt-creators"></div>
//   <script src="https://telemetria.tiklivetts.es/embed/creators.js"></script>
router.get('/embed/creators.js', limit, cors, async (req, res) => {
  let creators = [];
  try {
    creators = await c.publicList(200);
  } catch (_) { /* se sirve el widget vacio */ }

  res.type('application/javascript');
  res.send(`(function () {
  var DATA = ${JSON.stringify(creators)};
  var mount = document.getElementById('ttt-creators');
  if (!mount) return;

  var css = document.createElement('style');
  css.textContent = [
    '#ttt-creators{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;font-family:system-ui,sans-serif}',
    '.ttt-c{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border:1px solid rgba(128,128,128,.25);border-radius:12px;text-decoration:none;color:inherit;transition:transform .15s}',
    '.ttt-c:hover{transform:translateY(-2px)}',
    '.ttt-c img{width:56px;height:56px;border-radius:50%;object-fit:cover;background:rgba(128,128,128,.2)}',
    '.ttt-c b{font-size:.85rem;text-align:center;word-break:break-word}',
    '.ttt-c span{font-size:.7rem;opacity:.6;text-transform:uppercase;letter-spacing:.5px}'
  ].join('');
  document.head.appendChild(css);

  DATA.forEach(function (c) {
    var a = document.createElement('a');
    a.className = 'ttt-c';
    a.href = c.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    if (c.avatar) {
      var img = document.createElement('img');
      img.src = c.avatar;
      img.alt = c.display_name;
      img.loading = 'lazy';
      a.appendChild(img);
    }

    var b = document.createElement('b');
    b.textContent = '@' + c.username;
    a.appendChild(b);

    var s = document.createElement('span');
    s.textContent = c.platform;
    a.appendChild(s);

    mount.appendChild(a);
  });
})();`);
});

module.exports = router;
