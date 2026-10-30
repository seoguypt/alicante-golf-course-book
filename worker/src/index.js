// Caddie relay: a bot-agnostic two-way relay between the Golf GPS page and a player's own
// Grok Bot webhook routine. The Worker never stores a webhook URL or key: the page sends them
// with each request, the Worker forwards once and forgets them. Replies come back per session,
// protected by a reply token whose SHA-256 hash is the only thing kept (2 h TTL).
//
// Routes
//   POST /ask                 {session, replyToken, course, hole, lat, lon, accuracy, question?, test?, carries?, rollPct?, webhookUrl, authHeader}
//                             -> forwards {session, course, hole, lat, lon, accuracy, question, test, carries?, rollPct?, replyUrl, replyToken}
//                                to webhookUrl with Authorization: authHeader, returns 202
//   POST /reply/<session>     header X-Reply-Token; body text/plain (or JSON {"reply": "..."}) -> stores reply
//   GET  /reply/<session>     header X-Reply-Token; ?since=<ms> -> 200 {reply, at} or 204
//   GET  /                    health

const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{24,128}$/;
const COURSES = new Set(['la-finca', 'las-ramblas', 'las-colinas']);
const TTL = 2 * 60 * 60;             // seconds kept in KV
const MAX_ASK_BYTES = 6 * 1024;
const MAX_REPLY_CHARS = 4000;
const ASK_PER_MIN_PER_IP = 12;
const ASK_MIN_GAP_MS = 4000;         // per session

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || 'https://seoguypt.github.io').split(',').map(s => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Reply-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(req, env, status, obj, extra) {
  return new Response(obj === null ? null : JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, corsHeaders(req, env), extra || {}),
  });
}

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Webhook target check. ALLOWED_WEBHOOK_HOSTS = comma list of hosts; "*.example.com" matches subdomains.
// Empty/unset = any public https host (no IP literals, no localhost, no .local/.internal, port 443 only).
function checkWebhookUrl(raw, env) {
  let u;
  try { u = new URL(raw); } catch (e) { return 'webhookUrl is not a URL'; }
  // Local testing only (set in a gitignored .dev.vars, never in wrangler.toml): allow http://127.0.0.1:<port>.
  if (env.DEV_INSECURE_WEBHOOK === 'yes' && u.protocol === 'http:' && u.hostname === '127.0.0.1') return null;
  if (u.protocol !== 'https:') return 'webhookUrl must be https';
  if (u.username || u.password) return 'webhookUrl must not contain credentials';
  if (u.port && u.port !== '443') return 'webhookUrl must use port 443';
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return 'webhookUrl must use a hostname';
  if (host === 'localhost' || /\.(local|localhost|internal|lan|home|arpa)$/.test(host) || !host.includes('.')) return 'webhookUrl host not allowed';
  const list = (env.ALLOWED_WEBHOOK_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length && !list.some(p => p.startsWith('*.') ? (host.endsWith(p.slice(1)) || host === p.slice(2)) : host === p)) return 'webhookUrl host not allowed';
  return null;
}

function cleanAuth(v) {
  if (typeof v !== 'string') return null;
  v = v.trim().replace(/^authorization\s*:\s*/i, '');
  if (!v || v.length > 2048 || /[\r\n\0]/.test(v)) return null;
  return v;
}

