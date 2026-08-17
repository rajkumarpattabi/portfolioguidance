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
    ui: 'PG_UI'
  };

  var UI = load(K.ui, {});
  var state = {
    holdings: load(K.holdings, []),          // [{symbol, qty, avg, ltp, close, exchange}]
    overrides: load(K.overrides, {}),        // {symbol: sector}
    meta: load(K.meta, { lastSync: 0, source: '' }),
    zones: load(K.zones, {}),
    subOpen: {},
    view: UI.view || 'dash',
    holdSort: UI.holdSort || 'value',
    holdDir: UI.holdDir || 'desc',
    allocBasis: UI.allocBasis || 'invested',
    holdExpanded: null,
    calcMode: 'add',
    trimMode: 'value',
    calcSym: null,
    addDriver: null,
    expanded: {}
  };
  function saveUI() { save(K.ui, { view: state.view, holdSort: state.holdSort, holdDir: state.holdDir, allocBasis: state.allocBasis }); }

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

  // ---------- rendering ----------
  function render() {
    renderSummary();
    renderDash();
    renderHoldings();
    renderAction();
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
    var up = arr.filter(function (h) { return h.dayPct > 0; }).sort(function (a, b) { return b.dayPct - a.dayPct; }).slice(0, 3);
    var down = arr.filter(function (h) { return h.dayPct < 0; }).sort(function (a, b) { return a.dayPct - b.dayPct; }).slice(0, 3);
    function chip(h) {
      return '<span class="mv-chip ' + (h.dayPct >= 0 ? 'up' : 'down') + '" onclick="PG.openCalc(\'' + esc(h.symbol) + '\')">' +
        esc(h.symbol) + ' <b>' + pct(h.dayPct) + '</b></span>';
    }
    m.innerHTML = '<div class="mv-title">Today\'s movers</div><div class="mv-cols">' +
      '<div class="mv-col">' + up.map(chip).join('') + '</div>' +
      '<div class="mv-col">' + down.map(chip).join('') + '</div>' +
    '</div>';
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
        '<div class="ss-sum-row"><span class="ss-sum-l">Invested</span><span class="ss-sum-v">' + money(secInv) + '</span></div>' +
        '<div class="ss-sum-row"><span class="ss-sum-l">Value</span><span class="ss-sum-v">' + money(secVal) + '</span></div>' +
        '<div class="ss-sum-row"><span class="ss-sum-l">P&amp;L</span><span class="ss-sum-v ' + pcls + '">' + signMoney(secPnl) + ' (' + pct(secPct) + ')</span></div>' +
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
    else if (so === 'sector') cmp = function (a, b) {
      var sa = sectorOf(a.symbol), sb = sectorOf(b.symbol);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.symbol < b.symbol ? -1 : (a.symbol > b.symbol ? 1 : 0);
    };
    else { var field = (so === 'day') ? 'dayPct' : so; cmp = function (a, b) { return (a[field] || 0) - (b[field] || 0); }; }
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
            heRow("Day's P&amp;L", signMoney(h.day) + ' (' + pct(h.dayPct) + ')', dcls) +
            '<div class="he-wtblock">' +
              '<div class="he-wt-r head"><span class="c1">Weightage</span><span>Invested</span><span>Value</span></div>' +
              '<div class="he-wt-r"><span class="c1">In ' + esc(sec) + '</span><span>' + swInv.toFixed(1) + '%</span><span>' + swVal.toFixed(1) + '%</span></div>' +
              '<div class="he-wt-r"><span class="c1">In portfolio</span><span>' + pwInv.toFixed(1) + '%</span><span>' + pwVal.toFixed(1) + '%</span></div>' +
            '</div>' +
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
    if (!state.holdings.length) { se.innerHTML = '<div class="s-sub">Load holdings to set sectors and zones.</div>'; }
    else {
      var rows = state.holdings.slice().sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; })
        .map(function (h) {
          var sec = sectorOf(h.symbol), z = state.zones[h.symbol] || {};
          var bv = (z.buy != null ? z.buy : ''), sv = (z.sell != null ? z.sell : '');
          return '<div class="zt-row">' +
            '<span class="zt-sym">' + esc(h.symbol) + '</span>' +
            '<span class="zt-sec" style="color:' + sectorColor(sec) + '" onclick="PG.openSectorSheet(\'' + esc(h.symbol) + '\')">' + esc(sec) + '</span>' +
            '<input class="zt-in" type="number" inputmode="decimal" placeholder="—" value="' + bv + '" oninput="PG.setZone(\'' + esc(h.symbol) + '\',\'buy\',this.value)">' +
            '<input class="zt-in" type="number" inputmode="decimal" placeholder="—" value="' + sv + '" oninput="PG.setZone(\'' + esc(h.symbol) + '\',\'sell\',this.value)">' +
          '</div>';
        }).join('');
      se.innerHTML = '<div class="zt-head"><span>Stock</span><span>Sector</span><span>Buy</span><span>Sell</span></div>' + rows;
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

  // ---------- Action tab (buy / sell zones) ----------
  function setZone(sym, kind, raw) {
    var v = parseFloat(raw);
    var z = state.zones[sym] || {};
    if (isFinite(v) && v > 0) z[kind] = v; else delete z[kind];
    if (z.buy == null && z.sell == null) delete state.zones[sym]; else state.zones[sym] = z;
    save(K.zones, state.zones);
    renderAction();
  }
  function toggleSub(sk) { state.subOpen[sk] = (state.subOpen[sk] === false) ? true : false; renderAction(); }
  function toggleSet(key) { var s = el('set-' + key); if (s) s.classList.toggle('collapsed'); }
  function openCalc(sym) {
    var sel = el('calcStock'); if (sel) sel.value = sym;
    setView('calc');
    calcPickStock(sym);
  }

  function setActionBadge(n) { var b = el('actionBadge'); if (b) { b.textContent = n; b.hidden = !n; } }

  function renderAction() {
    var body = el('actionBody'); if (!body) return;
    if (!state.holdings.length) { setActionBadge(0); body.innerHTML = '<div class="empty-note">No holdings loaded yet.</div>'; return; }

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
    function srt(a) { a.sort(function (x, y) { return y.pct - x.pct; }); }
    [buy.deep, buy.value, buy.acc, sell.book, sell.trim, sell.watch].forEach(srt);

    var anyBuy = buy.deep.length + buy.value.length + buy.acc.length;
    var anySell = sell.book.length + sell.trim.length + sell.watch.length;
    setActionBadge(anyBuy + anySell);
    if (!anyBuy && !anySell) {
      body.innerHTML = '<div class="empty-note">No stock is in a buy or sell zone right now. Set <strong>Buy</strong> / <strong>Sell</strong> target prices under <strong>Settings → Sectors &amp; zones</strong>, and holdings show up here when the price crosses them.</div>';
      return;
    }
    body.innerHTML =
      zoneHtml('Buy zone', 'buy', anyBuy, [['Deep Value', buy.deep], ['Value', buy.value], ['Accumulate', buy.acc]]) +
      zoneHtml('Sell zone', 'sell', anySell, [['Book Profit', sell.book], ['Trim', sell.trim], ['Watch', sell.watch]]);
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
    return '<div class="az-row" onclick="PG.openCalc(\'' + esc(it.sym) + '\')">' +
      '<div class="az-l"><span class="az-sym">' + esc(it.sym) + '</span>' +
        '<span class="az-sec" style="color:' + sectorColor(it.sec) + '">' + esc(it.sec) + '</span></div>' +
      '<div class="az-r"><span class="az-pct ' + cls + '">' + arrow + ' ' + it.pct.toFixed(1) + '% ' + word + '</span>' +
        '<span class="az-meta">LTP ' + money2(it.ltp) + ' · target ' + money2(it.target) + '</span></div>' +
    '</div>';
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
    var p = el('sectorSheetPanel'); if (p) { p.style.transition = ''; p.style.transform = ''; p.scrollTop = 0; }
    el('sectorSheet').hidden = false;
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
    render();
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

  function exportJson() {
    var payload = { app: 'PortfolioGuidance', version: 2, exportedAt: new Date().toISOString(),
      holdings: state.holdings, overrides: state.overrides, zones: state.zones, meta: state.meta };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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
      try {
        var j = JSON.parse(r.result);
        if (j.holdings) { state.holdings = j.holdings; save(K.holdings, state.holdings); }
        if (j.overrides) { state.overrides = j.overrides; save(K.overrides, state.overrides); }
        if (j.zones) { state.zones = j.zones; save(K.zones, state.zones); }
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
    if (v === 'dash') { var t = totals(); drawDonut(bySector(state.allocBasis), state.allocBasis === 'value' ? t.value : t.invested); }
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
    el('holdSort').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      var key = b.getAttribute('data-sort');
      if (state.holdSort === key) state.holdDir = (state.holdDir === 'desc' ? 'asc' : 'desc');
      else { state.holdSort = key; state.holdDir = (key === 'alpha' || key === 'sector') ? 'asc' : 'desc'; }
      renderHoldings(); saveUI();
    });
    el('calcMode').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      seg(this, b); state.calcMode = b.getAttribute('data-mode');
      el('panel-add').hidden = state.calcMode !== 'add';
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
    wireSheetSwipe();
    wirePull();
    el('importFile').addEventListener('change', function () { if (this.files[0]) importJson(this.files[0]); this.value = ''; });
    render();
    setView(state.view); // restore last-used tab
    // returning from Kite login (Worker redirected us back)?
    var q = location.search + location.hash;
    if (/[?#&]connected=1/.test(q) || /#connected/.test(q)) {
      history.replaceState(null, '', location.pathname);
      setTimeout(sync, 300); // token now present in the Worker session
    } else if (state.meta.source === 'zerodha') {
      setTimeout(refreshSilent, 200); // quietly refresh prices on open
    }
  }

  // public API
  window.PG = {
    setView: setView, sync: sync, loadDemo: loadDemo,
    calc: calc, calcPickStock: calcPickStock, calcAddDrive: calcAddDrive, toggleSector: toggleSector, toggleHold: toggleHold,
    openSectorSheet: openSectorSheet, setSector: setSector, closeSectorSheet: closeSectorSheet, sheetBackdrop: sheetBackdrop,
    saveAppKey: saveAppKey, exportJson: exportJson, exportCsv: exportCsv, setZone: setZone, toggleSub: toggleSub, toggleSet: toggleSet, openCalc: openCalc, setAllocBasis: setAllocBasis
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
