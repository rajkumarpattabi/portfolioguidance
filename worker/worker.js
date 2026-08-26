/* PortfolioGuidance — Cloudflare Worker (Zerodha Kite proxy)
 *
 * Holds your Kite api_secret so it never touches the public app / phone.
 * Routes:
 *   GET /login?k=APP_KEY&redirect=<app url>  -> redirects to Kite login
 *   GET /callback?request_token=...          -> Kite calls this; exchanges token, stores session, redirects back
 *   GET /holdings?k=APP_KEY                   -> returns your live holdings (or {needLogin:true})
 *   GET /quote?k=APP_KEY&i=INFY,TCS           -> LTP + prev close for watchlist symbols via Yahoo (no Kite session)
 *   GET /fundamentals?k=APP_KEY&i=INFY,TCS    -> per-stock fundamentals (Yahoo technicals + Screener ratios), daily-cached
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
      if (path === '/fundamentals') return cors(await handleFundamentals(url, env), origin);
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

// Live LTP + previous close for watchlist symbols via Yahoo Finance (NSE = <sym>.NS).
// Deliberately does NOT touch the Kite session — Kite's quote/OHLC needs the paid
// Market-Data plan (403 PermissionException on the free Personal tier), and Yahoo is
// free + works without a Kite login. Prices are ~15 min delayed, fine for watch targets.
async function handleQuote(url, env) {
  if (!checkKey(url, env)) return json({ error: 'unauthorized' }, 401);
  const symsParam = url.searchParams.get('i') || url.searchParams.get('symbols') || '';
  const syms = symsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
  if (!syms.length) return json({ quotes: {} });

  const quotes = {};
  await Promise.all(syms.map(async (sym) => {
    try {
      const yq = sym.indexOf('.') >= 0 ? sym : (sym + '.NS');
      const y = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yq) + '?interval=1d&range=1d',
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      if (!y.ok) return;
      const d = await y.json();
      const m = d && d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta;
      if (m && m.regularMarketPrice != null) {
        quotes[sym] = { ltp: m.regularMarketPrice, close: (m.chartPreviousClose != null ? m.chartPreviousClose : (m.previousClose || 0)) };
      }
    } catch (e) { /* skip this symbol; others still return */ }
  }));
  return json({ quotes, syncedAt: Date.now(), source: 'yahoo' });
}