async function rateLimit(env, key, limit, windowSec) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  const n = parseInt((await env.RELAY.get(k)) || '0', 10);
  if (n >= limit) return false;
  await env.RELAY.put(k, String(n + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  return true;
}

async function checkToken(env, session, token) {
  if (!TOKEN_RE.test(token || '')) return false;
  const stored = await env.RELAY.get(`tok:${session}`);
  return !!stored && timingSafeEq(stored, await sha256(token));
}

// Player's own club carries (metres), e.g. {"D":230,"7i":157}. Optional. Unknown clubs or odd values are
// dropped; a non-object or more than 16 entries is refused. Returns null (absent), false (refuse) or a clean object.
const CLUB_KEYS = new Set(['D', '2W', '3W', '4W', '5W', '7W', '9W', 'FW', '2H', '3H', '4H', '5H', '6H', '7H', 'H', '2i', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'AW', 'SW', 'LW']);
function cleanCarries(c) {
  if (c === undefined || c === null) return null;
  if (typeof c !== 'object' || Array.isArray(c)) return false;
  const keys = Object.keys(c);
  if (keys.length > 16) return false;
  const out = {};
  for (const k of keys) {
    const v = Number(c[k]);
    if (CLUB_KEYS.has(k) && Number.isInteger(v) && v >= 20 && v <= 350) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

async function handleAsk(req, env, ctx) {
  const len = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (len > MAX_ASK_BYTES) return json(req, env, 413, { error: 'too large' });
  const raw = await req.text();
  if (raw.length > MAX_ASK_BYTES) return json(req, env, 413, { error: 'too large' });
  let b;
  try { b = JSON.parse(raw); } catch (e) { return json(req, env, 400, { error: 'invalid JSON' }); }
  if (!b || typeof b !== 'object') return json(req, env, 400, { error: 'invalid body' });

  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (!(await rateLimit(env, `ip:${ip}`, ASK_PER_MIN_PER_IP, 60))) return json(req, env, 429, { error: 'too many requests' });

  const session = String(b.session || ''), token = String(b.replyToken || '');
  if (!SESSION_RE.test(session)) return json(req, env, 400, { error: 'bad session' });
  if (!TOKEN_RE.test(token)) return json(req, env, 400, { error: 'bad replyToken' });
  const course = String(b.course || '');
  if (!COURSES.has(course)) return json(req, env, 400, { error: 'bad course' });
  const hole = Number(b.hole), lat = Number(b.lat), lon = Number(b.lon), acc = Number(b.accuracy);
  if (!Number.isInteger(hole) || hole < 1 || hole > 18) return json(req, env, 400, { error: 'bad hole' });
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) return json(req, env, 400, { error: 'bad lat/lon' });
  const question = typeof b.question === 'string' ? b.question.slice(0, 300) : '';
  const carries = cleanCarries(b.carries);
  if (carries === false) return json(req, env, 400, { error: 'bad carries' });
  const rollPct = Number(b.rollPct);
  const auth = cleanAuth(b.authHeader);
  if (!auth) return json(req, env, 400, { error: 'bad authHeader' });
  const urlErr = checkWebhookUrl(String(b.webhookUrl || ''), env);
  if (urlErr) return json(req, env, 400, { error: urlErr });

  // Bind the session to the first token seen; a different token for a live session is refused.
  const h = await sha256(token);
  const prev = await env.RELAY.get(`tok:${session}`);
  if (prev && !timingSafeEq(prev, h)) return json(req, env, 409, { error: 'session token mismatch' });
  const last = parseInt((await env.RELAY.get(`last:${session}`)) || '0', 10);
  if (Date.now() - last < ASK_MIN_GAP_MS) return json(req, env, 429, { error: 'wait a few seconds' });
  await env.RELAY.put(`tok:${session}`, h, { expirationTtl: TTL });
  await env.RELAY.put(`last:${session}`, String(Date.now()), { expirationTtl: 60 });

  const origin = new URL(req.url).origin;
  const fwd = {
    session, course, hole,
    lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6,
    accuracy: Number.isFinite(acc) ? Math.round(acc) : null,
    question,
    test: b.test === true,
    ...(carries ? { carries } : {}),
    ...(carries && Number.isFinite(rollPct) && rollPct >= 0 && rollPct <= 30 ? { rollPct: Math.round(rollPct * 10) / 10 } : {}),
    replyUrl: `${origin}/reply/${session}`,
    replyToken: token,
  };
  let status = 0, ok = false;
  try {
    const r = await fetch(String(b.webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'User-Agent': 'golf-caddie-relay/1' },
      body: JSON.stringify(fwd),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    status = r.status; ok = r.ok;
    try { await r.body?.cancel(); } catch (e) {}
  } catch (e) {
    return json(req, env, 502, { error: 'webhook unreachable' });
  }
  if (!ok) return json(req, env, 502, { error: 'webhook refused', upstreamStatus: status });
  return json(req, env, 202, { ok: true, upstreamStatus: status, session });
}

async function handleReplyPost(req, env, session) {
  if (!(await checkToken(env, session, req.headers.get('X-Reply-Token')))) return json(req, env, 403, { error: 'bad token' });
  const raw = await req.text();
  if (raw.length > MAX_REPLY_CHARS * 4) return json(req, env, 413, { error: 'too large' });
  let text = raw;
  if ((req.headers.get('Content-Type') || '').includes('application/json')) {
    try { const j = JSON.parse(raw); text = typeof j === 'string' ? j : String(j.reply ?? j.text ?? ''); } catch (e) { return json(req, env, 400, { error: 'invalid JSON' }); }
  }
  text = text.replace(/\0/g, '').trim().slice(0, MAX_REPLY_CHARS);
  if (!text) return json(req, env, 400, { error: 'empty reply' });
  const at = Date.now();
  await env.RELAY.put(`rep:${session}`, JSON.stringify({ reply: text, at }), { expirationTtl: TTL });
  return json(req, env, 200, { ok: true, at });
}

async function handleReplyGet(req, env, session) {
  if (!(await checkToken(env, session, req.headers.get('X-Reply-Token')))) return json(req, env, 403, { error: 'bad token' });
  const since = parseInt(new URL(req.url).searchParams.get('since') || '0', 10) || 0;
  const v = await env.RELAY.get(`rep:${session}`);
  if (!v) return json(req, env, 204, null);
  const r = JSON.parse(v);
  if (r.at <= since) return json(req, env, 204, null);
  return json(req, env, 200, r);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    try {
      if (url.pathname === '/' && req.method === 'GET') return json(req, env, 200, { ok: true, service: 'golf-caddie-relay' });
      if (url.pathname === '/ask' && req.method === 'POST') return await handleAsk(req, env, ctx);
      const m = url.pathname.match(/^\/reply\/([^/]+)$/);
      if (m) {
        const session = m[1];
        if (!SESSION_RE.test(session)) return json(req, env, 400, { error: 'bad session' });
        if (req.method === 'POST') return await handleReplyPost(req, env, session);
        if (req.method === 'GET') return await handleReplyGet(req, env, session);
      }
      return json(req, env, 404, { error: 'not found' });
    } catch (e) {
      return json(req, env, 500, { error: 'internal error' });
    }
  },
};
