// Sirve el panel (web/) en local sin Docker ni Postgres; /api va por proxy a
// un backend real. Uso: API_TARGET=https://tu-vps node tools/dev-front.js
// Sin recarga en caliente: F5 tras editar.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TARGET = new URL(process.env.API_TARGET || 'http://localhost:4000');
const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.join(__dirname, '..');
const MOUNTS = [
  ['/vendor/', path.join(ROOT, 'node_modules', 'chart.js', 'dist')],
  ['/vendor/', path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist')],
  ['/', path.join(ROOT, 'web')],
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function proxy(req, res) {
  const lib = TARGET.protocol === 'https:' ? https : http;
  const up = lib.request(new URL(req.url, TARGET), {
    method: req.method,
    headers: { ...req.headers, host: TARGET.host },
  }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}

function serveFile(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const file = path.join(dir, urlPath.slice(prefix.length));
    if (!file.startsWith(dir)) break; // path traversal
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
  }
  // SPA con router por hash: cualquier otra ruta devuelve el shell.
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(ROOT, 'web', 'index.html')).pipe(res);
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/embed/')) return proxy(req, res);
  serveFile(req, res);
}).listen(PORT, () => console.log(`[dev-front] http://localhost:${PORT} → /api en ${TARGET.origin}`));
