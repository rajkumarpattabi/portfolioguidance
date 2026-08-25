/* PortfolioGuidance — Cloudflare Worker (Zerodha Kite proxy)
 *
 * Holds your Kite api_secret so it never touches the public app / phone.
 * Routes:
 *   GET /login?k=APP_KEY&redirect=<app url>  -> redirects to Kite login
 *   GET /callback?request_token=...          -> Kite calls this; exchanges token, stores session, redirects back
 *   GET /holdings?k=APP_KEY                   -> returns your live holdings (or {needLogin:true})
 *   GET /quote?k=APP_KEY&i=INFY,TCS           -> live LTP + close for watchlist symbols (NSE)
 *
 * Bindings expected (see wrangler.toml):
 *   KV namespace: SESSION
 *   Vars:    APP_URL (your GitHub Pages app URL), KITE_API_KEY
 *   Secrets: KITE_API_SECRET, APP_KEY   (set with `wrangler secret put ...`)
 */

const KITE = 'https://api.kite.trade';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const origin = allowedOrigin(env);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);

    try {
      if (path === '/login') return handleLogin(url, env);
      if (path === '/callback') return handleCallback(url, env);
      if (path === '/holdings') return cors(await handleHoldings(url, env), origin);
      if (path === '/quote') return cors(await handleQuote(url, env), origin);
      if (path === '/') return cors(json({ ok: true, service: 'portfolioguidance-worker' }), origin);
      return cors(json({ error: 'not_found' }, 404), origin);
    } catch (e) {
      return cors(json({ error: 'worker_error', detail: String(e && e.message || e) }, 500), origin);
    }
  }
};

function allowedOrigin(env) {
  try { return new URL(env.APP_URL).origin; } catch (e) { return '*'; }
}
function cors(res, origin) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin || '*');
  h.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, headers: h });
}
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }

function checkKey(url, env) { return env.APP_KEY && url.searchParams.get('k') === env.APP_KEY; }

async function handleLogin(url, env) {
  if (!checkKey(url, env)) return json({ error: 'unauthorized' }, 401);
  // remember where to send the browser after callback (must be within APP_URL origin)
  let redirect = url.searchParams.get('redirect') || env.APP_URL;
  try { if (new URL(redirect).origin !== allowedOrigin(env)) redirect = env.APP_URL; }
  catch (e) { redirect = env.APP_URL; }
  await env.SESSION.put('pending_redirect', redirect, { expirationTtl: 900 });
  const login = 'https://kite.zerodha.com/connect/login?v=3&api_key=' + encodeURIComponent(env.KITE_API_KEY);
  return Response.redirect(login, 302);
}

async function handleCallback(url, env) {
  const status = url.searchParams.get('status');
  const requestToken = url.searchParams.get('request_token');
  let redirect = (await env.SESSION.get('pending_redirect')) || env.APP_URL;
  if (status !== 'success' || !requestToken) {
    return Response.redirect(redirect + '#error', 302);
  }
  const checksum = await sha256Hex(env.KITE_API_KEY + requestToken + env.KITE_API_SECRET);
  const body = new URLSearchParams({ api_key: env.KITE_API_KEY, request_token: requestToken, checksum });
  const r = await fetch(KITE + '/session/token', {
    method: 'POST',
    headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await r.json();
  if (!r.ok || !data || data.status !== 'success' || !data.data || !data.data.access_token) {
    return Response.redirect(redirect + '#error', 302);
  }
  await env.SESSION.put('session', JSON.stringify({
    access_token: data.data.access_token,
    user: (data.data.user_id || '')
  }), { expirationTtl: secondsToKiteExpiry() });
  await env.SESSION.delete('pending_redirect');
  return Response.redirect(redirect + '#connected', 302);
}

async function handleHoldings(url, env) {
  if (!checkKey(url, env)) return json({ error: 'unauthorized' }, 401);
  const raw = await env.SESSION.get('session');
  if (!raw) return json({ needLogin: true }, 401);
  let sess; try { sess = JSON.parse(raw); } catch (e) { return json({ needLogin: true }, 401); }

  const r = await fetch(KITE + '/portfolio/holdings', {
    headers: { 'X-Kite-Version': '3', 'Authorization': 'token ' + env.KITE_API_KEY + ':' + sess.access_token }
  });
  const data = await r.json();
  if (r.status === 403 || (data && data.error_type === 'TokenException')) {
    await env.SESSION.delete('session');
    return json({ needLogin: true }, 401);
  }
  if (!r.ok || !data || !Array.isArray(data.data)) {
    return json({ error: 'kite_error', detail: (data && data.message) || ('HTTP ' + r.status) }, 502);
  }
  const holdings = data.data.map(h => ({
    symbol: h.tradingsymbol,
    exchange: h.exchange,
    qty: (h.quantity || 0) + (h.t1_quantity || 0),
    avg: h.average_price || 0,
    ltp: h.last_price || 0,
    close: h.close_price || 0
  })).filter(h => h.symbol && h.qty > 0);

  return json({ holdings, user: sess.user, syncedAt: Date.now() });
}

// Live LTP + close for watchlist (non-holding) symbols via Kite quote/ohlc. Assumes NSE.
async function handleQuote(url, env) {
  if (!checkKey(url, env)) return json({ error: 'unauthorized' }, 401);
  const raw = await env.SESSION.get('session');
  if (!raw) return json({ needLogin: true }, 401);
  let sess; try { sess = JSON.parse(raw); } catch (e) { return json({ needLogin: true }, 401); }

  const symsParam = url.searchParams.get('i') || url.searchParams.get('symbols') || '';
  const syms = symsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 200);
  if (!syms.length) return json({ quotes: {} });

  const qs = syms.map(s => 'i=' + encodeURIComponent('NSE:' + s)).join('&');
  const r = await fetch(KITE + '/quote/ohlc?' + qs, {
    headers: { 'X-Kite-Version': '3', 'Authorization': 'token ' + env.KITE_API_KEY + ':' + sess.access_token }
  });
  const data = await r.json();
  if (r.status === 403 || (data && data.error_type === 'TokenException')) {
    await env.SESSION.delete('session');
    return json({ needLogin: true }, 401);
  }
  if (!r.ok || !data || !data.data) {
    return json({ error: 'kite_error', detail: (data && data.message) || ('HTTP ' + r.status) }, 502);
  }
  const quotes = {};
  Object.keys(data.data).forEach(k => {
    const sym = k.split(':')[1] || k;
    const d = data.data[k] || {};
    quotes[sym] = { ltp: d.last_price || 0, close: (d.ohlc && d.ohlc.close) || 0 };
  });
  return json({ quotes, syncedAt: Date.now() });
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Kite access tokens expire at 6:00 AM IST (00:30 UTC) the next day.
function secondsToKiteExpiry() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(0, 30, 0, 0);            // 06:00 IST == 00:30 UTC
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(300, Math.floor((next - now) / 1000));
}
