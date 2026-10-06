'use strict';

process.env.POSTGRES_URL ||= 'postgres://test@127.0.0.1:1/test';
process.env.ADMIN_USER ||= 'admin';
process.env.ADMIN_PASSWORD ||= 'password-test';
process.env.SESSION_SECRET ||= '0123456789abcdef0123';
process.env.INGEST_TOKEN ||= 'token-test-token';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { download } = require('./avatars');

test('download solo acepta imagenes de tamano razonable', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok.png') { res.setHeader('content-type', 'image/png'); return res.end(Buffer.from([1, 2, 3])); }
    if (req.url === '/page') { res.setHeader('content-type', 'text/html'); return res.end('<html>'); }
    if (req.url === '/big.jpg') { res.setHeader('content-type', 'image/jpeg'); return res.end(Buffer.alloc(600 * 1024)); }
    res.statusCode = 403; res.end(); // URL caducada del CDN
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const ok = await download(`${base}/ok.png`);
  assert.strictEqual(ok.type, 'image/png');
  assert.strictEqual(ok.buf.length, 3);
  assert.strictEqual(await download(`${base}/page`), null);
  assert.strictEqual(await download(`${base}/big.jpg`), null);
  assert.strictEqual(await download(`${base}/expired`), null);
});

test('parseTiktokAvatar saca la foto del HTML del perfil y rechaza otros dominios', () => {
  const { parseTiktokAvatar } = require('./avatars');
  const html = '..."avatarMedium":"https:\u002F\u002Fp16-common-sign.tiktokcdn.com\u002Fabc~tplv.jpeg?x-expires=1"...';
  assert.strictEqual(parseTiktokAvatar(html), 'https://p16-common-sign.tiktokcdn.com/abc~tplv.jpeg?x-expires=1');
  assert.strictEqual(parseTiktokAvatar('"avatarMedium":"https:\u002F\u002Fevil.example.com\u002Fx.jpg"'), null);
  assert.strictEqual(parseTiktokAvatar('<html>captcha</html>'), null);
});
