/* PortfolioGuidance — app logic
 * Static PWA. Holdings live only in this device's localStorage.
 * Live data is pulled from Zerodha via your Cloudflare Worker (config.js WORKER_URL);
 * your API secret stays in the Worker, never here.
 */
(function () {
  'use strict';

  // ---------- config / storage ----------
  var CFG = window.PG_CONFIG || {};
  var WORKER = (CFG.WORKER_URL || '').replace(/\/+$/, '');
  var SEC = window.PG_SECTORS || { LIST: ['Unclassified'], MAP: {} };

  var K = {
    holdings: 'PG_HOLDINGS',
    overrides: 'PG_SECTOR_OVERRIDES',
    meta: 'PG_META',
    appkey: 'PG_APPKEY'
  };

  var state = {
    holdings: load(K.holdings, []),          // [{symbol, qty, avg, ltp, close, exchange}]
    overrides: load(K.overrides, {}),        // {symbol: sector}
    meta: load(K.meta, { lastSync: 0, source: '' }),
    view: 'dash',
    holdSort: 'value',
    holdDir: 'desc',
    calcMode: 'down',
    trimMode: 'value',
    calcSym: null,
    expanded: {}
  };

  function load(k, dflt) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; }
    catch (e) { return dflt; }
  }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- helpers ----------
  var inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(n) { return '₹' + inr0.format(Math.round(n || 0)); }
  function money2(n) { return '₹' + inr2.format(n || 0); }
  function signMoney(n) { return (n >= 0 ? '+' : '−') + '₹' + inr0.format(Math.abs(Math.round(n || 0))); }
  function pct(n) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function el(id) { return document.getElementById(id); }

  function sectorOf(sym) { return state.overrides[sym] || SEC.MAP[sym] || 'Unclassified'; }

  // stable colour per sector (index into palette by position in LIST)
  var PALETTE = ['#34c789', '#4da3ff', '#f5c542', '#a78bfa', '#f472b6', '#22d3ee',
    '#fb923c', '#a3e635', '#e879f9', '#60a5fa', '#facc15', '#2dd4bf',
    '#f87171', '#c084fc', '#4ade80', '#38bdf8', '#fbbf24', '#818cf8',
    '#fca5a5', '#5eead4', '#fdba74', '#93c5fd', '#d8b4fe', '#6ee7b7', '#fde68a'];
  function sectorColor(name) {
    var i = SEC.LIST.indexOf(name);
    if (i < 0) i = SEC.LIST.length - 1;
    if (name === 'Unclassified') return '#6b7280';
    return PALETTE[i % PALETTE.length];
  }

  // ---------- derived ----------
  function enrich(h) {
    var value = h.qty * h.ltp;
    var invested = h.qty * h.avg;
    var pnl = value - invested;
    var day = (h.close ? (h.ltp - h.close) * h.qty : 0);
    var dayPct = h.close ? (h.ltp - h.close) / h.close * 100 : 0;
    return { value: value, invested: invested, pnl: pnl, day: day,
             pnlPct: invested ? pnl / invested * 100 : 0, dayPct: dayPct };
  }
  function totals() {
    var t = { value: 0, invested: 0, pnl: 0, day: 0 };
    state.holdings.forEach(function (h) {
      var e = enrich(h);
      t.value += e.value; t.invested += e.invested; t.pnl += e.pnl; t.day += e.day;
    });
    t.pnlPct = t.invested ? t.pnl / t.invested * 100 : 0;
    t.dayPct = (t.value - t.day) ? t.day / (t.value - t.day) * 100 : 0;
    return t;
  }
  function bySector() {
    var m = {};
    state.holdings.forEach(function (h) {
      var s = sectorOf(h.symbol); var v = h.qty * h.ltp;
      m[s] = (m[s] || 0) + v;
    });
    return Object.keys(m).map(function (s) { return { sector: s, value: m[s] }; })
      .sort(function (a, b) { return b.value - a.value; });
  }

  // ---------- rendering ----------
  function render() {
    renderSummary();
    renderDash();
    renderHoldings();
    renderCalcStocks();
    renderSettings();
  }

  function renderSummary() {
    var t = totals();
    var bar = el('summaryBar');
    if (!state.holdings.length) { bar.innerHTML = ''; return; }
    var pnlCls = t.pnl >= 0 ? 'up' : 'down';
    var dayCls = t.day >= 0 ? 'up' : 'down';
    bar.innerHTML =
      '<div class="sm-item"><span class="sm-k">Value</span><span class="sm-v">' + money(t.value) + '</span></div>' +
      '<div class="sm-item"><span class="sm-k">Invested</span><span class="sm-v">' + money(t.invested) + '</span></div>' +
      '<div class="sm-item"><span class="sm-k">P&amp;L</span><span class="sm-v ' + pnlCls + '">' + signMoney(t.pnl) + ' <em>[' + pct(t.pnlPct) + ']</em></span></div>' +
      '<div class="sm-item"><span class="sm-k">Day</span><span class="sm-v ' + dayCls + '">' + signMoney(t.day) + ' <em>(' + pct(t.dayPct) + ')</em></span></div>';
  }

  function renderDash() {
    var has = state.holdings.length > 0;
    el('dashEmpty').hidden = has;
    var t = totals();
    el('donutTotal').textContent = has ? money(t.value) : '—';
    var pe = el('donutPnl'), pc = el('donutPct');
    if (has) {
      var c = 'dc-sub ' + (t.pnl >= 0 ? 'up' : 'down');
      pe.textContent = signMoney(t.pnl); pe.className = c;
      if (pc) { pc.textContent = pct(t.pnlPct); pc.className = 'dc-pct ' + (t.pnl >= 0 ? 'up' : 'down'); }
    } else { pe.textContent = ''; if (pc) pc.textContent = ''; }

    drawDonut(bySector(), t.value);
    renderAlloc(t.value);
  }

  var allocSegs = [];
  function renderAlloc(total) {
    var list = el('allocList');
    if (!state.holdings.length) { list.innerHTML = ''; allocSegs = []; return; }
    allocSegs = bySector();
    list.innerHTML = allocSegs.map(function (s, i) {
      var p = total ? s.value / total * 100 : 0;
      var open = !!state.expanded[s.sector];
      var stocks = holdingsInSector(s.sector).map(function (h) {
        var w = total ? h.value / total * 100 : 0;
        return '<div class="sec-stock"><span class="ss-sym">' + esc(h.symbol) + '</span>' +
          '<span class="ss-wt">' + w.toFixed(1) + '%</span></div>';
      }).join('');
      return '<div class="sec-card' + (open ? ' open' : '') + '">' +
        '<button class="sec-head" type="button" onclick="PG.toggleSector(' + i + ')">' +
          '<span class="alloc-dot" style="background:' + sectorColor(s.sector) + '"></span>' +
          '<span class="sh-name">' + esc(s.sector) + '</span>' +
          '<span class="sh-pct">' + p.toFixed(1) + '%</span>' +
          '<span class="sh-caret">▾</span>' +
        '</button>' +
        '<div class="sec-stocks"' + (open ? '' : ' hidden') + '>' + stocks + '</div>' +
      '</div>';
    }).join('');
  }

  function holdingsInSector(sec) {
    return state.holdings.filter(function (h) { return sectorOf(h.symbol) === sec; })
      .map(function (h) { return Object.assign({}, h, enrich(h)); })
      .sort(function (a, b) { return b.value - a.value; });
  }

  function toggleSector(i) {
    var s = allocSegs[i]; if (!s) return;
    state.expanded[s.sector] = !state.expanded[s.sector];
    renderAlloc(totals().value);
  }

  function drawDonut(segs, total) {
    var c = el('donut'); if (!c) return;
    var dpr = window.devicePixelRatio || 1;
    var CSS = 220; // css px
    c.style.width = CSS + 'px'; c.style.height = CSS + 'px';
    c.width = CSS * dpr; c.height = CSS * dpr;
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CSS, CSS);
    var cx = CSS / 2, cy = CSS / 2, R = CSS / 2 - 6, r = R * 0.62;
    if (!segs.length || !total) {
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      ctx.fillStyle = '#1c2029'; ctx.fill('evenodd'); return;
    }
    var a = -Math.PI / 2;
    segs.forEach(function (s) {
      var frac = s.value / total; var a2 = a + frac * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a, a2); ctx.closePath();
      ctx.fillStyle = sectorColor(s.sector); ctx.fill();
      a = a2;
    });
    // punch hole
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function updateSortArrows() {
    var btns = document.querySelectorAll('#holdSort .seg-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], active = b.getAttribute('data-sort') === state.holdSort;
      b.classList.toggle('active', active);
      var ar = b.querySelector('.sarrow');
      if (ar) ar.textContent = active ? (state.holdDir === 'desc' ? ' ↓' : ' ↑') : '';
    }
  }

  function renderHoldings() {
    var wrap = el('holdList'); var has = state.holdings.length > 0;
    el('holdEmpty').hidden = has;
    el('holdCount').textContent = has ? '(' + state.holdings.length + ')' : '';
    var arr = state.holdings.map(function (h) { return Object.assign({}, h, enrich(h)); });
    var so = state.holdSort, dir = (state.holdDir === 'asc' ? 1 : -1), cmp;
    if (so === 'alpha') cmp = function (a, b) { return a.symbol < b.symbol ? -1 : (a.symbol > b.symbol ? 1 : 0); };
    else cmp = function (a, b) { return (a[so] || 0) - (b[so] || 0); };
    arr.sort(function (a, b) { return dir * cmp(a, b); });
    updateSortArrows();

    wrap.innerHTML = arr.map(function (h) {
      var sec = sectorOf(h.symbol);
      var cls = h.pnl >= 0 ? 'up' : 'down';
      return '<div class="hold">' +
        '<div class="hold-l">' +
          '<div class="hold-top">' +
            '<span class="hold-sym">' + esc(h.symbol) + '</span>' +
            '<span class="hold-sec" style="color:' + sectorColor(sec) + '" onclick="PG.openSectorSheet(\'' + esc(h.symbol) + '\')">' + esc(sec) + ' ✎</span>' +
          '</div>' +
          '<div class="hold-meta">' + h.qty + ' × ' + money2(h.avg) + '  ·  LTP ' + money2(h.ltp) + '</div>' +
        '</div>' +
        '<div class="hold-r">' +
          '<div class="hold-val">' + money(h.value) + '</div>' +
          '<div class="hold-pnl ' + cls + '">' + signMoney(h.pnl) + ' <em>[' + pct(h.pnlPct) + ']</em></div>' +
          '<div class="hold-day"><span class="dl">Day</span> <span class="' + (h.day >= 0 ? 'up' : 'down') + '">' + signMoney(h.day) + ' <em>(' + pct(h.dayPct) + ')</em></span></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ---------- calculator ----------
  function renderCalcStocks() {
    var sel = el('calcStock');
    var opts = '<option value="">— manual entry —</option>' +
      state.holdings.slice().sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; })
        .map(function (h) { return '<option value="' + esc(h.symbol) + '">' + esc(h.symbol) + '</option>'; }).join('');
    sel.innerHTML = opts;
    if (state.calcSym) sel.value = state.calcSym;
  }
  function calcPickStock(sym) {
    state.calcSym = sym;
    var h = state.holdings.find(function (x) { return x.symbol === sym; });
    if (h) { el('calcQty').value = h.qty; el('calcAvg').value = h.avg; el('calcLtp').value = h.ltp; }
    calc();
  }
  function num(id) { var v = parseFloat(el(id).value); return isFinite(v) ? v : NaN; }

  function calc() {
    if (state.calcMode === 'down') calcDown(); else calcTrim();
  }

  function calcDown() {
    var out = el('downResult');
    var qty = num('calcQty'), avg = num('calcAvg'), ltp = num('calcLtp'), T = num('targetAvg');
    if (!isFinite(qty) || !isFinite(avg) || !isFinite(ltp)) { out.innerHTML = hint('Enter quantity, average and market price.'); return; }
    if (!isFinite(T)) { out.innerHTML = hint('Enter a target average to see how many shares to buy.'); return; }
    var lo = Math.min(avg, ltp), hi = Math.max(avg, ltp);
    if (T <= lo || T >= hi) {
      out.innerHTML = warn('Target must be strictly between the market price (' + money2(ltp) + ') and your current average (' + money2(avg) + '). You can only move your average toward the price you buy at.');
      return;
    }
    var x = qty * (T - avg) / (ltp - T);
    var shares = Math.ceil(x - 1e-9);
    if (shares < 1) shares = 1;
    var newQty = qty + shares;
    var newAvg = (qty * avg + shares * ltp) / newQty;
    var cost = shares * ltp;
    var dir = avg > ltp ? 'lower' : 'raise';
    out.innerHTML =
      big('Buy ' + inr0.format(shares) + ' shares', 'at ' + money2(ltp) + ' to ' + dir + ' your average to ≈ ' + money2(newAvg)) +
      kv([
        ['Capital required', money(cost)],
        ['New quantity', inr0.format(newQty)],
        ['New average cost', money2(newAvg)],
        ['New invested', money(qty * avg + cost)]
      ]);
  }

  function trimInputHtml() {
    if (state.trimMode === 'value') return fld('trimVal', 'Target remaining value (₹)', 'e.g. 50000');
    if (state.trimMode === 'qty') return fld('trimVal', 'Target remaining quantity', 'e.g. 20');
    return fld('trimVal', 'Profit to book now (₹)', 'e.g. 10000');
  }
  function calcTrim() {
    var wrap = el('trimInputWrap');
    if (wrap.getAttribute('data-mode') !== state.trimMode) {
      wrap.setAttribute('data-mode', state.trimMode);
      wrap.innerHTML = trimInputHtml();
      el('trimVal').addEventListener('input', calcTrim);
    }
    var out = el('trimResult');
    var qty = num('calcQty'), avg = num('calcAvg'), ltp = num('calcLtp'), v = num('trimVal');
    if (!isFinite(qty) || !isFinite(avg) || !isFinite(ltp)) { out.innerHTML = hint('Enter quantity, average and market price.'); return; }
    if (!isFinite(v)) { out.innerHTML = hint('Enter a target to compute how many shares to sell.'); return; }

    var s; // shares to sell
    if (state.trimMode === 'value') s = qty - v / ltp;
    else if (state.trimMode === 'qty') s = qty - v;
    else { // profit
      if (ltp <= avg) { out.innerHTML = warn('This stock is at or below your average (' + money2(avg) + '), so selling now would not book a profit.'); return; }
      s = v / (ltp - avg);
    }
    s = Math.round(s);
    if (s < 1) { out.innerHTML = warn('That target needs no selling (or would require buying, not trimming).'); return; }
    var note = '';
    if (s > qty) {
      var maxProfit = qty * (ltp - avg);
      note = warn('You only hold ' + inr0.format(qty) + ' shares' +
        (state.trimMode === 'profit' ? ', so the most you can book right now is ' + signMoney(maxProfit) + '.' : ", so this target can't be fully met.") +
        ' Showing a full exit of all ' + inr0.format(qty) + '.');
      s = qty;
    }
    var proceeds = s * ltp;
    var realized = s * (ltp - avg);
    var remQty = qty - s;
    var remVal = remQty * ltp;
    var rCls = realized >= 0 ? 'up' : 'down';
    out.innerHTML = note +
      big('Sell ' + inr0.format(s) + ' shares', 'at ' + money2(ltp)) +
      kv([
        ['Proceeds', money(proceeds)],
        ['Realised P&L', '<span class="' + rCls + '">' + signMoney(realized) + '</span>'],
        ['Remaining quantity', inr0.format(remQty)],
        ['Remaining value', money(remVal)],
        ['Average cost (unchanged)', money2(avg)]
      ]);
  }

  // small html builders
  function hint(t) { return '<div class="res-hint">' + t + '</div>'; }
  function warn(t) { return '<div class="res-warn">' + t + '</div>'; }
  function big(a, b) { return '<div class="res-big">' + a + '</div><div class="res-sub">' + b + '</div>'; }
  function kv(rows) { return '<div class="res-kv">' + rows.map(function (r) { return '<div class="kv-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('') + '</div>'; }
  function fld(id, label, ph) { return '<label class="fld-label">' + label + '</label><input type="number" id="' + id + '" inputmode="decimal" placeholder="' + ph + '">'; }

  // ---------- settings ----------
  function renderSettings() {
    // connection
    var connected = state.meta.source === 'zerodha' && state.meta.lastSync;
    el('connState').textContent = connected ? 'Connected to Zerodha' : (WORKER ? 'Not connected' : 'Worker not configured');
    el('connSub').textContent = state.meta.lastSync
      ? ('Last synced ' + timeAgo(state.meta.lastSync) + (state.meta.source ? ' · ' + state.meta.source : ''))
      : (WORKER ? 'Tap Connect and complete the Kite login (once per day).' : 'Set WORKER_URL in config.js to enable live sync.');
    el('connBtn').textContent = connected ? 'Refresh' : 'Connect';
    var rb = el('refreshBtn');
    if (rb && !rb.classList.contains('loading') && !rb.classList.contains('done')) btnState('idle');
    var ai = el('appKeyInput'); if (ai) ai.value = localStorage.getItem(K.appkey) || '';

    // sector editor
    var se = el('sectorEditor');
    if (!state.holdings.length) { se.innerHTML = '<div class="s-sub">Load holdings to assign sectors.</div>'; }
    else {
      se.innerHTML = state.holdings.slice().sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; })
        .map(function (h) {
          var sec = sectorOf(h.symbol);
          return '<div class="sec-edit-row" onclick="PG.openSectorSheet(\'' + esc(h.symbol) + '\')">' +
            '<span class="see-sym">' + esc(h.symbol) + '</span>' +
            '<span class="see-sec"><span class="alloc-dot" style="background:' + sectorColor(sec) + '"></span>' + esc(sec) + ' ✎</span>' +
            '</div>';
        }).join('');
    }

    el('aboutBox').innerHTML =
      'PortfolioGuidance · a private PWA. Holdings stay in this device and your backups only.<br>' +
      'Sector map: ' + Object.keys(SEC.MAP).length + ' bundled symbols across ' + (SEC.LIST.length - 1) + ' sectors.<br>' +
      (WORKER ? ('Worker: ' + esc(WORKER)) : 'Worker: not configured (demo mode).');
  }

  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }

  // ---------- sector sheet ----------
  var sheetSym = null;
  function openSectorSheet(sym) {
    sheetSym = sym;
    el('sectorSheetTitle').textContent = sym + ' — set sector';
    var cur = sectorOf(sym);
    el('sectorOptions').innerHTML = SEC.LIST.map(function (s) {
      return '<button class="sec-opt' + (s === cur ? ' sel' : '') + '" onclick="PG.setSector(\'' + esc(s) + '\')">' +
        '<span class="alloc-dot" style="background:' + sectorColor(s) + '"></span>' + esc(s) + '</button>';
    }).join('');
    el('sectorSheet').hidden = false;
  }
  function setSector(s) {
    if (sheetSym) {
      if (SEC.MAP[sheetSym] === s) delete state.overrides[sheetSym];
      else state.overrides[sheetSym] = s;
      save(K.overrides, state.overrides);
    }
    closeSectorSheet();
    render();
  }
  function closeSectorSheet() { el('sectorSheet').hidden = true; sheetSym = null; }

  // ---------- Zerodha sync via Worker ----------
  function appKey() {
    var k = localStorage.getItem(K.appkey);
    return k ? k.trim() : '';
  }
  function saveAppKey() {
    var v = el('appKeyInput').value.trim();
    if (!v) { toast('Enter the access code first.'); return; }
    localStorage.setItem(K.appkey, v);
    toast('Access code saved.'); renderSettings();
  }

  function defaultSyncLabel() {
    var connected = state.meta.source === 'zerodha' && state.meta.lastSync;
    return connected ? 'Refresh' : (WORKER ? 'Connect' : 'Demo');
  }
  function btnState(st) {
    var b = el('refreshBtn'), ic = el('syncDot'), lb = el('syncTxt');
    if (!b) return;
    b.classList.remove('loading', 'done');
    if (st === 'loading') { b.classList.add('loading'); ic.textContent = '↻'; lb.textContent = 'Syncing…'; }
    else if (st === 'done') {
      b.classList.add('done'); ic.textContent = '✓'; lb.textContent = 'Updated';
      setTimeout(function () { btnState('idle'); }, 1600);
    } else { ic.textContent = '↻'; lb.textContent = defaultSyncLabel(); }
  }
  function ripple(e) {
    var b = el('refreshBtn');
    if (!b || !e || e.clientX == null) return;
    var s = document.createElement('span'), r = b.getBoundingClientRect(), d = Math.max(r.width, r.height);
    s.className = 'rip';
    s.style.width = s.style.height = d + 'px';
    s.style.left = (e.clientX - r.left - d / 2) + 'px';
    s.style.top = (e.clientY - r.top - d / 2) + 'px';
    b.appendChild(s); setTimeout(function () { try { s.remove(); } catch (x) {} }, 520);
  }
  function fmtTime(ts) {
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12; return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }

  var refreshing = false;
  function sync(e) {
    ripple(e);
    if (!WORKER) { toast('No Worker configured — loading demo data.'); loadDemo(); return; }
    var key = appKey();
    if (!key) { toast('Enter your Worker access code in Settings first.'); setView('settings'); return; }
    if (refreshing) return;
    refreshing = true; btnState('loading');
    fetch(WORKER + '/holdings?k=' + encodeURIComponent(key), { cache: 'no-store' })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; })
          .catch(function () { return { status: r.status, body: null }; });
      })
      .then(function (res) {
        if (res.status === 401 && res.body && res.body.needLogin) {
          btnState('idle'); toast('Signing in to Zerodha…');
          setTimeout(function () { startLogin(key); }, 700); return;
        }
        if (res.status === 401) {
          localStorage.removeItem(K.appkey); btnState('idle');
          toast('Access code rejected — re-enter it in Settings.'); setView('settings'); return;
        }
        if (!res.body || !res.body.holdings) { btnState('idle'); toast('Unexpected response from the Worker.'); return; }
        applyHoldings(res.body.holdings, 'zerodha');
        btnState('done'); toast('Holdings updated · ' + fmtTime(Date.now()));
      })
      .catch(function () { btnState('idle'); toast('Could not reach the Worker. Check your connection.'); })
      .then(function () { refreshing = false; });
  }

  function startLogin(key) {
    var back = location.origin + location.pathname;
    location.href = WORKER + '/login?k=' + encodeURIComponent(key) + '&redirect=' + encodeURIComponent(back);
  }

  function applyHoldings(raw, source) {
    // Accept Zerodha holdings shape OR our normalised shape.
    state.holdings = raw.map(function (h) {
      return {
        symbol: h.symbol || h.tradingsymbol,
        exchange: h.exchange || 'NSE',
        qty: Number(h.qty != null ? h.qty : h.quantity) || 0,
        avg: Number(h.avg != null ? h.avg : h.average_price) || 0,
        ltp: Number(h.ltp != null ? h.ltp : h.last_price) || 0,
        close: Number(h.close != null ? h.close : h.close_price) || 0
      };
    }).filter(function (h) { return h.symbol && h.qty > 0; });
    state.meta = { lastSync: Date.now(), source: source };
    save(K.holdings, state.holdings); save(K.meta, state.meta);
    render();
  }

  // ---------- demo / backup ----------
  function loadDemo() {
    var demo = [
      ['HDFCBANK', 40, 1520, 1662, 1650], ['ICICIBANK', 55, 980, 1244, 1235],
      ['INFY', 30, 1490, 1585, 1601], ['TCS', 12, 3620, 3910, 3888],
      ['RELIANCE', 25, 2410, 2955, 2930], ['SUNPHARMA', 20, 1180, 1712, 1699],
      ['TITAN', 15, 3050, 3388, 3402], ['LT', 10, 3120, 3612, 3590],
      ['TATAMOTORS', 45, 720, 985, 1002], ['BHARTIARTL', 30, 980, 1585, 1560],
      ['PIIND', 18, 3300, 3810, 3795], ['HAL', 8, 3400, 4620, 4700],
      ['ULTRACEMCO', 4, 9800, 11550, 11480], ['DIXON', 6, 9200, 14300, 14100]
    ].map(function (r) { return { symbol: r[0], exchange: 'NSE', qty: r[1], avg: r[2], ltp: r[3], close: r[4] }; });
    applyHoldings(demo, 'demo data');
    toast('Loaded sample holdings.');
    setView('dash');
  }

  function exportJson() {
    var payload = { app: 'PortfolioGuidance', version: 1, exportedAt: new Date().toISOString(),
      holdings: state.holdings, overrides: state.overrides, meta: state.meta };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'portfolioguidance-backup.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function importJson(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var j = JSON.parse(r.result);
        if (j.holdings) { state.holdings = j.holdings; save(K.holdings, state.holdings); }
        if (j.overrides) { state.overrides = j.overrides; save(K.overrides, state.overrides); }
        if (j.meta) { state.meta = j.meta; save(K.meta, state.meta); }
        render(); toast('Backup restored.');
      } catch (e) { toast('That file was not a valid backup.'); }
    };
    r.readAsText(file);
  }

  // ---------- ui plumbing ----------
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.view').forEach(function (n) { n.classList.toggle('active', n.id === 'v-' + v); });
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === v); });
    if (v === 'dash') drawDonut(bySector(), totals().value);
    window.scrollTo(0, 0);
  }

  var toastTimer;
  function toast(msg) {
    var t = el('toast'); t.textContent = msg; t.hidden = false; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.hidden = true; }, 250); }, 2600);
  }

  function wireSegs() {
    el('holdSort').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      var key = b.getAttribute('data-sort');
      if (state.holdSort === key) state.holdDir = (state.holdDir === 'desc' ? 'asc' : 'desc');
      else { state.holdSort = key; state.holdDir = (key === 'alpha' ? 'asc' : 'desc'); }
      renderHoldings();
    });
    el('calcMode').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      seg(this, b); state.calcMode = b.getAttribute('data-mode');
      el('panel-down').hidden = state.calcMode !== 'down';
      el('panel-trim').hidden = state.calcMode !== 'trim';
      calc();
    });
    el('trimMode').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      seg(this, b); state.trimMode = b.getAttribute('data-trim'); calcTrim();
    });
  }
  function seg(container, btn) {
    container.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('active'); });
    btn.classList.add('active');
  }

  // ---------- boot ----------
  function boot() {
    wireSegs();
    el('importFile').addEventListener('change', function () { if (this.files[0]) importJson(this.files[0]); this.value = ''; });
    render();
    // returning from Kite login (Worker redirected us back)?
    var q = location.search + location.hash;
    if (/[?#&]connected=1/.test(q) || /#connected/.test(q)) {
      history.replaceState(null, '', location.pathname);
      setTimeout(sync, 300); // token now present in the Worker session
    }
  }

  // public API
  window.PG = {
    setView: setView, sync: sync, loadDemo: loadDemo,
    calc: calc, calcPickStock: calcPickStock, toggleSector: toggleSector,
    openSectorSheet: openSectorSheet, setSector: setSector, closeSectorSheet: closeSectorSheet,
    saveAppKey: saveAppKey, exportJson: exportJson
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
