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
    appkey: 'PG_APPKEY',
    zones: 'PG_ZONES',
    ui: 'PG_UI',
    gdrive: 'PG_GDRIVE',
    secthresh: 'PG_SECTHRESH',
    baseline: 'PG_BASELINE',       // last-reviewed holdings snapshot (qty+avg+ltp)
    impactMeta: 'PG_IMPACTMETA',   // {shownDate, sinceDate, sig} — 1-day visibility bookkeeping
    customsectors: 'PG_CUSTOMSECTORS', // user-added sector names
    watchlist: 'PG_WATCHLIST'      // [{symbol, ltp, close}] — non-owned tracked stocks
  };

  var UI = load(K.ui, {});
  var state = {
    holdings: load(K.holdings, []),          // [{symbol, qty, avg, ltp, close, exchange}]
    overrides: load(K.overrides, {}),        // {symbol: sector}
    meta: load(K.meta, { lastSync: 0, source: '' }),
    zones: load(K.zones, {}),
    secthresh: load(K.secthresh, {}),      // {sector: maxPct} — invested basis
    customSectors: load(K.customsectors, []),  // user-added sector names
    watchlist: load(K.watchlist, []),      // [{symbol, ltp, close}] — never enters portfolio maths
    baseline: load(K.baseline, null),      // {date, source, holdings:[{symbol,qty,avg,ltp}]}
    impactMeta: load(K.impactMeta, null),
    gdrive: load(K.gdrive, { enabled: false, lastBackup: 0 }),
    subOpen: {},
    view: UI.view || 'dash',
    actionMode: UI.actionMode || 'stock',  // 'stock' | 'sector'
    holdView: UI.holdView || 'holdings',   // 'holdings' | 'watchlist'
    holdSort: UI.holdSort || 'value',
    holdDir: UI.holdDir || 'desc',
    allocBasis: UI.allocBasis || 'invested',
    holdExpanded: null,
    calcMode: 'add',
    trimMode: 'value',
    calcSym: null,
    prevView: null,        // where to return when the calculator callout closes
    addDriver: null,
    expanded: {}
  };
  function saveUI() { save(K.ui, { view: state.view, holdSort: state.holdSort, holdDir: state.holdDir, allocBasis: state.allocBasis, actionMode: state.actionMode, holdView: state.holdView }); }

  function load(k, dflt) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; }
    catch (e) { return dflt; }
  }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- helpers ----------
  var inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  function money(n) { return '₹' + inr2.format(n || 0); }
  function money2(n) { return '₹' + inr2.format(n || 0); }
  function signMoney(n) { return (n >= 0 ? '+' : '−') + '₹' + inr2.format(Math.abs(n || 0)); }
  function money0(n) { return '₹' + inr0.format(Math.round(n || 0)); }              // whole rupees (header)
  function signMoney0(n) { return (n >= 0 ? '+' : '−') + '₹' + inr0.format(Math.abs(Math.round(n || 0))); }
  function r2(n) { return Math.round((n || 0) * 100) / 100; }
  function pct(n) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function el(id) { return document.getElementById(id); }

  // Zerodha may append an exchange series suffix (e.g. CEREBRAINT-BZ, XYZ-BE).
  // Strip known series so the base symbol still maps to a sector.
  var SERIES_RE = /-(EQ|BE|BZ|BL|IL|IQ|SM|ST|GB|GS|GC|N[0-9]{1,2})$/;
  function baseSymbol(sym) { return sym.replace(SERIES_RE, ''); }
  function sectorOf(sym) {
    return state.overrides[sym] || SEC.MAP[sym] || SEC.MAP[baseSymbol(sym)] || 'Unclassified';
  }
  // Effective sector list = bundled sectors + user-added customs, with Unclassified always last.
  function sectorList() {
    var out = [], seen = {};
    (SEC.LIST || []).forEach(function (s) { if (s !== 'Unclassified' && !seen[s]) { seen[s] = 1; out.push(s); } });
    (state.customSectors || []).forEach(function (s) { if (s && s !== 'Unclassified' && !seen[s]) { seen[s] = 1; out.push(s); } });
    out.push('Unclassified');
    return out;
  }

  // stable colour per sector (index into palette by position in LIST)
  var PALETTE = ['#34c789', '#4da3ff', '#f5c542', '#a78bfa', '#f472b6', '#22d3ee',
    '#fb923c', '#a3e635', '#e879f9', '#60a5fa', '#facc15', '#2dd4bf',
    '#f87171', '#c084fc', '#4ade80', '#38bdf8', '#fbbf24', '#818cf8',
    '#fca5a5', '#5eead4', '#fdba74', '#93c5fd', '#d8b4fe', '#6ee7b7', '#fde68a'];
  function sectorColor(name) {
    var list = sectorList(), i = list.indexOf(name);
    if (i < 0) i = list.length - 1;
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
  function bySector(basis) {
    var val = basis === 'value';
    var m = {};
    state.holdings.forEach(function (h) {
      var s = sectorOf(h.symbol); var v = val ? h.qty * h.ltp : h.qty * h.avg;
      m[s] = (m[s] || 0) + v;
    });
    return Object.keys(m).map(function (s) { return { sector: s, value: m[s] }; })
      .sort(function (a, b) { return b.value - a.value; });
  }

  // ---- sector caps (invested basis) ----
  function n1(n) { return String(Math.round((n || 0) * 10) / 10); }   // ≤1 decimal, trims .0
  function heldSectors() {
    var s = {}; state.holdings.forEach(function (h) { s[sectorOf(h.symbol)] = 1; });
    return Object.keys(s);
  }
  // Held sectors with their invested amount, largest first (stable order for the caps list).
  function sectorInvestedList() {
    var m = {};
    state.holdings.forEach(function (h) { var s = sectorOf(h.symbol); m[s] = (m[s] || 0) + h.qty * h.avg; });
    return Object.keys(m).map(function (s) { return { sector: s, inv: m[s] }; })
      .sort(function (a, b) { return b.inv - a.inv; });
  }
  // Resolve the effective cap for every held sector.
  // - explicit: sectors the user typed a value for
  // - autoSector: the LAST still-blank sector, which absorbs the delta to 100
  // - caps[sector] = explicit value, or the delta for the auto sector, or null (uncapped)
  function capInfo() {
    var list = sectorInvestedList();
    var explicit = {}, sumExplicit = 0;
    list.forEach(function (x) {
      var v = state.secthresh[x.sector];
      if (v != null && isFinite(v) && v > 0) { explicit[x.sector] = v; sumExplicit += v; }
    });
    var blanks = list.filter(function (x) { return explicit[x.sector] == null; });
    var autoSector = blanks.length ? blanks[blanks.length - 1].sector : null;
    var remaining = Math.max(0, r2(100 - sumExplicit));
    var caps = {};
    list.forEach(function (x) {
      if (explicit[x.sector] != null) caps[x.sector] = explicit[x.sector];
      else if (x.sector === autoSector) caps[x.sector] = remaining;
      else caps[x.sector] = null;
    });
    return { list: list, explicit: explicit, caps: caps, autoSector: autoSector,
             sumExplicit: r2(sumExplicit), remaining: remaining };
  }

  // ---------- rendering ----------
  function render() {
    renderSummary();
    renderDash();
    renderHoldings();
    renderAction();
    renderCalcStocks();
    renderSettings();
    updateImpactBadge();
  }

  function renderSummary() {
    var t = totals();
    var bar = el('summaryBar');
    if (!state.holdings.length) { bar.innerHTML = ''; return; }
    var pnlCls = t.pnl >= 0 ? 'up' : 'down';
    var dayCls = t.day >= 0 ? 'up' : 'down';
    bar.innerHTML =
      '<div class="sm-item"><span class="sm-k">Value</span><span class="sm-v">' + money0(t.value) + '</span></div>' +
      '<div class="sm-item"><span class="sm-k">Invested</span><span class="sm-v">' + money0(t.invested) + '</span></div>' +
      '<div class="sm-item"><span class="sm-k">P&amp;L</span><span class="sm-v ' + pnlCls + '">' + signMoney0(t.pnl) + ' <em>[' + pct(t.pnlPct) + ']</em></span></div>' +
      '<div class="sm-item"><span class="sm-k">Day</span><span class="sm-v ' + dayCls + '">' + signMoney0(t.day) + ' <em>(' + pct(t.dayPct) + ')</em></span></div>';
  }

  function renderDash() {
    var has = state.holdings.length > 0;
    el('dashEmpty').hidden = has;
    var t = totals();
    renderFresh();
    el('donutTotal').textContent = has ? money0(t.value) : '—';
    var pe = el('donutPnl'), pc = el('donutPct');
    if (has) {
      var c = 'dc-sub ' + (t.pnl >= 0 ? 'up' : 'down');
      pe.textContent = signMoney0(t.pnl); pe.className = c;
      if (pc) { pc.textContent = pct(t.pnlPct); pc.className = 'dc-pct ' + (t.pnl >= 0 ? 'up' : 'down'); }
    } else { pe.textContent = ''; if (pc) pc.textContent = ''; }

    var basis = state.allocBasis, total = basis === 'value' ? t.value : t.invested;
    drawDonut(bySector(basis), total);
    renderAlloc(total);
    renderMovers();
    renderImpactCard();
    updateBasisToggle();
  }

  function renderFresh() {
    var f = el('freshLine'); if (!f) return;
    if (!state.holdings.length || !state.meta.lastSync) { f.textContent = ''; f.hidden = true; return; }
    f.hidden = false;
    var src = state.meta.source === 'zerodha' ? '' : (state.meta.source ? ' · ' + state.meta.source : '');
    f.textContent = 'As of ' + fmtTime(state.meta.lastSync) + ' · ' + timeAgo(state.meta.lastSync) + src;
  }

  function renderMovers() {
    var m = el('moversStrip'); if (!m) return;
    var arr = state.holdings.map(function (h) { return Object.assign({}, h, enrich(h)); })
      .filter(function (h) { return h.close && Math.abs(h.dayPct) > 0.001; });
    if (!arr.length) { m.innerHTML = ''; m.hidden = true; return; }
    m.hidden = false;
    var up = arr.filter(function (h) { return h.dayPct > 0; }).sort(function (a, b) { return b.dayPct - a.dayPct; }).slice(0, 5);
    var down = arr.filter(function (h) { return h.dayPct < 0; }).sort(function (a, b) { return a.dayPct - b.dayPct; }).slice(0, 5);
    function row(h) {
      return '<div class="mv-row ' + (h.dayPct >= 0 ? 'up' : 'down') + '" onclick="PG.openCalc(\'' + esc(h.symbol) + '\')">' +
        '<span class="mv-sym">' + esc(h.symbol) + '</span><span class="mv-pct">' + pct(h.dayPct) + '</span></div>';
    }
    m.innerHTML = '<div class="mv-title">Today\'s movers</div><div class="mv-list">' + up.map(row).join('') + down.map(row).join('') + '</div>';
  }

  function updateBasisToggle() {
    var wrap = el('allocBasis'); if (!wrap) return;
    wrap.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-basis') === state.allocBasis); });
  }
  function setAllocBasis(basis) { state.allocBasis = basis; saveUI(); renderDash(); }

  var allocSegs = [];
  function renderAlloc(total) {
    var list = el('allocList');
    if (!state.holdings.length) { list.innerHTML = ''; allocSegs = []; return; }
    var val = state.allocBasis === 'value';
    allocSegs = bySector(state.allocBasis);
    list.innerHTML = allocSegs.map(function (s, i) {
      var p = total ? s.value / total * 100 : 0;
      var open = !!state.expanded[s.sector];
      var hs = holdingsInSector(s.sector);
      var secInv = 0, secVal = 0;
      hs.forEach(function (h) { secInv += h.invested; secVal += h.value; });
      var secPnl = secVal - secInv, secPct = secInv ? secPnl / secInv * 100 : 0;
      var stocks = hs.map(function (h) {
        var w = total ? (val ? h.value : h.invested) / total * 100 : 0;
        return '<div class="sec-stock"><span class="ss-sym">' + esc(h.symbol) + '</span>' +
          '<span class="ss-wt">' + w.toFixed(1) + '%</span></div>';
      }).join('');
      var pcls = secPnl >= 0 ? 'up' : 'down';
      var sum = '<div class="sec-sum">' +
        '<div class="ss-sum-row"><span class="ss-sum-l">Invested</span><span class="ss-sum-v">' + money0(secInv) + '</span></div>' +
        '<div class="ss-sum-row"><span class="ss-sum-l">Value</span><span class="ss-sum-v">' + money0(secVal) + '</span></div>' +
        '<div class="ss-sum-row"><span class="ss-sum-l">P&amp;L</span><span class="ss-sum-v ' + pcls + '">' + money0(Math.abs(secPnl)) + ' (' + Math.abs(secPct).toFixed(1) + '%)</span></div>' +
      '</div>';
      return '<div class="sec-card' + (open ? ' open' : '') + '">' +
        '<button class="sec-head" type="button" onclick="PG.toggleSector(' + i + ')">' +
          '<span class="alloc-dot" style="background:' + sectorColor(s.sector) + '"></span>' +
          '<span class="sh-name">' + esc(s.sector) + '</span>' +
          '<span class="sh-pct">' + p.toFixed(1) + '%</span>' +
          '<span class="sh-caret">▾</span>' +
        '</button>' +
        '<div class="sec-stocks"' + (open ? '' : ' hidden') + '>' + sum + stocks + '</div>' +
      '</div>';
    }).join('');
  }

  function holdingsInSector(sec) {
    return state.holdings.filter(function (h) { return sectorOf(h.symbol) === sec; })
      .map(function (h) { return Object.assign({}, h, enrich(h)); })
      .sort(function (a, b) { return b.invested - a.invested; }); // by portfolio weightage (invested), largest first
  }

  function toggleSector(i) {
    var s = allocSegs[i]; if (!s) return;
    state.expanded[s.sector] = !state.expanded[s.sector];
    var t = totals();
    renderAlloc(state.allocBasis === 'value' ? t.value : t.invested);
  }

  function drawDonut(segs, total) {
    var c = el('donut'); if (!c) return;
    var dpr = window.devicePixelRatio || 1;
    var CSS = 188; // css px
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

  function updateHoldViewToggle() {
    var w = el('holdViewSeg'); if (!w) return;
    w.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-hv') === state.holdView); });
  }
  function setHoldView(v) {
    state.holdView = v; saveUI(); renderHoldings();
    if (v === 'watchlist') syncWatchlist();
  }
  function renderHoldings() {
    updateHoldViewToggle();
    var isWatch = state.holdView === 'watchlist';
    var sortSeg = el('holdSort'); if (sortSeg) sortSeg.style.display = isWatch ? 'none' : '';
    var hb = el('holdHeadBtn'); if (hb) { hb.textContent = '＋ New position'; hb.style.display = isWatch ? 'none' : ''; }
    if (isWatch) { renderWatchlist(); return; }
    var wrap = el('holdList'); var has = state.holdings.length > 0;
    el('holdEmpty').hidden = has;
    el('holdCount').textContent = has ? '(' + state.holdings.length + ')' : '';
    var arr = state.holdings.map(function (h) { return Object.assign({}, h, enrich(h)); });
    var so = state.holdSort, dir = (state.holdDir === 'asc' ? 1 : -1), cmp;
    if (so === 'alpha') cmp = function (a, b) { return a.symbol < b.symbol ? -1 : (a.symbol > b.symbol ? 1 : 0); };
    else if (so === 'sector') cmp = function (a, b) {
      var sa = sectorOf(a.symbol), sb = sectorOf(b.symbol);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.symbol < b.symbol ? -1 : (a.symbol > b.symbol ? 1 : 0);
    };
    else { var field = (so === 'day') ? 'dayPct' : (so === 'pnl') ? 'pnlPct' : so; cmp = function (a, b) { return (a[field] || 0) - (b[field] || 0); }; }
    arr.sort(function (a, b) { return dir * cmp(a, b); });
    updateSortArrows();

    var t = totals();
    var secInv = {}, secVal = {};
    state.holdings.forEach(function (h) {
      var s = sectorOf(h.symbol);
      secInv[s] = (secInv[s] || 0) + h.qty * h.avg;
      secVal[s] = (secVal[s] || 0) + h.qty * h.ltp;
    });
    function heRow(label, val, c) {
      return '<div class="he-row"><span class="he-l">' + label + '</span><span class="he-v' + (c ? ' ' + c : '') + '">' + val + '</span></div>';
    }

    wrap.innerHTML = arr.map(function (h) {
      var sec = sectorOf(h.symbol);
      var cls = h.pnl >= 0 ? 'up' : 'down';
      var dcls = h.day >= 0 ? 'up' : 'down';

      if (state.holdExpanded === h.symbol) {
        var beRow = '';
        if (h.ltp > 0 && h.ltp < h.avg) {                 // in the red on cost → show recovery %
          var be = (h.avg - h.ltp) / h.ltp * 100;
          beRow = heRow('Growth to breakeven', '+' + be.toFixed(1) + '%', 'be');
        }
        var pwInv = t.invested ? h.invested / t.invested * 100 : 0;
        var pwVal = t.value ? h.value / t.value * 100 : 0;
        var swInv = secInv[sec] ? h.invested / secInv[sec] * 100 : 0;
        var swVal = secVal[sec] ? h.value / secVal[sec] * 100 : 0;
        return '<div class="hold-exp" onclick="PG.toggleHold(\'' + esc(h.symbol) + '\')">' +
          '<div class="he-head">' +
            '<span class="he-sym">' + esc(h.symbol) + '</span>' +
            '<span class="he-sec" style="color:' + sectorColor(sec) + '">' + esc(sec) + '</span>' +
            '<span class="he-close">▲ close</span>' +
          '</div>' +
          '<div class="he-grid">' +
            heRow('Quantity', h.qty) +
            heRow('Avg cost', money2(h.avg)) +
            heRow('Market price (LTP)', money2(h.ltp)) +
            heRow('Invested', money(h.invested)) +
            heRow('Current value', money(h.value)) +
            heRow('Overall P&amp;L', signMoney(h.pnl) + ' [' + pct(h.pnlPct) + ']', cls) +
            beRow +
            heRow("Day's P&amp;L", signMoney(h.day) + ' (' + pct(h.dayPct) + ')', dcls) +
            '<div class="he-wtblock">' +
              '<div class="he-wt-r head"><span class="c1">Weightage</span><span>Invested</span><span>Value</span></div>' +
              '<div class="he-wt-r"><span class="c1">In ' + esc(sec) + '</span><span>' + swInv.toFixed(1) + '%</span><span>' + swVal.toFixed(1) + '%</span></div>' +
              '<div class="he-wt-r"><span class="c1">In portfolio</span><span>' + pwInv.toFixed(1) + '%</span><span>' + pwVal.toFixed(1) + '%</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="he-actions">' +
            '<button class="he-actbtn add" type="button" onclick="event.stopPropagation();PG.openCalcMode(\'' + esc(h.symbol) + '\',\'add\')">＋ Add / Average</button>' +
            '<button class="he-actbtn trim" type="button" onclick="event.stopPropagation();PG.openCalcMode(\'' + esc(h.symbol) + '\',\'trim\')">− Trim</button>' +
          '</div>' +
        '</div>';
      }

      return '<div class="hold" onclick="PG.toggleHold(\'' + esc(h.symbol) + '\')">' +
        '<div class="hold-l">' +
          '<div class="hold-top">' +
            '<span class="hold-sym">' + esc(h.symbol) + '</span>' +
            '<span class="hold-sec" style="color:' + sectorColor(sec) + '">' + esc(sec) + '</span>' +
          '</div>' +
          '<div class="hold-meta">' + h.qty + ' × ' + money2(h.avg) + '  ·  LTP ' + money2(h.ltp) + '</div>' +
        '</div>' +
        '<div class="hold-r">' +
          '<div class="hold-val">' + money(h.value) + '</div>' +
          '<div class="hold-pnl ' + cls + '">' + signMoney(h.pnl) + ' <em>[' + pct(h.pnlPct) + ']</em></div>' +
          '<div class="hold-day"><span class="dl">Day</span> <span class="' + dcls + '">' + signMoney(h.day) + ' <em>(' + pct(h.dayPct) + ')</em></span></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ---------- Watchlist view ----------
  function renderWatchlist() {
    var wrap = el('holdList');
    el('holdEmpty').hidden = true;
    el('holdCount').textContent = state.watchlist.length ? '(' + state.watchlist.length + ')' : '';
    var add = '<div class="watch-add">' +
      '<input id="watchAddInput" class="code-input" type="text" placeholder="Add symbol — e.g. INFY" autocomplete="off" autocapitalize="characters" ' +
        'onkeydown="if(event.key===\'Enter\')PG.addWatch(this.value)">' +
      '<button class="ghost-btn" type="button" onclick="PG.addWatch(document.getElementById(\'watchAddInput\').value)">Add</button>' +
    '</div>';
    if (!state.watchlist.length) {
      wrap.innerHTML = add + '<div class="empty-note">No watchlist stocks yet. Add symbols you want to track, set a <strong>Buy</strong> target under <strong>Settings → Sectors &amp; zones</strong>, and they appear in the <strong>Action → Buy</strong> zone when the price reaches it.</div>';
      return;
    }
    var rows = state.watchlist.slice().sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; }).map(function (w) {
      var sec = sectorOf(w.symbol), z = state.zones[w.symbol] || {};
      var dayPct = w.close ? (w.ltp - w.close) / w.close * 100 : 0, dcls = dayPct >= 0 ? 'up' : 'down';
      var meta;
      if (z.buy != null && z.buy > 0 && w.ltp > 0) {
        var d = (w.ltp - z.buy) / z.buy * 100, near = w.ltp <= z.buy;
        meta = '<div class="wl-tgt ' + (near ? 'up' : '') + '">buy ' + money2(z.buy) + ' · ' +
          (d <= 0 ? ('▼ ' + Math.abs(d).toFixed(1) + '% below') : (d.toFixed(1) + '% above')) + '</div>';
      } else if (z.buy != null && z.buy > 0) {
        meta = '<div class="wl-tgt">buy target ' + money2(z.buy) + '</div>';
      } else {
        meta = '<div class="hold-meta">no buy target — set one in Settings</div>';
      }
      return '<div class="hold wl-row" onclick="PG.openWatchCalc(\'' + esc(w.symbol) + '\')">' +
        '<div class="hold-l"><div class="hold-top">' +
          '<span class="hold-sym">' + esc(w.symbol) + '</span>' +
          '<span class="hold-sec" style="color:' + sectorColor(sec) + '" onclick="event.stopPropagation();PG.openSectorSheet(\'' + esc(w.symbol) + '\')">' + esc(sec) + '</span>' +
          '<span class="wl-tag">watch</span>' +
        '</div>' + meta + '</div>' +
        '<div class="hold-r">' +
          '<div class="hold-val">' + (w.ltp ? money2(w.ltp) : '—') + '</div>' +
          '<div class="hold-day"><span class="dl">Day</span> <span class="' + dcls + '">' + (w.close ? pct(dayPct) : '—') + '</span></div>' +
          '<button class="wl-del" type="button" onclick="event.stopPropagation();PG.removeWatch(\'' + esc(w.symbol) + '\')">Remove</button>' +
        '</div>' +
      '</div>';
    }).join('');
    wrap.innerHTML = add + rows;
  }
  function openWatchCalc(sym) {
    var w = state.watchlist.find(function (x) { return x.symbol === sym; });
    if (state.view !== 'calc') state.prevView = state.view;
    applyCalcMode('add');
    var sel = el('calcStock'); if (sel) sel.value = '';
    setView('calc');
    calcPickStock('');
    ['calcQty', 'calcAvg'].forEach(function (id) { var e = el(id); if (e) e.value = ''; });
    if (w && w.ltp) { el('calcLtp').value = r2(w.ltp); el('buyPrice').value = r2(w.ltp); }
    calc();
  }

  // ---------- Impact (effect of holdings changes since a baseline) ----------
  function todayStr(d) { d = d || new Date(); var m = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }
  function fmtDate(s) { if (!s) return ''; var p = String(s).split('-'); var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return parseInt(p[2], 10) + ' ' + (mo[parseInt(p[1], 10) - 1] || ''); }
  function snapOf(holdings) { return holdings.map(function (h) { return { symbol: h.symbol, qty: h.qty, avg: h.avg, ltp: h.ltp }; }); }

  // Diff two holdings sets on qty/avg only (LTP/price moves are ignored on purpose).
  function diffHoldings(base, cur) {
    var bm = {}, cm = {}, events = [];
    (base || []).forEach(function (h) { bm[h.symbol] = h; });
    (cur || []).forEach(function (h) { cm[h.symbol] = h; });
    Object.keys(bm).forEach(function (sym) {
      var b = bm[sym], c = cm[sym];
      if (!c) { events.push({ sym: sym, type: 'exited', old: b }); return; }
      var dq = c.qty - b.qty, da = c.avg - b.avg;
      if (Math.abs(dq) < 1 && Math.abs(da) < 0.01) return;      // unchanged (price move only)
      var invB = b.qty * b.avg, invC = c.qty * c.avg, type;
      if (dq > 0 && da < -0.01 && Math.abs(invC - invB) < 0.01 * Math.max(invB, 1)) type = 'corp'; // split/bonus
      else if (dq > 0 && da > 0.01) type = 'avgup';
      else if (dq > 0 && da < -0.01) type = 'avgdown';
      else if (dq > 0) type = 'added';
      else if (dq < 0) type = 'trimmed';
      else type = 'changed';
      events.push({ sym: sym, type: type, old: b, cur: c });
    });
    Object.keys(cm).forEach(function (sym) { if (!bm[sym]) events.push({ sym: sym, type: 'added_new', cur: cm[sym] }); });
    return events;
  }
  function sigOf(events) {
    return events.slice().sort(function (a, b) { return a.sym < b.sym ? -1 : 1; })
      .map(function (e) { return e.sym + ':' + e.type + ':' + (e.cur ? e.cur.qty + '/' + r2(e.cur.avg) : '0'); }).join('|');
  }

  // Recompute the baseline/impact bookkeeping. Called after every holdings apply + on boot.
  function refreshImpact() {
    var today = todayStr();
    if (state.meta.source !== 'zerodha') {           // only track real Zerodha data
      if (state.impactMeta) { state.impactMeta = null; save(K.impactMeta, null); }
      return;
    }
    var curSnap = snapOf(state.holdings);
    if (!state.baseline || state.baseline.source !== 'zerodha') {   // seed silently (no false impact)
      state.baseline = { date: today, source: 'zerodha', holdings: curSnap };
      save(K.baseline, state.baseline);
      state.impactMeta = null; save(K.impactMeta, null);
      return;
    }
    var events = diffHoldings(state.baseline.holdings, state.holdings);
    if (!events.length) { if (state.impactMeta) { state.impactMeta = null; save(K.impactMeta, null); } return; }
    var sig = sigOf(events);
    if (state.impactMeta && state.impactMeta.sig === sig) {
      if (state.impactMeta.shownDate < today) {       // its day has passed → expire + advance baseline
        state.baseline = { date: today, source: 'zerodha', holdings: curSnap };
        save(K.baseline, state.baseline);
        state.impactMeta = null; save(K.impactMeta, null);
      }
      return;
    }
    state.impactMeta = { shownDate: today, sinceDate: state.baseline.date, sig: sig };  // new/changed → arm for today
    save(K.impactMeta, state.impactMeta);
  }
  function impactActive() {
    return !!(state.impactMeta && state.impactMeta.shownDate === todayStr() && state.meta.source === 'zerodha' &&
      state.baseline && diffHoldings(state.baseline.holdings, state.holdings).length);
  }
  function acknowledgeImpact() {
    if (state.meta.source === 'zerodha') {
      state.baseline = { date: todayStr(), source: 'zerodha', holdings: snapOf(state.holdings) };
      save(K.baseline, state.baseline);
    }
    state.impactMeta = null; save(K.impactMeta, null);
    toast('Impact acknowledged — baseline updated.');
    if (state.view === 'impact') { setView(state.prevView || 'dash'); }
    render();
  }
  function openImpact() { if (state.view !== 'impact') state.prevView = state.view; setView('impact'); renderImpactFull(); }
  function impactBack() { setView(state.prevView && state.prevView !== 'impact' ? state.prevView : 'dash'); }

  var IMP = {
    added_new: { cls: 'imp-add',     verb: 'Added',           short: 'added' },
    avgdown:   { cls: 'imp-add',     verb: 'Averaged down',   short: 'avg ↓' },
    avgup:     { cls: 'imp-neutral', verb: 'Averaged up',     short: 'avg ↑' },
    added:     { cls: 'imp-add',     verb: 'Added',           short: 'added' },
    trimmed:   { cls: 'imp-sell',    verb: 'Trimmed',         short: 'trimmed' },
    exited:    { cls: 'imp-sell',    verb: 'Exited',          short: 'exited' },
    corp:      { cls: 'imp-warn',    verb: 'Corporate action?', short: 'split?' },
    changed:   { cls: 'imp-neutral', verb: 'Changed',         short: 'changed' }
  };
  function impMeta(t) { return IMP[t] || IMP.changed; }

  function computeImpactMetrics() {
    var base = (state.baseline && state.baseline.holdings) || [], cur = state.holdings;
    var events = diffHoldings(base, cur);
    var baseTot = 0, curTot = 0;
    base.forEach(function (h) { baseTot += h.qty * h.avg; });
    cur.forEach(function (h) { curTot += h.qty * h.avg; });
    function secMap(list) { var m = {}; list.forEach(function (h) { var s = sectorOf(h.symbol); m[s] = (m[s] || 0) + h.qty * h.avg; }); return m; }
    var secOld = secMap(base), secNew = secMap(cur);
    var deployed = 0, freed = 0;
    var rich = events.map(function (e) {
      var b = e.old, c = e.cur, o = { sym: e.sym, sec: sectorOf(e.sym), type: e.type };
      o.oldQty = b ? b.qty : 0; o.newQty = c ? c.qty : 0;
      o.oldAvg = b ? b.avg : 0; o.newAvg = c ? c.avg : 0;
      o.dQty = o.newQty - o.oldQty; o.dAvg = o.newAvg - o.oldAvg;
      o.oldInv = o.oldQty * o.oldAvg; o.newInv = o.newQty * o.newAvg;
      o.oldWt = baseTot ? o.oldInv / baseTot * 100 : 0;
      o.newWt = curTot ? o.newInv / curTot * 100 : 0;
      o.ltp = c ? c.ltp : (b ? b.ltp : 0);
      if (e.type === 'trimmed' || e.type === 'exited') {
        o.sold = o.oldQty - o.newQty;
        o.freed = o.sold * o.ltp;                          // proceeds (est)
        o.realisedEst = o.sold * (o.ltp - o.oldAvg);       // realised P&L (est)
        freed += o.freed;
      } else if (o.dQty > 0) {
        o.deployed = o.dQty * o.newAvg;                    // ~capital added (approx via avg)
        deployed += o.deployed;
      }
      if ((e.type === 'avgdown' || e.type === 'avgup') && c && c.ltp > 0) {
        o.beOld = (o.oldAvg > c.ltp) ? (o.oldAvg - c.ltp) / c.ltp * 100 : 0;
        o.beNew = (o.newAvg > c.ltp) ? (o.newAvg - c.ltp) / c.ltp * 100 : 0;
        o.beShown = o.beOld > 0 || o.beNew > 0;
      }
      return o;
    });
    var info = capInfo();
    var affected = {}; rich.forEach(function (o) { affected[o.sec] = 1; });
    var secImpact = Object.keys(affected).map(function (s) {
      return { sector: s, oldWt: baseTot ? (secOld[s] || 0) / baseTot * 100 : 0,
        newWt: curTot ? (secNew[s] || 0) / curTot * 100 : 0, cap: (info.caps[s] != null ? info.caps[s] : null) };
    }).sort(function (a, b) { return b.newWt - a.newWt; });
    function topShare(list, total, n) {
      var arr = list.map(function (h) { return h.qty * h.avg; }).sort(function (a, b) { return b - a; }), s = 0;
      for (var i = 0; i < n && i < arr.length; i++) s += arr[i];
      return total ? s / total * 100 : 0;
    }
    var conc = { top1Old: topShare(base, baseTot, 1), top1New: topShare(cur, curTot, 1),
      top5Old: topShare(base, baseTot, 5), top5New: topShare(cur, curTot, 5),
      countOld: base.length, countNew: cur.length };
    var unclassified = rich.filter(function (o) { return o.type === 'added_new' && o.sec === 'Unclassified'; }).map(function (o) { return o.sym; });
    return { rich: rich, deployed: deployed, freed: freed, secImpact: secImpact, conc: conc,
      unclassified: unclassified, count: rich.length,
      sinceDate: (state.impactMeta && state.impactMeta.sinceDate) || (state.baseline && state.baseline.date) };
  }

  function updateImpactBadge() {
    var b = el('dashBadge'); if (!b) return;
    var on = impactActive();
    if (on) { b.textContent = computeImpactMetrics().count; b.hidden = false; } else { b.hidden = true; }
  }

  // Compact "What changed" card on the Dashboard
  function renderImpactCard() {
    var c = el('impactCard'); if (!c) return;
    if (!impactActive()) { c.hidden = true; c.innerHTML = ''; return; }
    var m = computeImpactMetrics();
    var chips = m.rich.slice(0, 4).map(function (o) {
      return '<span class="imp-chip ' + impMeta(o.type).cls + '">' + esc(o.sym) + ' · ' + impMeta(o.type).short + '</span>';
    }).join('');
    if (m.rich.length > 4) chips += '<span class="imp-chip imp-more">+' + (m.rich.length - 4) + '</span>';
    var sub = [];
    if (m.deployed > 0) sub.push('<span class="imp-add">' + money0(m.deployed) + ' deployed</span>');
    if (m.freed > 0) sub.push('<span class="imp-sell">' + money0(m.freed) + ' freed (est)</span>');
    var over = m.secImpact.filter(function (s) { return s.cap != null && s.newWt > s.cap + 0.05; });
    if (over.length) sub.push('<span class="imp-sell">' + esc(over[0].sector) + ' ' + n1(over[0].newWt) + '% > ' + n1(over[0].cap) + '% cap</span>');
    c.hidden = false;
    c.innerHTML =
      '<div class="imp-card">' +
        '<div class="imp-card-h"><span class="imp-title">◔ What changed</span>' +
          '<span class="imp-since">since ' + esc(fmtDate(m.sinceDate)) + '</span></div>' +
        '<div class="imp-chips">' + chips + '</div>' +
        (sub.length ? '<div class="imp-card-sub">' + sub.join(' · ') + '</div>' : '') +
        '<div class="imp-card-actions">' +
          '<button class="imp-btn primary" type="button" onclick="PG.openImpact()">View impact</button>' +
          '<button class="imp-btn" type="button" onclick="PG.acknowledgeImpact()">Acknowledge</button>' +
        '</div>' +
      '</div>';
  }

  // Full Impact callout view
  function renderImpactFull() {
    var body = el('impactBody'); if (!body) return;
    if (!impactActive()) {
      body.innerHTML = '<div class="empty-note">No portfolio changes to show. Impacts appear here after you buy, average, trim or exit a holding.</div>';
      return;
    }
    var m = computeImpactMetrics();
    function pctMove(oldV, newV) { var d = newV - oldV; return '<span class="' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%</span>'; }
    function kv(l, v) { return '<div class="imp-kv-row"><span>' + l + '</span><span>' + v + '</span></div>'; }

    var rows = m.rich.map(function (o) {
      var meta = impMeta(o.type), lines = [];
      if (o.type === 'added_new') {
        lines.push(kv('Bought', inr0.format(o.newQty) + ' @ ' + money2(o.newAvg)));
        if (o.deployed) lines.push(kv('Deployed', '<span class="imp-add">' + money0(o.deployed) + '</span>'));
        lines.push(kv('Portfolio weight', n1(o.newWt) + '%'));
      } else if (o.type === 'exited') {
        lines.push(kv('Sold', inr0.format(o.oldQty) + ' @ ~' + money2(o.ltp) + ' (est)'));
        lines.push(kv('Freed', '<span class="imp-sell">' + money0(o.freed) + ' (est)</span>'));
        lines.push(kv('Realised', '<span class="' + (o.realisedEst >= 0 ? 'up' : 'down') + '">' + signMoney0(o.realisedEst) + ' (est)</span>'));
      } else {
        lines.push(kv('Qty', inr0.format(o.oldQty) + ' → ' + inr0.format(o.newQty) + ' (' + (o.dQty >= 0 ? '+' : '−') + inr0.format(Math.abs(o.dQty)) + ')'));
        if (Math.abs(o.dAvg) >= 0.01)
          lines.push(kv('Avg cost', money2(o.oldAvg) + ' → ' + money2(o.newAvg) + ' ' + pctMove(0, (o.oldAvg ? o.dAvg / o.oldAvg * 100 : 0))));
        if (o.type === 'trimmed') {
          lines.push(kv('Freed', '<span class="imp-sell">' + money0(o.freed) + ' (est)</span>'));
          lines.push(kv('Realised', '<span class="' + (o.realisedEst >= 0 ? 'up' : 'down') + '">' + signMoney0(o.realisedEst) + ' (est)</span>'));
        } else if (o.deployed) {
          lines.push(kv('Deployed', '<span class="imp-add">' + money0(o.deployed) + '</span>'));
        }
        if (o.beShown) lines.push(kv('Breakeven', '<span class="imp-warn">' + o.beOld.toFixed(1) + '% → ' + o.beNew.toFixed(1) + '%</span>'));
        lines.push(kv('Portfolio weight', n1(o.oldWt) + '% → ' + n1(o.newWt) + '%'));
      }
      return '<div class="imp-row ' + meta.cls + '">' +
        '<div class="imp-row-h">' +
          '<span class="alloc-dot" style="background:' + sectorColor(o.sec) + '"></span>' +
          '<span class="imp-sym">' + esc(o.sym) + '</span>' +
          '<span class="imp-badge ' + meta.cls + '">' + meta.verb + '</span>' +
          '<span class="imp-sec">' + esc(o.sec) + '</span>' +
        '</div>' +
        '<div class="imp-kv">' + lines.join('') + '</div>' +
      '</div>';
    }).join('');

    // capital summary
    var cap = [];
    if (m.deployed > 0) cap.push('<div class="imp-kv-row"><span>Capital deployed</span><span class="imp-add">' + money0(m.deployed) + '</span></div>');
    if (m.freed > 0) cap.push('<div class="imp-kv-row"><span>Capital freed (est)</span><span class="imp-sell">' + money0(m.freed) + '</span></div>');
    var capBlock = cap.length ? '<div class="imp-block"><div class="imp-block-h">Capital</div>' + cap.join('') + '</div>' : '';

    // sector cap impact
    var secRows = m.secImpact.map(function (s) {
      var right;
      if (s.cap != null) {
        var over = s.newWt > s.cap + 0.05;
        right = '<span class="' + (over ? 'down' : 'up') + '">' + n1(s.oldWt) + '% → ' + n1(s.newWt) + '% (cap ' + n1(s.cap) + '%)</span>';
      } else {
        right = '<span class="muted">' + n1(s.oldWt) + '% → ' + n1(s.newWt) + '% · no cap</span>';
      }
      return '<div class="imp-kv-row"><span><span class="alloc-dot" style="background:' + sectorColor(s.sector) + '"></span> ' + esc(s.sector) + '</span>' + right + '</div>';
    }).join('');
    var secBlock = secRows ? '<div class="imp-block"><div class="imp-block-h">Sector weight &amp; caps</div>' + secRows + '</div>' : '';

    // concentration
    var concBlock = '<div class="imp-block"><div class="imp-block-h">Concentration</div>' +
      '<div class="imp-kv-row"><span>Holdings</span><span>' + m.conc.countOld + ' → ' + m.conc.countNew + '</span></div>' +
      '<div class="imp-kv-row"><span>Top holding</span><span>' + n1(m.conc.top1Old) + '% → ' + n1(m.conc.top1New) + '%</span></div>' +
      '<div class="imp-kv-row"><span>Top 5</span><span>' + n1(m.conc.top5Old) + '% → ' + n1(m.conc.top5New) + '%</span></div>' +
    '</div>';

    var uncl = m.unclassified.length
      ? '<div class="imp-note imp-warn">New ' + (m.unclassified.length > 1 ? 'stocks' : 'stock') + ' ' + m.unclassified.map(esc).join(', ') + ' ' + (m.unclassified.length > 1 ? 'are' : 'is') + ' Unclassified — assign a sector in Settings.</div>'
      : '';

    body.innerHTML =
      '<div class="imp-head"><div><strong>' + m.count + '</strong> change' + (m.count > 1 ? 's' : '') + ' since ' + esc(fmtDate(m.sinceDate)) + '</div>' +
        '<button class="imp-btn primary" type="button" onclick="PG.acknowledgeImpact()">Acknowledge</button></div>' +
      uncl + rows + capBlock + secBlock + concBlock;
  }

  function toggleHold(sym) {
    state.holdExpanded = (state.holdExpanded === sym) ? null : sym;
    renderHoldings();
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
    if (h) { el('calcQty').value = h.qty; el('calcAvg').value = r2(h.avg); el('calcLtp').value = r2(h.ltp); el('buyPrice').value = r2(h.ltp); }
    state.addDriver = null;
    ['inAvg', 'inQty', 'inAmt'].forEach(function (id) { var e = el(id); if (e) e.value = ''; });
    calc();
  }
  function num(id) { var v = parseFloat(el(id).value); return isFinite(v) ? v : NaN; }

  function calc() {
    if (state.calcMode === 'trim') calcTrim(); else calcAdd();
  }

  // ---- Add / Average ----
  function calcAddDrive(which) { state.addDriver = which; calcAdd(); }
  function setVal(id, v) { var e = el(id); if (e && e !== document.activeElement) e.value = v; }
  function deltaChip(d) {
    var up = d >= 0;
    return ' <span class="' + (up ? 'up' : 'down') + '">(' + (up ? '↑' : '↓') + Math.abs(d).toFixed(2) + '%)</span>';
  }
  function calcAdd() {
    var out = el('addResult');
    var Q = num('calcQty'), A = num('calcAvg'), B = num('buyPrice');
    if (!isFinite(B) || B <= 0) B = num('calcLtp');
    if (!isFinite(Q) || !isFinite(A) || !isFinite(B) || B <= 0) {
      out.innerHTML = hint('Pick a holding above — its quantity, average and price load automatically.');
      return;
    }
    var driver = state.addDriver, x = NaN;
    if (driver === 'qty') { var q = num('inQty'); if (isFinite(q)) x = Math.round(q); }
    else if (driver === 'amt') { var amt = num('inAmt'); if (isFinite(amt)) x = Math.round(amt / B); }
    else if (driver === 'avg') {
      var T = num('inAvg');
      if (isFinite(T)) {
        var lo = Math.min(A, B), hi = Math.max(A, B);
        if (T <= lo || T >= hi) {
          out.innerHTML = warn('Intended average must be between your current average (' + money2(A) + ') and the buy price (' + money2(B) + ').');
          setVal('inQty', ''); setVal('inAmt', '');
          return;
        }
        x = Math.round(Q * (A - T) / (T - B));
      }
    }
    if (!isFinite(x)) { out.innerHTML = hint('Fill any one of Intended avg, Additional quantity, or Additional investment — the other two auto-fill.'); return; }
    if (x < 1) { out.innerHTML = warn('That works out to less than one share to add.'); return; }

    var addInvest = x * B;
    var newQty = Q + x;
    var newInvested = Q * A + addInvest;
    var newAvg = newInvested / newQty;

    if (driver !== 'qty') setVal('inQty', String(x));
    if (driver !== 'amt') setVal('inAmt', String(Math.round(addInvest)));
    if (driver !== 'avg') setVal('inAvg', newAvg.toFixed(2));

    var rows = [
      ['New average', money2(newAvg)],
      ['New quantity', inr0.format(newQty)],
      ['This purchase', money(addInvest)],
      ['New invested (stock)', money(newInvested)]
    ];

    var sym = state.calcSym, sec = sym ? sectorOf(sym) : null;
    if (sym && sec) {
      var totalInv = 0, secInv = 0;
      state.holdings.forEach(function (h) {
        var inv = (h.symbol === sym) ? (Q * A) : (h.qty * h.avg);
        totalInv += inv;
        if (sectorOf(h.symbol) === sec) secInv += inv;
      });
      var curStock = Q * A;
      var nStock = curStock + addInvest, nSec = secInv + addInvest, nTot = totalInv + addInvest;
      var curWSec = secInv ? curStock / secInv * 100 : 0, nWSec = nSec ? nStock / nSec * 100 : 0;
      var curWPort = totalInv ? curStock / totalInv * 100 : 0, nWPort = nTot ? nStock / nTot * 100 : 0;
      var curSecShare = totalInv ? secInv / totalInv * 100 : 0, nSecShare = nTot ? nSec / nTot * 100 : 0;
      rows.push(['Weight in ' + esc(sec), nWSec.toFixed(1) + '%' + deltaChip(nWSec - curWSec)]);
      rows.push(['Weight in portfolio', nWPort.toFixed(1) + '%' + deltaChip(nWPort - curWPort)]);
      rows.push([esc(sec) + ' share of portfolio', nSecShare.toFixed(1) + '%' + deltaChip(nSecShare - curSecShare)]);
    }

    out.innerHTML = big('Add ' + inr0.format(x) + ' shares', 'at ' + money2(B) + ' → new average ≈ ' + money2(newAvg)) + kv(rows);
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

    // sectors & zones table
    var se = el('sectorEditor');
    var zList = state.holdings.map(function (h) { return { symbol: h.symbol, watch: false }; })
      .concat(state.watchlist.map(function (w) { return { symbol: w.symbol, watch: true }; }))
      .sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; });
    if (!zList.length) { se.innerHTML = '<div class="s-sub">Load holdings (or add watchlist stocks) to set sectors and zones.</div>'; }
    else {
      var rows = zList.map(function (it) {
        var sym = it.symbol, sec = sectorOf(sym), z = state.zones[sym] || {};
        var bv = (z.buy != null ? z.buy : ''), sv = (z.sell != null ? z.sell : '');
        return '<div class="zt-row">' +
          '<span class="zt-sym">' + esc(sym) + (it.watch ? '<span class="zt-watch">watch</span>' : '') + '</span>' +
          '<span class="zt-sec" style="color:' + sectorColor(sec) + '" onclick="PG.openSectorSheet(\'' + esc(sym) + '\')">' + esc(sec) + '</span>' +
          '<input class="zt-in" type="number" inputmode="decimal" placeholder="—" value="' + bv + '" oninput="PG.setZone(\'' + esc(sym) + '\',\'buy\',this.value)">' +
          '<input class="zt-in" type="number" inputmode="decimal" placeholder="—" value="' + sv + '" oninput="PG.setZone(\'' + esc(sym) + '\',\'sell\',this.value)"' + (it.watch ? ' disabled title="Sell target applies to holdings only"' : '') + '>' +
        '</div>';
      }).join('');
      se.innerHTML = '<div class="zt-head"><span>Stock</span><span>Sector</span><span>Buy</span><span>Sell</span></div>' + rows;
    }

    var gsub = el('gdriveSub'), grow = el('gdriveRow');
    if (gsub && grow) {
      if (!GID) {
        gsub.textContent = 'Add your Google client ID (GOOGLE_CLIENT_ID) in config.js to enable Drive backup.';
        grow.innerHTML = '';
      } else if (!state.gdrive.enabled) {
        gsub.textContent = 'Keep your holdings, targets and sector edits safe in your Google Drive.';
        grow.innerHTML = '<button class="ghost-btn" onclick="PG.gConnect()">Connect Google Drive</button>';
      } else {
        gsub.textContent = state.gdrive.lastBackup ? ('Auto-backup on · last backed up ' + timeAgo(state.gdrive.lastBackup)) : 'Connected · auto-backup on.';
        grow.innerHTML = '<button class="ghost-btn" onclick="PG.gBackup(true)">Back up now</button>' +
          '<button class="ghost-btn" onclick="PG.gRestore()">Restore</button>' +
          '<button class="ghost-btn" onclick="PG.gDisconnect()">Disconnect</button>';
      }
    }

    el('aboutBox').innerHTML =
      'PortfolioGuidance · a private PWA. Holdings stay in this device and your backups only.<br>' +
      'Sector map: ' + Object.keys(SEC.MAP).length + ' bundled symbols across ' + (sectorList().length - 1) + ' sectors' + (state.customSectors && state.customSectors.length ? ' (' + state.customSectors.length + ' custom)' : '') + '.<br>' +
      (WORKER ? ('Worker: ' + esc(WORKER)) : 'Worker: not configured (demo mode).');

    renderCaps();
  }

  // ---- sector caps editor ----
  function renderCaps() {
    var wrap = el('capEditor'); if (!wrap) return;
    if (!state.holdings.length) { wrap.innerHTML = '<div class="s-sub">Load holdings to set sector caps.</div>'; return; }
    var info = capInfo();
    var totalInv = 0; state.holdings.forEach(function (h) { totalInv += h.qty * h.avg; });
    var rows = info.list.map(function (x) {
      var sec = x.sector, explicit = info.explicit[sec], isAuto = sec === info.autoSector;
      var val = (explicit != null) ? explicit : (isAuto ? info.remaining : '');
      var wt = totalInv ? x.inv / totalInv * 100 : 0, cap = info.caps[sec];
      var cls = 'ct-in' + (explicit == null && isAuto ? ' auto' : '');
      return '<div class="ct-row" data-sector="' + esc(sec) + '">' +
        '<span class="ct-sec" style="color:' + sectorColor(sec) + '">' + esc(sec) + '</span>' +
        '<span class="ct-cur">' + n1(wt) + '%</span>' +
        '<input class="' + cls + '" data-sector="' + esc(sec) + '" type="number" inputmode="decimal" min="0" max="100" placeholder="—" value="' + val + '" oninput="PG.setCap(this.getAttribute(\'data-sector\'), this.value)">' +
        '<span class="ct-delta ' + capDeltaCls(cap, wt) + '">' + capDeltaTxt(cap, wt) + '</span>' +
      '</div>';
    }).join('');
    wrap.innerHTML = '<div class="cap-sum" id="capSum"></div>' +
      '<div class="ct-head"><span>Sector</span><span>Now</span><span>Max %</span><span>Δ</span></div>' + rows;
    refreshCapSum(info);
  }
  function capDeltaTxt(cap, wt) { if (cap == null) return '—'; var d = cap - wt; return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%'; }
  function capDeltaCls(cap, wt) { if (cap == null) return 'muted'; return (cap - wt) < -0.05 ? 'down' : 'up'; }
  function refreshCapSum(info) {
    info = info || capInfo();
    var e = el('capSum'); if (!e) return;
    var over = info.sumExplicit > 100.0001;
    e.innerHTML = 'Allocated <strong>' + n1(info.sumExplicit) + '%</strong> · ' +
      (info.autoSector
        ? ('<strong>' + esc(info.autoSector) + '</strong> auto-fills the remaining <strong>' + n1(info.remaining) + '%</strong>')
        : ('unassigned <strong>' + n1(info.remaining) + '%</strong>')) +
      (over ? ' <span class="down">· over 100%</span>' : '');
  }
  // Update auto-fill markers + delta cells + summary in place, without rebuilding inputs (keeps focus while typing).
  function updateCapAuto() {
    var info = capInfo();
    var totalInv = 0; state.holdings.forEach(function (h) { totalInv += h.qty * h.avg; });
    var invBySec = {}; info.list.forEach(function (x) { invBySec[x.sector] = x.inv; });
    var rows = document.querySelectorAll('#capEditor .ct-row');
    Array.prototype.forEach.call(rows, function (row) {
      var sec = row.getAttribute('data-sector'), explicit = info.explicit[sec], isAuto = sec === info.autoSector;
      var inp = row.querySelector('.ct-in');
      if (inp) {
        if (explicit == null && isAuto) { inp.classList.add('auto'); if (inp !== document.activeElement) inp.value = info.remaining; }
        else { inp.classList.remove('auto'); if (explicit == null && inp !== document.activeElement) inp.value = ''; }
      }
      var wt = totalInv ? (invBySec[sec] || 0) / totalInv * 100 : 0, cap = info.caps[sec];
      var d = row.querySelector('.ct-delta');
      if (d) { d.textContent = capDeltaTxt(cap, wt); d.className = 'ct-delta ' + capDeltaCls(cap, wt); }
    });
    refreshCapSum(info);
  }
  function setCap(sector, raw) {
    var parsed = parseFloat(raw);
    if (!isFinite(parsed) || parsed <= 0) {
      delete state.secthresh[sector];
    } else {
      var others = 0;
      heldSectors().forEach(function (s) {
        if (s !== sector) { var e = state.secthresh[s]; if (e != null && isFinite(e) && e > 0) others += e; }
      });
      var max = r2(100 - others); if (max < 0) max = 0;
      var v = parsed > max ? max : parsed;
      if (v <= 0) { delete state.secthresh[sector]; v = 0; }
      else state.secthresh[sector] = r2(v);
      if (v !== parsed) {   // clamped — reflect the corrected value back into the field
        var ins = document.querySelectorAll('#capEditor .ct-in');
        Array.prototype.forEach.call(ins, function (inp) { if (inp.getAttribute('data-sector') === sector) inp.value = (v > 0 ? r2(v) : ''); });
      }
    }
    save(K.secthresh, state.secthresh);
    updateCapAuto();
    if (state.actionMode === 'sector') renderAction();
    scheduleAutoBackup();
  }

  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }

  // ---------- Action tab (buy / sell zones) ----------
  function setZone(sym, kind, raw) {
    var v = parseFloat(raw);
    var z = state.zones[sym] || {};
    if (isFinite(v) && v > 0) z[kind] = v; else delete z[kind];
    if (z.buy == null && z.sell == null) delete state.zones[sym]; else state.zones[sym] = z;
    save(K.zones, state.zones);
    renderAction();
    scheduleAutoBackup();
  }
  function toggleSub(sk) { state.subOpen[sk] = (state.subOpen[sk] === false) ? true : false; renderAction(); }
  function toggleSet(key) {
    var s = el('set-' + key); if (!s) return;
    var willOpen = s.classList.contains('collapsed');
    document.querySelectorAll('#v-settings .set-sec').forEach(function (sec) { sec.classList.add('collapsed'); });
    if (willOpen) s.classList.remove('collapsed');   // accordion: only one open at a time
  }
  function applyCalcMode(mode) {
    state.calcMode = mode;
    var seg = el('calcMode');
    if (seg) seg.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
    var pa = el('panel-add'), pt = el('panel-trim');
    if (pa) pa.hidden = mode !== 'add';
    if (pt) pt.hidden = mode !== 'trim';
  }
  // Open the calculator callout for a specific holding, in a given mode.
  function openCalcMode(sym, mode) {
    if (state.view !== 'calc') state.prevView = state.view;
    applyCalcMode(mode || 'add');
    var sel = el('calcStock'); if (sel) sel.value = sym || '';
    setView('calc');
    calcPickStock(sym || '');
  }
  function openCalc(sym) { openCalcMode(sym, 'add'); }   // default entry (Action rows, Movers)
  // Open the calculator for a brand-new / what-if position (no holding).
  function openCalcNew() {
    if (state.view !== 'calc') state.prevView = state.view;
    applyCalcMode('add');
    var sel = el('calcStock'); if (sel) sel.value = '';
    setView('calc');
    calcPickStock('');
    ['calcQty', 'calcAvg', 'calcLtp', 'buyPrice'].forEach(function (id) { var e = el(id); if (e) e.value = ''; });
    calc();
  }
  function calcBack() { setView(state.prevView || 'holdings'); }

  function setActionBadge(n) { var b = el('actionBadge'); if (b) { b.textContent = n; b.hidden = !n; } }

  function renderAction() {
    var body = el('actionBody'); if (!body) return;
    updateActionToggle();
    if (!state.holdings.length) { setActionBadge(0); setActionToggleCounts(0, 0); body.innerHTML = '<div class="empty-note">No holdings loaded yet.</div>'; return; }
    var sz = computeStockZones(), sc = computeSectorCaps();
    setActionBadge(sz.anyBuy + sz.anySell + sc.overCount);
    setActionToggleCounts(sz.anyBuy + sz.anySell, sc.overCount);
    if (state.actionMode === 'sector') renderActionSector(body, sc);
    else renderActionStock(body, sz);
  }

  function setActionToggleCounts(stock, sector) {
    var s = el('amodeStockCnt'), c = el('amodeSectorCnt');
    if (s) { s.textContent = stock; s.hidden = !stock; }
    if (c) { c.textContent = sector; c.hidden = !sector; }
  }

  function updateActionToggle() {
    var w = el('actionMode'); if (!w) return;
    w.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-amode') === state.actionMode); });
  }
  function setActionMode(m) { state.actionMode = m; saveUI(); renderAction(); }

  // ---- Stock view (per-stock buy/sell zones) ----
  function computeStockZones() {
    var buy = { deep: [], value: [], acc: [] }, sell = { book: [], trim: [], watch: [] };
    state.holdings.forEach(function (h) {
      var z = state.zones[h.symbol] || {}, sec = sectorOf(h.symbol), ltp = h.ltp;
      if (z.buy != null && z.buy > 0 && ltp <= z.buy) {
        var disc = (z.buy - ltp) / z.buy * 100;
        var it = { sym: h.symbol, sec: sec, ltp: ltp, target: z.buy, pct: disc };
        (disc >= 20 ? buy.deep : disc >= 10 ? buy.value : buy.acc).push(it);
      }
      if (z.sell != null && z.sell > 0 && ltp >= z.sell) {
        var prem = (ltp - z.sell) / z.sell * 100;
        var it2 = { sym: h.symbol, sec: sec, ltp: ltp, target: z.sell, pct: prem };
        (prem >= 20 ? sell.book : prem >= 10 ? sell.trim : sell.watch).push(it2);
      }
    });
    // Watchlist stocks join the BUY zone only (you don't own them to sell).
    state.watchlist.forEach(function (w) {
      var z = state.zones[w.symbol] || {}, ltp = w.ltp;
      if (ltp > 0 && z.buy != null && z.buy > 0 && ltp <= z.buy) {
        var disc = (z.buy - ltp) / z.buy * 100;
        var it = { sym: w.symbol, sec: sectorOf(w.symbol), ltp: ltp, target: z.buy, pct: disc, watch: true };
        (disc >= 20 ? buy.deep : disc >= 10 ? buy.value : buy.acc).push(it);
      }
    });
    function srt(a) { a.sort(function (x, y) { return y.pct - x.pct; }); }
    [buy.deep, buy.value, buy.acc, sell.book, sell.trim, sell.watch].forEach(srt);
    return { buy: buy, sell: sell,
      anyBuy: buy.deep.length + buy.value.length + buy.acc.length,
      anySell: sell.book.length + sell.trim.length + sell.watch.length };
  }
  function renderActionStock(body, sz) {
    if (!sz.anyBuy && !sz.anySell) {
      body.innerHTML = '<div class="empty-note">No stock is in a buy or sell zone right now. Set <strong>Buy</strong> / <strong>Sell</strong> target prices under <strong>Settings → Sectors &amp; zones</strong>, and holdings show up here when the price crosses them.</div>';
      return;
    }
    body.innerHTML =
      zoneHtml('Buy zone', 'buy', sz.anyBuy, [['Deep Value', sz.buy.deep], ['Value', sz.buy.value], ['Accumulate', sz.buy.acc]]) +
      zoneHtml('Sell zone', 'sell', sz.anySell, [['Book Profit', sz.sell.book], ['Trim', sz.sell.trim], ['Watch', sz.sell.watch]]);
  }

  // ---- Sector view (cap rebalancing, invested basis) ----
  function computeSectorCaps() {
    var info = capInfo(), totalInv = 0;
    state.holdings.forEach(function (h) { totalInv += h.qty * h.avg; });
    var rows = info.list.map(function (x) {
      var weight = totalInv ? x.inv / totalInv * 100 : 0;
      var cap = info.caps[x.sector];                       // null = uncapped
      var amount = cap != null ? x.inv - cap / 100 * totalInv : 0;   // >0 trim, <0 headroom
      return { sector: x.sector, inv: x.inv, weight: weight, cap: cap,
               over: cap != null && weight > cap + 0.05, amount: amount };
    });
    return { rows: rows, overCount: rows.filter(function (r) { return r.over; }).length,
             totalInv: totalInv, info: info };
  }
  function renderActionSector(body, sc) {
    var info = sc.info;
    if (!info.list.length) { body.innerHTML = '<div class="empty-note">No holdings loaded yet.</div>'; return; }
    var rows = sc.rows.slice().sort(function (a, b) {
      var ra = a.over ? 0 : (a.cap != null ? 1 : 2), rb = b.over ? 0 : (b.cap != null ? 1 : 2);
      if (ra !== rb) return ra - rb;
      return b.weight - a.weight;
    });
    var overRows = rows.filter(function (r) { return r.over; });
    var withinRows = rows.filter(function (r) { return !r.over; });
    var totalTrim = overRows.reduce(function (s, r) { return s + r.amount; }, 0);
    var hasCaps = Object.keys(info.explicit).length > 0;

    function secRow(r) {
      var dot = '<span class="alloc-dot" style="background:' + sectorColor(r.sector) + '"></span>';
      var capTxt = r.cap != null ? ('cap ' + n1(r.cap) + '%') : 'no cap';
      var left = '<div class="az-l">' + dot + '<span class="az-sym">' + esc(r.sector) + '</span>' +
        '<span class="az-sec" style="display:block;margin-top:2px">' + n1(r.weight) + '% now · ' + capTxt + '</span></div>';
      var right;
      if (r.over) {
        right = '<div class="az-r"><span class="az-pct down">Trim ' + money0(r.amount) + '</span>' +
          '<span class="az-meta">' + n1(r.weight - r.cap) + '% over cap</span></div>';
      } else if (r.cap != null) {
        right = '<div class="az-r"><span class="az-pct up">Room ' + money0(-r.amount) + '</span>' +
          '<span class="az-meta">' + n1(r.cap - r.weight) + '% under cap</span></div>';
      } else {
        right = '<div class="az-r"><span class="az-pct" style="color:var(--mut)">No cap</span>' +
          '<span class="az-meta">set one in Settings</span></div>';
      }
      return '<div class="az-row nolink">' + left + right + '</div>';
    }

    var banner = '';
    if (!hasCaps) {
      banner = '<div class="empty-note">Set sector caps under <strong>Settings → Sector caps</strong> to get rebalancing guidance. Weights below are on <strong>invested</strong> basis.</div>';
    } else if (!overRows.length) {
      banner = '<div class="empty-note" style="border-color:#2b6b47;color:var(--up)">All sectors are within their caps — nothing to rebalance.</div>';
    }
    var overZone = overRows.length
      ? '<div class="az-zone"><div class="az-zonehead">Rebalance <span class="az-zcnt">' + overRows.length + '</span></div>' +
        '<div class="s-sub" style="padding:0 14px 8px">Total to trim ≈ <strong>' + money0(totalTrim) + '</strong> (invested basis)</div>' +
        '<div class="az-body">' + overRows.map(secRow).join('') + '</div></div>'
      : '';
    var withinZone = '<div class="az-zone"><div class="az-zonehead">Within cap <span class="az-zcnt">' + withinRows.length + '</span></div>' +
      '<div class="az-body">' + withinRows.map(secRow).join('') + '</div></div>';
    body.innerHTML = banner + overZone + withinZone;
  }

  function zoneHtml(title, key, count, subs) {
    var subHtml = subs.map(function (s) {
      var name = s[0], items = s[1], sk = key + ':' + name;
      var open = state.subOpen[sk] !== false;
      var rows = items.length ? items.map(function (it) { return actionRow(it, key); }).join('') : '<div class="az-none">—</div>';
      return '<div class="az-sub' + (open ? ' open' : '') + '">' +
        '<button class="az-sub-h" type="button" onclick="PG.toggleSub(\'' + sk + '\')">' +
          '<span>' + name + ' <span class="az-cnt">' + items.length + '</span></span>' +
          '<span class="az-scaret">▾</span>' +
        '</button>' +
        '<div class="az-sub-body"' + (open ? '' : ' hidden') + '>' + rows + '</div>' +
      '</div>';
    }).join('');
    return '<div class="az-zone">' +
      '<div class="az-zonehead">' + title + ' <span class="az-zcnt">' + count + '</span></div>' +
      '<div class="az-body">' + subHtml + '</div>' +
    '</div>';
  }

  function actionRow(it, kind) {
    var cls = kind === 'buy' ? 'up' : 'down';
    var arrow = kind === 'buy' ? '▼' : '▲';
    var word = kind === 'buy' ? 'below' : 'above';
    var handler = it.watch ? 'openWatchCalc' : 'openCalc';
    var tag = it.watch ? '<span class="wl-tag">watch</span>' : '';
    return '<div class="az-row" onclick="PG.' + handler + '(\'' + esc(it.sym) + '\')">' +
      '<div class="az-l"><span class="az-sym">' + esc(it.sym) + '</span>' + tag +
        '<span class="az-sec" style="color:' + sectorColor(it.sec) + '">' + esc(it.sec) + '</span></div>' +
      '<div class="az-r"><span class="az-pct ' + cls + '">' + arrow + ' ' + it.pct.toFixed(1) + '% ' + word + '</span>' +
        '<span class="az-meta">LTP ' + money2(it.ltp) + ' · target ' + money2(it.target) + '</span></div>' +
    '</div>';
  }

  // ---------- sector sheet ----------
  var sheetSym = null;
  function sectorInUse(name) {
    return state.holdings.some(function (h) { return sectorOf(h.symbol) === name; });
  }
  function isCustomSector(name) { return (state.customSectors || []).indexOf(name) >= 0 && (SEC.LIST || []).indexOf(name) < 0; }
  function renderSectorOptions() {
    if (!sheetSym) return;
    var cur = sectorOf(sheetSym);
    el('sectorOptions').innerHTML = sectorList().map(function (s) {
      var del = (isCustomSector(s) && !sectorInUse(s))
        ? '<span class="sec-del" onclick="event.stopPropagation();PG.removeCustomSector(\'' + esc(s) + '\')">×</span>' : '';
      return '<button class="sec-opt' + (s === cur ? ' sel' : '') + '" onclick="PG.setSector(\'' + esc(s) + '\')">' +
        '<span class="alloc-dot" style="background:' + sectorColor(s) + '"></span><span class="sec-opt-name">' + esc(s) + '</span>' + del + '</button>';
    }).join('');
  }
  function openSectorSheet(sym) {
    sheetSym = sym;
    el('sectorSheetTitle').textContent = sym + ' — set sector';
    renderSectorOptions();
    var ni = el('newSectorName'); if (ni) ni.value = '';
    var p = el('sectorSheetPanel'); if (p) { p.style.transition = ''; p.style.transform = ''; p.scrollTop = 0; }
    el('sectorSheet').hidden = false;
  }
  function addSector(raw) {
    var name = String(raw || '').trim().replace(/[\"'\\<>]/g, '').replace(/\s+/g, ' ').slice(0, 24);
    if (!name) { toast('Enter a sector name.'); return; }
    var exists = sectorList().some(function (s) { return s.toLowerCase() === name.toLowerCase(); });
    if (exists) { toast('“' + name + '” already exists.'); return; }
    state.customSectors.push(name);
    save(K.customsectors, state.customSectors);
    scheduleAutoBackup();
    setSector(name);         // assign it to the current stock + close + re-render
    toast('Added sector “' + name + '”.');
  }
  function removeCustomSector(name) {
    if (!isCustomSector(name)) return;
    if (sectorInUse(name)) { toast('“' + name + '” is in use — reassign those stocks first.'); return; }
    state.customSectors = state.customSectors.filter(function (s) { return s !== name; });
    save(K.customsectors, state.customSectors);
    if (state.secthresh[name] != null) { delete state.secthresh[name]; save(K.secthresh, state.secthresh); }
    scheduleAutoBackup();
    renderSectorOptions();
    render();
    toast('Removed “' + name + '”.');
  }
  function sheetBackdrop(e) { if (e.target === el('sectorSheet')) closeSectorSheet(); }
  function wireSheetSwipe() {
    var panel = el('sectorSheetPanel'); if (!panel) return;
    var startY = 0, curY = 0, dragging = false, atTop = false;
    panel.addEventListener('touchstart', function (e) {
      startY = curY = e.touches[0].clientY; atTop = panel.scrollTop <= 0; dragging = true;
      panel.style.transition = 'none';
    }, { passive: true });
    panel.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      curY = e.touches[0].clientY;
      var dy = curY - startY;
      if (dy > 0 && atTop) {
        panel.style.transform = 'translateY(' + dy + 'px)';
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });
    function end() {
      if (!dragging) return; dragging = false;
      var dy = curY - startY;
      panel.style.transition = 'transform .2s ease';
      if (dy > 80 && atTop) {
        panel.style.transform = 'translateY(100%)';
        setTimeout(function () { closeSectorSheet(); }, 180);
      } else { panel.style.transform = 'translateY(0)'; }
    }
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);
  }
  function setSector(s) {
    if (sheetSym) {
      if (SEC.MAP[sheetSym] === s) delete state.overrides[sheetSym];
      else state.overrides[sheetSym] = s;
      save(K.overrides, state.overrides);
      scheduleAutoBackup();
    }
    closeSectorSheet();
    render();
  }
  function closeSectorSheet() {
    el('sectorSheet').hidden = true; sheetSym = null;
    var p = el('sectorSheetPanel'); if (p) { p.style.transition = ''; p.style.transform = ''; }
  }

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

  // Refresh prices quietly on open — never redirects to a Kite login; keeps stale data if the session expired.
  function refreshSilent() {
    if (!WORKER) return;
    var key = appKey(); if (!key) return;
    fetch(WORKER + '/holdings?k=' + encodeURIComponent(key), { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }).catch(function () { return {}; }); })
      .then(function (res) {
        if (res.status === 200 && res.body && res.body.holdings) { applyHoldings(res.body.holdings, 'zerodha'); }
      })
      .catch(function () {});
    syncWatchlist();
  }

  // ---------- Watchlist (non-owned tracked stocks; never enters portfolio maths) ----------
  function inWatch(sym) { return state.watchlist.some(function (w) { return w.symbol === sym; }); }
  function isHeld(sym) { return state.holdings.some(function (h) { return h.symbol === sym; }); }
  function addWatch(raw) {
    var sym = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9&.\-]/g, '').slice(0, 20);
    if (!sym) { toast('Enter a symbol.'); return; }
    if (isHeld(sym)) { toast(sym + ' is already in your holdings.'); return; }
    if (inWatch(sym)) { toast(sym + ' is already on the watchlist.'); return; }
    state.watchlist.push({ symbol: sym, ltp: 0, close: 0 });
    save(K.watchlist, state.watchlist);
    var i = el('watchAddInput'); if (i) i.value = '';
    renderHoldings(); renderSettings();
    scheduleAutoBackup();
    syncWatchlist();
    toast('Added ' + sym + ' to watchlist.');
  }
  function removeWatch(sym) {
    state.watchlist = state.watchlist.filter(function (w) { return w.symbol !== sym; });
    save(K.watchlist, state.watchlist);
    renderHoldings(); renderSettings(); renderAction();
    scheduleAutoBackup();
    toast('Removed ' + sym + ' from watchlist.');
  }
  function syncWatchlist() {
    if (!WORKER) return;
    var key = appKey(); if (!key) return;
    var syms = state.watchlist.map(function (w) { return w.symbol; });
    if (!syms.length) return;
    fetch(WORKER + '/quote?k=' + encodeURIComponent(key) + '&i=' + encodeURIComponent(syms.join(',')), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (res) {
        if (res && res.quotes) {
          state.watchlist.forEach(function (w) { var q = res.quotes[w.symbol]; if (q) { w.ltp = q.ltp || 0; w.close = q.close || 0; } });
          save(K.watchlist, state.watchlist);
          if (state.holdView === 'watchlist') renderHoldings();
          renderAction();
        }
      })
      .catch(function () {});
  }

  // Pull-to-refresh at the top of the page.
  function wirePull() {
    var hint = el('pullHint'); var startY = 0, pulling = false, dy = 0;
    document.addEventListener('touchstart', function (e) {
      pulling = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
      if (pulling) { startY = e.touches[0].clientY; dy = 0; }
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!pulling) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 0 && hint) {
        var d = Math.min(dy, 90);
        hint.style.transform = 'translateY(' + d + 'px)';
        hint.style.opacity = Math.min(1, dy / 70);
        hint.textContent = dy > 70 ? '↻ Release to refresh' : '↓ Pull to refresh';
      }
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (!pulling) return; pulling = false;
      if (hint) { hint.style.transform = ''; hint.style.opacity = ''; }
      if (dy > 70) sync();
      dy = 0;
    });
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
    refreshImpact();
    render();
    scheduleAutoBackup();
    syncWatchlist();
  }

  // ---------- demo / backup ----------
  function loadDemo() {
    var demo = [
      ['HDFCBANK', 40, 1520, 1662, 1650], ['KOTAKBANK', 18, 1750, 1824, 1812],
      ['BAJFINANCE', 8, 6500, 7180, 7150], ['JIOFIN', 120, 230, 292, 288],
      ['HDFCLIFE', 30, 580, 642, 636], ['TCS', 12, 3620, 3910, 3888],
      ['INFY', 30, 1490, 1585, 1601], ['DRREDDY', 9, 5600, 6250, 6210],
      ['TORNTPHARM', 6, 2600, 3050, 3030], ['HINDUNILVR', 15, 2350, 2482, 2470],
      ['ITC', 60, 400, 446, 442], ['TMPV', 25, 720, 985, 1002],
      ['PIDILITIND', 8, 2600, 2952, 2935], ['ASIANPAINT', 10, 2900, 2760, 2775],
      ['VEDL', 40, 280, 462, 455], ['LT', 6, 3120, 3612, 3590],
      ['SUZLON', 200, 38, 62, 61], ['GOLDIETF', 50, 55, 72, 71]
    ].map(function (r) { return { symbol: r[0], exchange: 'NSE', qty: r[1], avg: r[2], ltp: r[3], close: r[4] }; });
    applyHoldings(demo, 'demo data');
    toast('Loaded sample holdings.');
    setView('dash');
  }

  function backupPayload() {
    return { app: 'PortfolioGuidance', version: 7, exportedAt: new Date().toISOString(),
      holdings: state.holdings, overrides: state.overrides, zones: state.zones,
      secthresh: state.secthresh, customSectors: state.customSectors, watchlist: state.watchlist,
      baseline: state.baseline, impactMeta: state.impactMeta,
      ui: load(K.ui, {}), meta: state.meta };
  }
  function applyBackup(j) {
    if (j.holdings) { state.holdings = j.holdings; save(K.holdings, state.holdings); }
    if (j.overrides) { state.overrides = j.overrides; save(K.overrides, state.overrides); }
    if (j.zones) { state.zones = j.zones; save(K.zones, state.zones); }
    if (j.secthresh) { state.secthresh = j.secthresh; save(K.secthresh, state.secthresh); }
    if (j.customSectors) { state.customSectors = j.customSectors; save(K.customsectors, state.customSectors); }
    if (j.watchlist) { state.watchlist = j.watchlist; save(K.watchlist, state.watchlist); }
    if (j.meta) { state.meta = j.meta; save(K.meta, state.meta); }
    // Carry the impact baseline across devices if present; else seed fresh from restored holdings.
    state.baseline = j.baseline || null; save(K.baseline, state.baseline);
    state.impactMeta = j.impactMeta || null; save(K.impactMeta, state.impactMeta);
    if (j.ui) { save(K.ui, j.ui); }
    refreshImpact();
    render();
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify(backupPayload(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'portfolioguidance-backup.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function exportCsv() {
    var head = ['Symbol', 'Exchange', 'Qty', 'AvgCost', 'LTP', 'Invested', 'Value', 'PnL', 'PnLpct', 'DayChange', 'Sector', 'BuyTarget', 'SellTarget'];
    var lines = [head.join(',')];
    state.holdings.forEach(function (h) {
      var e = enrich(h), z = state.zones[h.symbol] || {};
      lines.push([h.symbol, h.exchange || 'NSE', h.qty, r2(h.avg), r2(h.ltp),
        r2(e.invested), r2(e.value), r2(e.pnl), r2(e.pnlPct), r2(e.day),
        '"' + sectorOf(h.symbol) + '"', (z.buy != null ? z.buy : ''), (z.sell != null ? z.sell : '')].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'portfolioguidance-holdings.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function importJson(file) {
    var r = new FileReader();
    r.onload = function () {
      try { applyBackup(JSON.parse(r.result)); toast('Backup restored.'); }
      catch (e) { toast('That file was not a valid backup.'); }
    };
    r.readAsText(file);
  }

  // ---------- Google Drive backup ----------
  var GID = (CFG.GOOGLE_CLIENT_ID || '');
  var gis = { token: '', exp: 0, client: null, file: null, folderId: null };
  var BK_NAME = 'portfolioguidance-backup.json';
  var BK_FOLDER = 'PortfolioGuidance';

  function gisLoad() {
    return new Promise(function (res, rej) {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var ex = el('gis-script');
      if (ex) { ex.addEventListener('load', function () { res(); }); ex.addEventListener('error', function () { rej(); }); return; }
      var s = document.createElement('script'); s.id = 'gis-script';
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
      s.onload = function () { res(); }; s.onerror = function () { rej(); };
      document.head.appendChild(s);
    });
  }
  function gToken(interactive) {
    return gisLoad().then(function () {
      if (gis.token && Date.now() < gis.exp - 60000) return gis.token;
      return new Promise(function (resolve) {
        try {
          if (!gis.client) {
            gis.client = google.accounts.oauth2.initTokenClient({
              client_id: GID, scope: 'https://www.googleapis.com/auth/drive.file', callback: function () {}
            });
          }
          gis.client.callback = function (resp) {
            if (resp && resp.access_token) { gis.token = resp.access_token; gis.exp = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3000000); resolve(gis.token); }
            else resolve(null);
          };
          gis.client.error_callback = function () { resolve(null); };
          gis.client.requestAccessToken({ prompt: interactive ? '' : 'none' });
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  function driveJson(r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { throw new Error((j.error && (j.error.message || j.error)) || ('HTTP ' + r.status)); }
      return j;
    });
  }
  function ensureFolder(token) {
    if (gis.folderId) return Promise.resolve(gis.folderId);
    var q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='" + BK_FOLDER + "' and trashed=false");
    return fetch('https://www.googleapis.com/drive/v3/files?spaces=drive&fields=files(id)&q=' + q, { headers: { Authorization: 'Bearer ' + token } })
      .then(driveJson)
      .then(function (j) {
        if (j.files && j.files[0]) { gis.folderId = j.files[0].id; return gis.folderId; }
        return fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: BK_FOLDER, mimeType: 'application/vnd.google-apps.folder' })
        }).then(driveJson).then(function (f) { gis.folderId = f.id; return f.id; });
      });
  }
  function driveFindFile(token) {
    if (gis.file) return Promise.resolve(gis.file);
    var q = encodeURIComponent("name='" + BK_NAME + "' and trashed=false");
    return fetch('https://www.googleapis.com/drive/v3/files?spaces=drive&fields=files(id,parents)&q=' + q, { headers: { Authorization: 'Bearer ' + token } })
      .then(driveJson)
      .then(function (j) { gis.file = (j.files && j.files[0]) || null; return gis.file; });
  }
  function driveUpload(token, obj) {
    var body = JSON.stringify(obj);
    return ensureFolder(token).then(function (folderId) {
      return driveFindFile(token).then(function (file) {
        if (file && file.id) {
          return fetch('https://www.googleapis.com/upload/drive/v3/files/' + file.id + '?uploadType=media', {
            method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body
          }).then(driveJson).then(function () {
            if (file.parents && file.parents.indexOf(folderId) >= 0) return;   // already in folder
            var remove = (file.parents || []).join(',');
            return fetch('https://www.googleapis.com/drive/v3/files/' + file.id + '?addParents=' + folderId + (remove ? '&removeParents=' + remove : '') + '&fields=id,parents', {
              method: 'PATCH', headers: { Authorization: 'Bearer ' + token }
            }).then(driveJson).then(function () { file.parents = [folderId]; });
          });
        }
        var boundary = 'pgb' + Date.now();
        var meta = JSON.stringify({ name: BK_NAME, mimeType: 'application/json', parents: [folderId] });
        var multipart = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
          '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
        return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart
        }).then(driveJson).then(function (f) { if (f && f.id) gis.file = { id: f.id, parents: [folderId] }; return f; });
      });
    });
  }
  function gBackup(interactive) {
    if (!GID) { if (interactive) toast('Add GOOGLE_CLIENT_ID in config.js first.'); return; }
    gToken(interactive).then(function (token) {
      if (!token) { if (interactive) toast('Google sign-in needed to back up.'); return; }
      driveUpload(token, backupPayload()).then(function () {
        state.gdrive.enabled = true; state.gdrive.lastBackup = Date.now();
        save(K.gdrive, state.gdrive); renderSettings();
        if (interactive) toast('Backed up to Google Drive.');
      }).catch(function (e) { if (interactive) toast('Drive backup failed: ' + (e && e.message ? e.message : e)); });
    });
  }
  function gRestore() {
    if (!GID) { toast('Add GOOGLE_CLIENT_ID in config.js first.'); return; }
    gToken(true).then(function (token) {
      if (!token) { toast('Google sign-in needed to restore.'); return; }
      driveFindFile(token).then(function (file) {
        if (!file || !file.id) { toast('No Drive backup found yet.'); return; }
        return fetch('https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media', { headers: { Authorization: 'Bearer ' + token } })
          .then(driveJson).then(function (j) { applyBackup(j); toast('Restored from Google Drive.'); });
      }).catch(function (e) { toast('Drive restore failed: ' + (e && e.message ? e.message : e)); });
    });
  }
  function gConnect() {
    if (!GID) { toast('Add GOOGLE_CLIENT_ID in config.js first.'); return; }
    gToken(true).then(function (token) {
      if (!token) { toast('Google sign-in cancelled.'); return; }
      state.gdrive.enabled = true; save(K.gdrive, state.gdrive);
      gBackup(true);
    });
  }
  function gDisconnect() {
    state.gdrive.enabled = false; save(K.gdrive, state.gdrive);
    try { if (gis.token && window.google) google.accounts.oauth2.revoke(gis.token, function () {}); } catch (e) {}
    gis.token = ''; gis.exp = 0; renderSettings(); toast('Drive backup turned off.');
  }
  var autoBkTimer;
  function scheduleAutoBackup() {
    if (!GID || !state.gdrive.enabled) return;
    clearTimeout(autoBkTimer);
    autoBkTimer = setTimeout(function () { gBackup(false); }, 4000);
  }

  // ---------- ui plumbing ----------
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.view').forEach(function (n) { n.classList.toggle('active', n.id === 'v-' + v); });
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === v); });
    if (v === 'dash') { var t = totals(); drawDonut(bySector(state.allocBasis), state.allocBasis === 'value' ? t.value : t.invested); }
    if (v === 'action') renderAction();   // always refresh Action (zones/caps may have changed in Settings)
    window.scrollTo(0, 0);
    saveUI();
  }

  var toastTimer;
  function toast(msg) {
    var t = el('toast'); t.textContent = msg; t.hidden = false; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.hidden = true; }, 250); }, 2600);
  }

  function wireSegs() {
    var hvSeg = el('holdViewSeg');
    if (hvSeg) hvSeg.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      setHoldView(b.getAttribute('data-hv'));
    });
    el('holdSort').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      var key = b.getAttribute('data-sort');
      if (state.holdSort === key) state.holdDir = (state.holdDir === 'desc' ? 'asc' : 'desc');
      else { state.holdSort = key; state.holdDir = (key === 'alpha' || key === 'sector') ? 'asc' : 'desc'; }
      renderHoldings(); saveUI();
    });
    el('calcMode').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      applyCalcMode(b.getAttribute('data-mode'));
      calc();
    });
    el('trimMode').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      seg(this, b); state.trimMode = b.getAttribute('data-trim'); calcTrim();
    });
    el('actionMode').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      setActionMode(b.getAttribute('data-amode'));
    });
  }
  function seg(container, btn) {
    container.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('active'); });
    btn.classList.add('active');
  }

  // ---------- boot ----------
  function boot() {
    wireSegs();
    wireSheetSwipe();
    wirePull();
    el('importFile').addEventListener('change', function () { if (this.files[0]) importJson(this.files[0]); this.value = ''; });
    refreshImpact();   // re-evaluate any pending impact from a prior session
    render();
    // Calculator/Impact are contextual callouts, not tabs — never boot into them.
    setView((state.view === 'calc' || state.view === 'impact') ? 'dash' : state.view);
    // returning from Kite login (Worker redirected us back)?
    var q = location.search + location.hash;
    if (/[?#&]connected=1/.test(q) || /#connected/.test(q)) {
      history.replaceState(null, '', location.pathname);
      setTimeout(sync, 300); // token now present in the Worker session
    } else if (state.meta.source === 'zerodha') {
      setTimeout(refreshSilent, 200); // quietly refresh prices on open
    } else {
      setTimeout(syncWatchlist, 300); // watchlist prices even if holdings aren't refreshing
    }
  }

  // public API
  window.PG = {
    setView: setView, sync: sync, loadDemo: loadDemo,
    calc: calc, calcPickStock: calcPickStock, calcAddDrive: calcAddDrive, toggleSector: toggleSector, toggleHold: toggleHold,
    openCalcMode: openCalcMode, openCalcNew: openCalcNew, calcBack: calcBack,
    openImpact: openImpact, impactBack: impactBack, acknowledgeImpact: acknowledgeImpact,
    openSectorSheet: openSectorSheet, setSector: setSector, closeSectorSheet: closeSectorSheet, sheetBackdrop: sheetBackdrop,
    addSector: addSector, removeCustomSector: removeCustomSector,
    addWatch: addWatch, removeWatch: removeWatch, setHoldView: setHoldView, openWatchCalc: openWatchCalc,
    saveAppKey: saveAppKey, exportJson: exportJson, exportCsv: exportCsv, setZone: setZone, toggleSub: toggleSub, toggleSet: toggleSet, openCalc: openCalc, setAllocBasis: setAllocBasis,
    setCap: setCap, setActionMode: setActionMode,
    gConnect: gConnect, gBackup: gBackup, gRestore: gRestore, gDisconnect: gDisconnect
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
