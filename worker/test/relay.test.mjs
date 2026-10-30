// Local end-to-end test against `wrangler dev` (http://127.0.0.1:8787) with .dev.vars DEV_INSECURE_WEBHOOK=yes.
// A mock "bot webhook" on 127.0.0.1:9911 checks the Authorization header and posts a reply back.
import http from 'node:http';
import crypto from 'node:crypto';
const R = process.env.RELAY || 'http://127.0.0.1:8787';
const PAGES = 'https://seoguypt.github.io';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const rid = n => crypto.randomBytes(n).toString('base64url');
let got = null, botStatus = 200;
const bot = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', async () => {
    got = { auth: req.headers.authorization, body: JSON.parse(b) };
    res.writeHead(botStatus); res.end('{}');
    if (botStatus === 200) {
      // simulate the routine replying a bit later
      setTimeout(async () => {
        const r = await fetch(got.body.replyUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Reply-Token': got.body.replyToken }, body: 'Hole 1 · 142 m midden\n7-ijzer, mik op het midden; bunker links carry 128.' });
        got.replyStatus = r.status;
      }, 500);
    }
  });
}).listen(9911, '127.0.0.1');
const hook = 'http://127.0.0.1:9911/hook';
const post = (p, body, h = {}) => fetch(R + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Origin: PAGES }, h), body: typeof body === 'string' ? body : JSON.stringify(body) });

// CORS
let r = await fetch(R + '/ask', { method: 'OPTIONS', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
ok(r.status === 204 && r.headers.get('access-control-allow-origin') === PAGES, 'preflight from Pages origin');
r = await fetch(R + '/reply/x', { method: 'OPTIONS', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-reply-token' } });
ok((r.headers.get('access-control-allow-headers') || '').includes('X-Reply-Token'), 'preflight allows X-Reply-Token');
r = await fetch(R + '/', { headers: { Origin: 'https://evil.example' } });
ok(!r.headers.get('access-control-allow-origin'), 'no ACAO for other origin');

const session = rid(18), token = rid(24);
const base = { session, replyToken: token, course: 'la-finca', hole: 1, lat: 38.0577546, lon: -0.7944177, accuracy: 6.4, question: 'Welke club?', webhookUrl: hook, authHeader: 'Authorization: Bearer SECRET-KEY-123' };

// validation
for (const [k, v, m] of [['webhookUrl', 'http://example.com/x', 'http refused'], ['webhookUrl', 'https://10.0.0.1/x', 'IP refused'], ['webhookUrl', 'https://localhost/x', 'localhost refused'],
  ['course', 'augusta', 'bad course'], ['hole', 19, 'bad hole'], ['lat', 'abc', 'bad lat'], ['session', 'short', 'bad session'], ['authHeader', 'a\r\nX: y', 'header injection']]) {
  r = await post('/ask', Object.assign({}, base, { [k]: v })); ok(r.status === 400, m + ' -> ' + r.status);
}
r = await post('/ask', 'x'.repeat(7000)); ok(r.status === 413, 'size limit');

// happy path
const t0 = Date.now();
r = await post('/ask', base);
ok(r.status === 202 && r.headers.get('access-control-allow-origin') === PAGES, 'ask 202 with CORS: ' + r.status);
await new Promise(s => setTimeout(s, 300));
ok(got && got.auth === 'Bearer SECRET-KEY-123', 'auth header forwarded (prefix stripped)');
ok(got && !('webhookUrl' in got.body) && !('authHeader' in got.body), 'url/key not forwarded in body');
ok(got && got.body.replyUrl === R + '/reply/' + session && got.body.replyToken === token && got.body.hole === 1 && got.body.question === 'Welke club?', 'forwarded fields');

// poll like the page
let reply = null;
for (let i = 0; i < 20 && !reply; i++) {
  const g = await fetch(`${R}/reply/${session}?since=${t0}`, { headers: { Origin: PAGES, 'X-Reply-Token': token } });
  if (g.status === 200) reply = await g.json(); else await new Promise(s => setTimeout(s, 300));
}
ok(got.replyStatus === 200, 'bot reply POST 200');
ok(reply && reply.reply.startsWith('Hole 1') && reply.reply.includes('7-ijzer'), 'page receives reply');
r = await fetch(`${R}/reply/${session}?since=${reply.at}`, { headers: { Origin: PAGES, 'X-Reply-Token': token } }); ok(r.status === 204, 'since filter -> 204');
r = await fetch(`${R}/reply/${session}`, { headers: { 'X-Reply-Token': rid(24) } }); ok(r.status === 403, 'GET wrong token 403');
r = await fetch(`${R}/reply/${session}`, { method: 'POST', headers: { 'X-Reply-Token': rid(24) }, body: 'spoof' }); ok(r.status === 403, 'POST wrong token 403');
r = await fetch(`${R}/reply/${rid(18)}`, { method: 'POST', headers: { 'X-Reply-Token': token }, body: 'x' }); ok(r.status === 403, 'unknown session 403');
r = await fetch(`${R}/reply/${session}`, { method: 'POST', headers: { 'X-Reply-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: 'JSON-antwoord' }) });
ok(r.status === 200, 'JSON reply accepted');

// session hijack + per-session gap
r = await post('/ask', Object.assign({}, base, { replyToken: rid(24) })); ok(r.status === 409, 'other token for live session -> 409: ' + r.status);
r = await post('/ask', base); ok(r.status === 429, 'too fast -> 429: ' + r.status);

// upstream refusal surfaces as 502
botStatus = 401; await new Promise(s => setTimeout(s, 4100));
r = await post('/ask', Object.assign({}, base, { session: rid(18), replyToken: rid(24) })); const j = await r.json();
ok(r.status === 502 && j.upstreamStatus === 401, 'webhook 401 -> 502 with upstreamStatus');

bot.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