// Per-stock fundamentals: Yahoo (technicals) + Screener (valuation/quality ratios), cached daily in KV.
async function handleFundamentals(url, env) {
  if (!checkKey(url, env)) return json({ error: 'unauthorized' }, 401);
  const symsParam = url.searchParams.get('i') || url.searchParams.get('symbols') || '';
  const syms = symsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 60);
  if (!syms.length) return json({ fundamentals: {} });
  const today = utcDateStr();
  const out = {};

  await Promise.all(syms.map(async (sym) => {
    const cacheKey = 'f:' + sym + ':' + today;
    try { const c = await env.SESSION.get(cacheKey); if (c) { out[sym] = JSON.parse(c); return; } } catch (e) {}

    const f = { asOf: today };
    // --- Yahoo 1y chart → ONLY the moving averages (Screener doesn't expose these cleanly).
    //     Also keep the last close as a price fallback for symbols not on Screener. ---
    try {
      const yq = sym.indexOf('.') >= 0 ? sym : (sym + '.NS');
      const y = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yq) + '?interval=1d&range=1y',
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      if (y.ok) {
        const d = await y.json();
        const res = d && d.chart && d.chart.result && d.chart.result[0];
        const q = res && res.indicators && res.indicators.quote && res.indicators.quote[0];
        const closes = (q && q.close) ? q.close.filter(x => x != null) : [];
        if (closes.length) {
          f.sma50 = sma(closes, 50);
          f.sma200 = sma(closes, 200);
          f.price = closes[closes.length - 1];   // fallback only; app prefers Kite LTP / Screener price
        }
      }
    } catch (e) {}

    // --- Screener → valuation/quality ratios + 52-wk H/L + current price (preferred). ---
    try {
      const s = await fetch('https://www.screener.in/company/' + encodeURIComponent(sym) + '/',
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } });
      if (s.ok) {
        const html = await s.text();
        f.pe = ratio(html, 'Stock P/E');
        f.bookValue = ratio(html, 'Book Value');
        f.marketCap = ratio(html, 'Market Cap');   // in ₹ crore
        f.divYield = ratio(html, 'Dividend Yield');
        f.roce = ratio(html, 'ROCE');
        f.roe = ratio(html, 'ROE');
        const hl = ratio2(html, 'High / Low');     // 52-wk high / low
        if (hl) { f.wk52High = hl[0]; f.wk52Low = hl[1]; }
        const sp = ratio(html, 'Current Price');
        if (sp != null) f.price = sp;              // Screener price preferred over Yahoo fallback
        // Valuation ratios are computed against Screener's price so PE/P&B/EPS reconcile.
        if (f.price != null && f.bookValue) f.pb = round2(f.price / f.bookValue);
        if (f.price != null && f.pe) f.eps = round2(f.price / f.pe);
        // Shareholding (quarterly) → promoter / FII / DII: latest % + QoQ + YoY (piggybacks this same fetch).
        const sec = shSection(html);
        if (sec) {
          const qs = shQuarters(sec);
          const packSh = function (arr) {
            if (!arr || !arr.length) return null;
            const n = arr.length;
            return { now: arr[n - 1], qoq: n >= 2 ? round2(arr[n - 1] - arr[n - 2]) : null, yoy: n >= 5 ? round2(arr[n - 1] - arr[n - 5]) : null };
          };
          f.shareholding = { promoter: packSh(shRow(sec, 'Promoters')), fii: packSh(shRow(sec, 'FIIs')), dii: packSh(shRow(sec, 'DIIs')) };
          if (qs.length) f.shAsOf = qs[qs.length - 1];
        }
      }
    } catch (e) {}

    out[sym] = f;
    try { await env.SESSION.put(cacheKey, JSON.stringify(f), { expirationTtl: 90000 }); } catch (e) {}
  }));

  return json({ fundamentals: out, syncedAt: Date.now() });
}
function sma(arr, n) { if (arr.length < n) n = arr.length; if (!n) return null; let s = 0; for (let i = arr.length - n; i < arr.length; i++) s += arr[i]; return Math.round((s / n) * 100) / 100; }
function round2(n) { return Math.round(n * 100) / 100; }
function utcDateStr() { const d = new Date(); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
// Screener top-ratios parser: locate the label, then the first number that follows.
function ratio(html, label) {
  let i = html.indexOf('>' + label + '<');
  if (i < 0) i = html.indexOf(label);
  if (i < 0) return null;
  const seg = html.slice(i, i + 400);
  const m = seg.match(/class="number"[^>]*>\s*([-\d.,]+)/) || seg.match(/>\s*([-\d][\d.,]*)\s*</);
  return m ? numOf(m[1]) : null;
}
function numOf(s) { if (s == null) return null; const v = parseFloat(String(s).replace(/,/g, '')); return isFinite(v) ? v : null; }
// --- Screener shareholding (quarterly table) parsers ---
function shSection(html) {
  const i = html.indexOf('id="shareholding"');
  return i < 0 ? '' : html.slice(i, i + 20000);   // covers the quarterly table (yearly table follows; we read the first/quarterly one)
}
function shQuarters(sec) {
  const thead = sec.match(/<thead[\s\S]*?<\/thead>/);
  if (!thead) return [];
  const ths = thead[0].match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [];
  return ths.map(t => t.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()).filter(Boolean);
}
function shRow(sec, label) {
  const rows = sec.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (let r = 0; r < rows.length; r++) {
    const text = rows[r].replace(/<[^>]*>/g, ' ');
    if (new RegExp('(^|\\s)' + label + '(\\s|\\+|<)').test(text)) {
      const cells = rows[r].match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
      const nums = [];
      cells.forEach(c => { const t = c.replace(/<[^>]*>/g, '').replace(/,/g, '').trim(); const v = parseFloat(t); if (isFinite(v)) nums.push(v); });
      if (nums.length) return nums;
    }
  }
  return [];
}
// Two numbers after a label (e.g. "High / Low" → [high, low]).
function ratio2(html, label) {
  let i = html.indexOf('>' + label + '<');
  if (i < 0) i = html.indexOf(label);
  if (i < 0) return null;
  const seg = html.slice(i, i + 400);
  const nums = []; const re = /class="number"[^>]*>\s*([-\d.,]+)/g; let m;
  while ((m = re.exec(seg)) && nums.length < 2) nums.push(numOf(m[1]));
  return nums.length >= 2 ? nums : null;
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
