/* Live tab: forward tests, live watch (pretend account or Alpaca practice account),
 * the Alpaca account panel and the automatic daily bot. */
(function () {
  'use strict';
  const { lineChart, makeChart, fmt, esc, css, T } = window.TLCharts;
  const { h } = window.TLBuilder;
  const A = window.TLApp;
  const $ = (id) => document.getElementById(id);
  const REPO_RAW = 'https://raw.githubusercontent.com/Just-Rice/trading-lab/main/';

  /* ---------- time helpers (New York) ---------- */
  function nyDate(d = new Date()) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return p; // YYYY-MM-DD
  }
  const todayDay = () => A.isoToDay(nyDate());
  const clockTime = (d = new Date()) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  function until(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return 'soon';
    const hrs = Math.floor(ms / 3600000), mins = Math.round((ms % 3600000) / 60000);
    return hrs >= 24 ? `in ${Math.floor(hrs / 24)}d ${hrs % 24}h` : hrs ? `in ${hrs}h ${mins}m` : `in ${mins}m`;
  }

  /* ---------- Alpaca keys ---------- */
  const KEYS = 'tradinglab.alpaca';
  let alp = null;
  function loadKeys() {
    try { return JSON.parse(localStorage.getItem(KEYS) || sessionStorage.getItem(KEYS) || 'null'); } catch (e) { return null; }
  }
  function storeKeys(k, remember) {
    try {
      localStorage.removeItem(KEYS); sessionStorage.removeItem(KEYS);
      if (k) (remember ? localStorage : sessionStorage).setItem(KEYS, JSON.stringify(k));
    } catch (e) { /* storage blocked */ }
  }
  function setAlpStatus(text, cls) { const p = $('alpStatus'); p.textContent = text; p.className = 'pill ' + (cls || ''); }

  async function connect(k, quiet) {
    const c = TLAlpaca.client(k.key, k.secret);
    $('alpMsg').textContent = quiet ? '' : 'Checking…';
    try {
      const acct = await c.account();
      alp = c;
      setAlpStatus(`Connected · practice account ${fmt.money(+acct.equity)}`, 'ok');
      $('alpMsg').textContent = '';
      pickDefaultSource();
      $('alpHelp').open = false;
      refreshAccount(); refreshClock();
      return true;
    } catch (e) {
      alp = null;
      setAlpStatus('Not connected', 'bad');
      $('alpMsg').textContent = e.status === 401 || e.status === 403
        ? "Alpaca didn't accept those keys. Check that they are Paper (practice) keys and that the secret was copied in full."
        : `Couldn't reach Alpaca: ${e.message}`;
      return false;
    }
  }
  function initKeys() {
    const k = loadKeys();
    if (k) { $('alpKey').value = k.key; $('alpSecret').value = k.secret; connect(k, true); }
    else $('alpHelp').open = true;
    $('alpConnect').onclick = async () => {
      const k2 = { key: $('alpKey').value.trim(), secret: $('alpSecret').value.trim() };
      if (!k2.key || !k2.secret) { $('alpMsg').textContent = 'Paste both the Key ID and the secret key.'; return; }
      if (await connect(k2)) { storeKeys(k2, $('alpRemember').checked); A.toast('Connected to your Alpaca practice account.'); }
    };
    $('alpForget').onclick = () => { storeKeys(null); alp = null; $('alpKey').value = ''; $('alpSecret').value = ''; setAlpStatus('Not connected'); $('acctBody').innerHTML = '<p class="hint">Connect your Alpaca key above to see your practice account.</p>'; A.toast('Keys removed from this browser.'); };
  }

  /* ---------- Finnhub key (live prices) ---------- */
  const FKEY = 'tradinglab.finnhub';
  let fh = null;
  function setFhStatus(text, cls) { const p = $('fhStatus'); p.textContent = text; p.className = 'pill ' + (cls || ''); }
  async function connectFh(key, quiet) {
    const c = TLFinnhub.client(key);
    $('fhMsg').textContent = quiet ? '' : 'Checking…';
    try {
      const q = await c.quote('SPY');
      if (!q || !q.c) throw new Error('Finnhub returned no price');
      fh = c;
      setFhStatus('Connected', 'ok');
      $('fhMsg').textContent = quiet ? '' : `Working: SPY's latest price is ${fmt.price(q.c)}.`;
      pickDefaultSource(); refreshClock();
      return true;
    } catch (e) {
      fh = null;
      setFhStatus('Not connected', 'bad');
      $('fhMsg').textContent = e.status === 401 || e.status === 403 ? "Finnhub didn't accept that key. Check that it was copied in full." : `Couldn't reach Finnhub: ${e.message}`;
      return false;
    }
  }
  function initFinnhub() {
    let k = null;
    try { k = localStorage.getItem(FKEY) || sessionStorage.getItem(FKEY); } catch (e) { /* storage blocked */ }
    if (k) { $('fhKey').value = k; connectFh(k, true); }
    $('fhSave').onclick = async () => {
      const k2 = $('fhKey').value.trim();
      if (!k2) { $('fhMsg').textContent = 'Paste your Finnhub API key first.'; return; }
      if (await connectFh(k2)) {
        try { localStorage.removeItem(FKEY); sessionStorage.removeItem(FKEY); ($('fhRemember').checked ? localStorage : sessionStorage).setItem(FKEY, k2); } catch (e) { /* storage blocked */ }
        A.toast('Finnhub connected: live prices are ready.');
      }
    };
    $('fhForget').onclick = () => {
      try { localStorage.removeItem(FKEY); sessionStorage.removeItem(FKEY); } catch (e) { /* storage blocked */ }
      fh = null; $('fhKey').value = ''; $('fhMsg').textContent = '';
      setFhStatus('No key yet'); pickDefaultSource();
      A.toast('Finnhub key removed from this browser.');
    };
  }
  // Use Finnhub for prices when it's connected, unless the viewer picked a source themselves.
  function pickDefaultSource() {
    const sel = $('wSrc');
    if (!sel.dataset.touched) sel.value = fh || !alp ? 'finnhub' : 'alpaca';
  }

  /* ---------- market clock ---------- */
  let clock = null;
  async function refreshClock() {
    try {
      if (alp) {
        const c = await alp.clock();
        clock = { is_open: c.is_open, next_open: c.next_open, label: c.is_open ? `Market open · closes ${until(c.next_close)}` : `Market closed · opens ${until(c.next_open)}` };
      } else if (fh) {
        const m = await fh.marketStatus();
        const open = !!m.isOpen && m.session === 'regular';
        clock = { is_open: open, label: open ? 'Market open' : m.holiday ? `Market closed · ${m.holiday}` : m.session === 'pre-market' ? 'Pre-market · opens 9:30am New York time' : m.session === 'post-market' ? 'After hours · market closed' : 'Market closed' };
      } else return;
      const p = $('mktStatus');
      p.className = 'pill ' + (clock.is_open ? 'ok' : '');
      p.textContent = clock.label;
    } catch (e) { /* ignore */ }
  }
  setInterval(refreshClock, 60000);

  /* ---------- 1. forward tests ---------- */
  let fwdCharts = [];
  async function renderForward() {
    const el = $('fwdList'), list = A.S.forward;
    fwdCharts.forEach(c => c.dispose()); fwdCharts = [];
    if (!list.length) { el.innerHTML = '<p class="hint">No forward tests yet.</p>'; renderBotMaker(); return; }
    el.innerHTML = '';
    for (const f of list) {
      const box = h('div', { class: 'fwd' });
      el.append(box);
      try { await (f.kind === 'portfolio' ? fillForwardPortfolio(box, f) : fillForward(box, f)); } catch (e) { box.textContent = `${f.name}: ${e.message}`; }
    }
    renderBotMaker();
  }
  async function fillForwardPortfolio(box, f) {
    const U = await A.loadUniverse(A.pfSyms(f.strat)), cal = U.cal;
    const lockIdx = Math.min(cal.n - 1, TL.indexOnOrAfter(cal, f.lockedDay + 1) - 1), days = cal.n - 1 - lockIdx;
    const from = Math.max(TL.WARM, lockIdx - 30);
    const res = TL.backtestPortfolio(U, f.strat, { from, to: cal.n - 1, capital: f.capital, fee: f.fee, slip: f.slip });
    const eq = res.equity, eqLock = eq[lockIdx - from], ret = (eq[cal.n - 1 - from] / eqLock - 1) * 100;
    const spy = U.series.SPY, bh = (spy.close[U.idx.SPY[cal.n - 1]] / spy.close[U.idx.SPY[lockIdx]] - 1) * 100;
    const now = TL.decidePortfolio(U, f.strat).weights;
    const holds = Object.entries(now).filter(([, v]) => v > 0.0001).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k === 'cash' ? 'Cash' : k} ${(v * 100).toFixed(0)}%`).join(', ');
    const nm = h('input', { value: f.name, 'aria-label': 'Forward test name', style: 'font-weight:700;width:min(100%,440px);padding:4px 6px' });
    nm.onchange = () => { f.name = nm.value; A.persist(); renderBotMaker(); };
    box.append(h('div', { class: 'fwd-head' }, nm, h('span', { class: 'muted' }, `Portfolio · locked ${fmt.date(f.lockedDay)}`)));
    const stats = h('div', { class: 'fwd-stats' });
    stats.innerHTML = (days ? `<div>Trading days since lock<b>${days}</b></div>
      <div>Portfolio since lock<b class="${fmt.signClass(ret)}">${fmt.pct(ret, 2)}</b></div>
      <div>S&amp;P 500 since lock<b class="${fmt.signClass(bh)}">${fmt.pct(bh, 2)}</b></div>` : `<div>Status<b style="font-size:14px">Waiting for the first new trading day</b></div>`) +
      `<div style="grid-column:span 2">Holds now<b style="font-size:14px">${esc(holds)}</b></div>`;
    box.append(stats);
    if (days >= 2) {
      const leg = h('div', { class: 'legend' }), ch = h('div', { class: 'chart chart-sm' });
      box.append(leg, ch);
      const lc = lineChart(ch, leg); fwdCharts.push(lc);
      const a = [], b = [];
      for (let i = lockIdx; i < cal.n; i++) { a.push({ time: T(cal.t[i]), value: eq[i - from] / eqLock * f.capital }); b.push({ time: T(cal.t[i]), value: spy.close[U.idx.SPY[i]] / spy.close[U.idx.SPY[lockIdx]] * f.capital }); }
      lc.set([{ label: 'Portfolio', pts: a, color: '--s1' }, { label: 'S&P 500 only', pts: b, color: '--bench', dash: true }], { log: false });
    }
    box.append(h('div', { class: 'btns', style: 'margin-top:10px' },
      A.confirmBtn('Remove', 'Sure?', () => { A.S.forward = A.S.forward.filter(x => x.id !== f.id); A.persist(); renderForward(); fillAlgoSelect(); }, 'btn sm danger')));
  }
  async function fillForward(box, f) {
    const s = await A.loadSeries(f.sym);
    const lockIdx = Math.min(s.n - 1, TL.indexOnOrAfter(s, f.lockedDay + 1) - 1); // last bar on or before the lock
    const days = s.n - 1 - lockIdx;
    const res = TL.backtest(s, f.strat, { from: 1, to: s.n - 1, capital: f.capital, fee: f.fee, slip: f.slip });
    const eq = res.equity, off = res.from;
    const eqLock = eq[lockIdx - off], eqNow = eq[s.n - 1 - off];
    const ret = (eqNow / eqLock - 1) * 100, bh = (s.close[s.n - 1] / s.close[lockIdx] - 1) * 100;
    const recent = res.trades.filter(t => t.entryIdx > lockIdx || (!t.open && t.exitIdx > lockIdx));
    const pos = res.openPos;
    const decision = TL.decide(s, f.strat, pos ? { entryIdx: pos.entryIdx, entryPrice: pos.entryPrice, peakHigh: pos.peakHigh, peakClose: pos.peakClose } : null);
    const nm = h('input', { value: f.name, 'aria-label': 'Forward test name', style: 'font-weight:700;width:min(100%,440px);padding:4px 6px' });
    nm.onchange = () => { f.name = nm.value; A.persist(); renderBotMaker(); };
    const plan = decision.action === 'buy' ? '<b class="up">Buy</b> at the next open' : decision.action === 'sell' ? `<b class="down">Sell</b> at the next open (${esc(decision.why)})` : pos ? 'Keep holding' : 'Stay in cash';
    box.append(h('div', { class: 'fwd-head' }, nm, h('span', { class: 'muted' }, `${f.sym} · locked ${fmt.date(f.lockedDay)}`)));
    const stats = h('div', { class: 'fwd-stats' });
    stats.innerHTML = days ? `
      <div>Trading days since lock<b>${days}</b></div>
      <div>Robot since lock<b class="${fmt.signClass(ret)}">${fmt.pct(ret, 2)}</b></div>
      <div>Just holding since lock<b class="${fmt.signClass(bh)}">${fmt.pct(bh, 2)}</b></div>
      <div>Trades since lock<b>${recent.length}</b></div>
      <div>Right now<b>${pos ? 'Holding' : 'In cash'}</b></div>
      <div>Next move<b style="font-size:14px">${plan}</b></div>` : `
      <div>Status<b style="font-size:14px">Waiting for the first new trading day</b></div>
      <div>Right now<b>${pos ? 'Holding' : 'In cash'}</b></div>
      <div>Next move<b style="font-size:14px">${plan}</b></div>`;
    box.append(stats);
    if (days >= 2) {
      const leg = h('div', { class: 'legend' }), ch = h('div', { class: 'chart chart-sm' });
      box.append(leg, ch);
      const lc = lineChart(ch, leg); fwdCharts.push(lc);
      const robot = [], hold = [];
      for (let i = lockIdx; i < s.n; i++) {
        robot.push({ time: T(s.t[i]), value: eq[i - off] / eqLock * f.capital });
        hold.push({ time: T(s.t[i]), value: s.close[i] / s.close[lockIdx] * f.capital });
      }
      lc.set([{ label: 'Robot', pts: robot, color: '--s1' }, { label: 'Just holding', pts: hold, color: '--bench', dash: true }], { log: false });
    }
    if (recent.length) {
      const d = h('details', { class: 'trades' }, h('summary', {}, `Trades since lock (${recent.length})`));
      const w = h('div', { class: 'tbl-wrap' });
      w.innerHTML = `<table class="data"><thead><tr><th class="l">Bought</th><th>Price</th><th class="l">Sold</th><th>Price</th><th>Result</th></tr></thead><tbody>${recent.map(t => `<tr><td class="l">${fmt.date(s.t[t.entryIdx])}</td><td>${fmt.price(t.entryPrice)}</td><td class="l">${t.open ? 'still holding' : fmt.date(s.t[t.exitIdx])}</td><td>${fmt.price(t.exitPrice)}</td><td class="${fmt.signClass(t.ret)}">${fmt.pct(t.ret)}</td></tr>`).join('')}</tbody></table>`;
      d.append(w); box.append(d);
    }
    box.append(h('div', { class: 'btns', style: 'margin-top:10px' },
      h('button', { class: 'btn sm', onclick: () => { $('wAlgo').value = 'f:' + f.id; $('wAlgo').dispatchEvent(new Event('change')); $('watchCard').scrollIntoView({ behavior: 'smooth' }); } }, 'Watch live'),
      A.confirmBtn('Remove', 'Sure?', () => { A.S.forward = A.S.forward.filter(x => x.id !== f.id); A.persist(); renderForward(); fillAlgoSelect(); }, 'btn sm danger')));
  }

  /* ---------- 2 & 3. live watch ---------- */
  const WKEY = 'tradinglab.watch';
  let acct = loadAcct();
  function loadAcct() {
    try { const a = JSON.parse(localStorage.getItem(WKEY) || 'null'); if (a) return a; } catch (e) { /* ignore */ }
    return freshAcct();
  }
  function freshAcct() { const b = watchBudget(); return { cash: b, start: b, shares: 0, sym: null, pos: null, trades: [], acted: {} }; }

  // The most live watch puts into one purchase (and the pretend account's starting money).
  const BKEY = 'tradinglab.watchBudget';
  function watchBudget() {
    const el = $('wBudget'), v = el && +el.value;
    return v > 0 ? v : 10000;
  }
  function initWatchBudget() {
    let v = null;
    try { v = +localStorage.getItem(BKEY); } catch (e) { /* storage blocked */ }
    $('wBudget').value = v > 0 ? v : 10000;
    $('wBudget').addEventListener('change', () => {
      const x = Math.max(1, Math.round(+$('wBudget').value || 10000));
      $('wBudget').value = x;
      try { localStorage.setItem(BKEY, String(x)); } catch (e) { /* storage blocked */ }
      if (W) { log(`Budget changed to <b>${fmt.money(x)}</b>. It applies from the next purchase.`); renderWatchAccount(); }
    });
  }
  function saveAcct() {
    const today = nyDate();
    for (const k of Object.keys(acct.acted)) if (!k.startsWith(today)) delete acct.acted[k];
    try { localStorage.setItem(WKEY, JSON.stringify(acct)); } catch (e) { /* ignore */ }
  }

  function fillAlgoSelect() {
    const sel = $('wAlgo'), cur = sel.value;
    sel.innerHTML = '';
    const singles = A.S.forward.filter(f => f.kind !== 'portfolio');
    if (singles.length) { const g = h('optgroup', { label: 'Forward tests (frozen settings)' }); singles.forEach(f => g.append(h('option', { value: 'f:' + f.id }, `${f.name}`))); sel.append(g); }
    const g2 = h('optgroup', { label: 'Strategies' });
    g2.append(h('option', { value: 'e' }, `Build your own: ${A.S.edit.strat ? A.S.edit.strat.name : 'current'}`));
    A.allStrategies().forEach(s => g2.append(h('option', { value: 's:' + s.id }, s.name)));
    sel.append(g2);
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  function fillSymSelect() {
    const sel = $('wSym');
    sel.innerHTML = '';
    A.manifest.tickers.forEach(t => sel.append(h('option', { value: t.s }, `${t.s}: ${t.n}`)));
    sel.value = A.S.market.sym;
  }
  function chosenAlgo() {
    const v = $('wAlgo').value;
    if (v.startsWith('f:')) { const f = A.S.forward.find(x => x.id === v.slice(2)); return f && { strat: f.strat, sym: f.sym, name: f.name }; }
    if (v === 'e') return { strat: A.S.edit.strat, name: A.S.edit.strat.name };
    const s = A.getStrategy(v.slice(2));
    return s && { strat: s, name: s.name };
  }

  let W = null; // the running watch
  function log(text, cls = '') {
    const li = h('li', { class: cls }, h('time', {}, clockTime()), h('span', {}));
    li.lastChild.innerHTML = text;
    $('wLog').prepend(li);
    while ($('wLog').children.length > 200) $('wLog').lastChild.remove();
  }

  // One shape for both price sources: latest price, today's bar and the previous close.
  async function snapshot(src, sym) {
    if (src === 'finnhub') {
      const q = await fh.quote(sym);
      if (!q || !q.t) throw new Error(`Finnhub has no price for ${sym}`);
      const ms = q.t * 1000;
      return { last: q.c, lastTime: ms, prevClose: q.pc, dayBar: { day: A.isoToDay(nyDate(new Date(ms))), o: q.o, h: q.h, l: q.l, c: q.c, v: 0 } };
    }
    const s2 = await alp.snapshot(sym), db = s2.dailyBar, lt = s2.latestTrade;
    return {
      last: lt ? lt.p : db && db.c, lastTime: lt ? Date.parse(lt.t) : 0, prevClose: s2.prevDailyBar ? s2.prevDailyBar.c : null,
      dayBar: db ? { day: A.isoToDay(nyDate(new Date(db.t))), o: db.o, h: db.h, l: db.l, c: db.c, v: db.v } : null,
    };
  }
  function prevWeekday(day) { let d = day - 1; while ([0, 6].includes(new Date(d * 86400000).getUTCDay())) d--; return d; }

  // Days between the nightly price file and now. Alpaca has daily bars; Finnhub's free
  // plan only has today's bar and the previous close, which covers the usual one-day gap.
  async function gapBars(src, sym, lastDay, snap, open) {
    const today = todayDay(), gap = [], db = snap.dayBar;
    if (src === 'alpaca') {
      const bars = await alp.dailyBars(sym, TL.dayToISO(lastDay + 1));
      for (const b of (bars && bars.bars) || []) {
        const d = A.isoToDay(b.t.slice(0, 10));
        if (d > lastDay && d < today) gap.push({ t: d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      }
    } else if (db && db.day > lastDay) {
      const before = prevWeekday(db.day);
      if (before > lastDay && snap.prevClose) gap.push({ t: before, o: snap.prevClose, h: snap.prevClose, l: snap.prevClose, c: snap.prevClose, v: 0, approx: true });
    }
    // A finished day that the nightly file hasn't picked up yet
    if (db && db.day > lastDay && !(open && db.day === today) && !gap.some(g => g.t === db.day)) gap.push({ t: db.day, o: db.o, h: db.h, l: db.l, c: db.c, v: db.v || 0 });
    return gap.sort((x, y) => x.t - y.t);
  }

  async function startWatch() {
    const algo = chosenAlgo();
    if (!algo) { A.toast('Pick an algorithm.'); return; }
    const sym = $('wSym').value, dest = $('wDest').value, src = $('wSrc').value;
    if (src === 'finnhub' && !fh) { A.toast('Add your Finnhub key first, in the box above.'); $('fhCard').scrollIntoView({ behavior: 'smooth' }); return; }
    if (src === 'alpaca' && !alp) { A.toast('Connect your Alpaca practice key first, or choose Finnhub for live prices.'); $('alpacaCard').scrollIntoView({ behavior: 'smooth' }); return; }
    if (dest === 'alpaca' && !alp) { A.toast('Sending orders to Alpaca needs your Alpaca practice key.'); $('alpacaCard').scrollIntoView({ behavior: 'smooth' }); return; }
    stopWatch(true);
    const strat = TL.clone(algo.strat);
    $('wStart').disabled = true;
    try {
      const hist = await A.loadSeries(sym);
      const lastDay = hist.t[hist.n - 1];
      await refreshClock();
      const open = !!(clock && clock.is_open);
      const snap = await snapshot(src, sym);
      const gap = await gapBars(src, sym, lastDay, snap, open);
      const base = gap.length ? TL.extendSeries(hist, gap) : hist;
      const today = todayDay(), db = snap.dayBar;
      let bar = null;
      if (open) bar = db && db.day === today
        ? { t: today, o: db.o, h: Math.max(db.h, snap.last), l: Math.min(db.l, snap.last), c: snap.last, v: db.v }
        : { t: today, o: snap.last, h: snap.last, l: snap.last, c: snap.last, v: 0 };
      W = {
        sym, dest, src, strat, name: algo.name, base, bar, last: snap.last,
        lastTime: snap.lastTime ? new Date(snap.lastTime) : null,
        prevClose: open ? base.close[base.n - 1] : (snap.prevClose || base.close[Math.max(0, base.n - 2)]),
        busy: false, stream: null, timers: [],
      };
      $('wBody').classList.remove('hidden');
      $('wQSym').textContent = sym;
      setupWatchChart();
      log(`Started watching <b>${esc(sym)}</b> with <b>${esc(algo.name)}</b>. Live prices from <b>${src === 'finnhub' ? 'Finnhub' : 'Alpaca'}</b>; orders go to ${dest === 'alpaca' ? 'your <b>Alpaca practice account</b>' : 'the <b>pretend account</b> in this browser'}.`);
      if (!open) log(`The market is closed, so the robot won't trade. It shows what it would do based on the latest prices. ${clock && clock.next_open ? 'Opens ' + until(clock.next_open) + '.' : ''}`);
      if (gap.length) log(`Added ${gap.length} recent day${gap.length > 1 ? 's' : ''} that the nightly price file doesn't have yet${gap.some(g => g.approx) ? ' (one of them from its closing price only)' : ''}.`);
      if (JSON.stringify(strat).includes('"volRatio"') && src === 'finnhub') log('Note: this algorithm uses a volume rule, and Finnhub quotes don\'t include today\'s volume, so that rule may not trigger live.', 'err');
      if (dest === 'alpaca') await syncAlpacaPos();
      evaluate();
      if (open) {
        const status = (msg, ok) => log(esc(msg), ok ? '' : 'err');
        W.stream = src === 'finnhub' ? TLFinnhub.stream(fh.key, sym, onTrade, status) : TLAlpaca.stream(alp.key, alp.secret, sym, onTrade, status);
        W.timers.push(setInterval(pollPrice, src === 'finnhub' ? 10000 : 8000));
      } else W.timers.push(setInterval(pollPrice, 60000));
      if (dest === 'alpaca') W.timers.push(setInterval(() => { syncAlpacaPos(); refreshAccount(); }, 20000));
      W.timers.push(setInterval(evaluate, 2000));
      $('wStop').disabled = false;
    } catch (e) {
      log('Could not start: ' + esc(e.message), 'err');
      A.toast('Could not start: ' + e.message);
      W = null;
    } finally { $('wStart').disabled = false; }
  }
  function stopWatch(silent) {
    if (!W) return;
    if (W.stream) W.stream.close();
    W.timers.forEach(clearInterval);
    if (!silent) log('Stopped watching.');
    W = null;
    $('wStop').disabled = true;
  }

  function onTrade(tr) {
    if (!W) return;
    const p = tr.price;
    W.last = p; W.lastTime = new Date(tr.time);
    if (!W.bar) W.bar = { t: todayDay(), o: p, h: p, l: p, c: p, v: 0 };
    W.bar.c = p; if (p > W.bar.h) W.bar.h = p; if (p < W.bar.l) W.bar.l = p;
    W.dirty = true;
  }
  async function pollPrice() {
    if (!W) return;
    const open = !!(clock && clock.is_open);
    try {
      const snap = await snapshot(W.src, W.sym);
      if (open && snap.lastTime && (!W.lastTime || snap.lastTime > W.lastTime.getTime())) onTrade({ price: snap.last, time: snap.lastTime });
      if (W.bar && snap.dayBar && snap.dayBar.day === W.bar.t) { W.bar.h = Math.max(W.bar.h, snap.dayBar.h); W.bar.l = Math.min(W.bar.l, snap.dayBar.l); W.bar.o = snap.dayBar.o; }
    } catch (e) { /* try again next time */ }
  }

  let wChart = null, wSeries = null;
  function setupWatchChart() {
    if (!wChart) {
      wChart = makeChart($('wChart'), () => { if (wSeries) wSeries.applyOptions({ upColor: css('--bench'), downColor: css('--ink-2'), wickUpColor: css('--bench'), wickDownColor: css('--ink-2') }); });
      wSeries = wChart.chart.addCandlestickSeries({ upColor: css('--bench'), downColor: css('--ink-2'), borderVisible: false, wickUpColor: css('--bench'), wickDownColor: css('--ink-2'), priceLineVisible: true });
    }
    const b = W.base, from = Math.max(0, b.n - 180), data = [];
    for (let i = from; i < b.n; i++) data.push({ time: T(b.t[i]), open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i] });
    if (W.bar) data.push({ time: T(W.bar.t), open: W.bar.o, high: W.bar.h, low: W.bar.l, close: W.bar.c });
    wSeries.setData(data);
    wChart.chart.timeScale().fitContent();
    $('wLegend').innerHTML = `<span class="li"><i class="sw" style="color:${css('--ink-2')}"></i>${esc(W.sym)} daily prices, last 6 months${W.bar ? ' + today so far' : ''}</span>`;
  }

  function currentPosition() {
    if (!W) return null;
    if (W.dest === 'alpaca') return W.alpPos ? { entryDay: W.alpPos.entryDay, entryPrice: W.alpPos.entryPrice, peakHigh: W.alpPos.peakHigh, peakClose: W.alpPos.peakClose } : null;
    if (acct.shares > 0 && acct.sym === W.sym) return acct.pos;
    return null;
  }

  function evaluate() {
    if (!W) return;
    const series = W.bar ? TL.extendSeries(W.base, [W.bar]) : W.base;
    const pos = currentPosition();
    if (pos) { pos.peakHigh = Math.max(pos.peakHigh, W.last); pos.peakClose = Math.max(pos.peakClose, W.last); }
    const d = TL.decide(series, W.strat, pos);
    W.dirty = false;
    // quote
    const chg = (W.last / W.prevClose - 1) * 100;
    $('wQPx').textContent = fmt.price(W.last);
    $('wQChg').innerHTML = `<span class="${fmt.signClass(chg)}">${fmt.pct(chg, 2)}</span> <span class="muted">vs last close</span>`;
    $('wQTime').textContent = clock && clock.is_open
      ? (W.lastTime ? 'last trade ' + clockTime(W.lastTime) : '')
      : 'market closed' + (W.lastTime ? ' · price from ' + W.lastTime.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
    if (W.bar && wSeries) wSeries.update({ time: T(W.bar.t), open: W.bar.o, high: W.bar.h, low: W.bar.l, close: W.bar.c });
    // decision + rule checklist
    const open = clock && clock.is_open;
    const txt = { buy: 'BUY', sell: 'SELL', hold: pos ? 'HOLD' : 'WAIT' }[d.action];
    $('wDecision').innerHTML = `<div class="muted" style="font-size:12px;font-weight:600">${open ? 'The robot says, right now' : 'If the market closed at this price'}</div>
      <div class="big ${d.action}">${txt}</div><p>${d.action === 'buy' ? 'The buy rules are all met.' : d.action === 'sell' ? 'Reason: ' + esc(d.why) + '.' : pos ? 'Holding; no sell signal.' : 'Not every buy rule is met yet.'}</p>`;
    const line = (c) => `<li class="${c.ok ? 'ok' : ''}"><span class="mark">${c.ok ? '✓' : '·'}</span><span>${esc(c.text)}<span class="vals">${fmtVal(c.a)} vs ${fmtVal(c.b)}</span></span></li>`;
    $('wChecks').innerHTML = `<ul class="checks"><li class="grp">Buy when ${W.strat.buy.mode === 'any' ? 'any' : 'all'}</li>${d.buy.map(line).join('')}<li class="grp">Sell when ${W.strat.sell.mode === 'any' ? 'any' : 'all'}</li>${d.sell.map(line).join('') || '<li class="muted">No sell rules</li>'}</ul>`;
    renderWatchAccount();
    if (open) act(d);
  }
  const fmtVal = (x) => Number.isFinite(x) ? (Math.abs(x) >= 1000 ? x.toFixed(0) : x.toFixed(2)) : '–';

  async function act(d) {
    if (!W || W.busy) return;
    const key = nyDate() + ':' + W.sym + ':' + W.dest, done = (acct.acted[key] = acct.acted[key] || {});
    const pos = currentPosition();
    if (d.action === 'buy' && !pos && !done.buy) {
      if (W.dest === 'local' && acct.shares > 0 && acct.sym !== W.sym) return;
      done.buy = true; saveAcct();
      await (W.dest === 'alpaca' ? alpacaBuy(d) : localBuy(d));
    } else if (d.action === 'sell' && pos && !done.sell) {
      done.sell = true; saveAcct();
      await (W.dest === 'alpaca' ? alpacaSell(d) : localSell(d));
    }
  }

  function localBuy(d) {
    const fee = A.S.market.fee / 100, slip = A.S.market.slip / 100, px = W.last * (1 + slip);
    const cost = Math.min(acct.cash, watchBudget()) * d.risk.size;
    acct.shares = cost * (1 - fee) / px; acct.cash -= cost; acct.sym = W.sym;
    acct.pos = { entryDay: todayDay(), entryPrice: px, peakHigh: px, peakClose: px };
    acct.trades.unshift({ side: 'buy', sym: W.sym, px, shares: acct.shares, time: new Date().toISOString() });
    saveAcct();
    log(`<b>Bought</b> ${acct.shares.toFixed(3)} ${esc(W.sym)} at ${fmt.price(px)} (pretend account).`, 'buy');
  }
  function localSell(d) {
    const fee = A.S.market.fee / 100, slip = A.S.market.slip / 100, px = W.last * (1 - slip);
    const got = acct.shares * px * (1 - fee), ret = (px / acct.pos.entryPrice - 1) * 100;
    acct.cash += got;
    acct.trades.unshift({ side: 'sell', sym: W.sym, px, shares: acct.shares, why: d.why, ret, time: new Date().toISOString() });
    acct.shares = 0; acct.pos = null; acct.sym = null;
    saveAcct();
    log(`<b>Sold</b> ${esc(W.sym)} at ${fmt.price(px)} (${esc(d.why)}), ${fmt.pct(ret)} on the trade (pretend account).`, 'sell');
  }

  // Alpaca position, plus the entry details this browser remembers for it.
  const EKEY = 'tradinglab.alpEntries';
  const entries = () => { try { return JSON.parse(localStorage.getItem(EKEY) || '{}'); } catch (e) { return {}; } };
  const saveEntries = (x) => { try { localStorage.setItem(EKEY, JSON.stringify(x)); } catch (e) { /* ignore */ } };
  async function syncAlpacaPos() {
    if (!W || !alp) return;
    try {
      const p = await alp.position(W.sym), all = entries();
      if (!p) { if (W.alpPos && !W.justSold) log(`Alpaca shows no ${esc(W.sym)} position now (a stop-loss or take-profit order may have filled).`); W.justSold = false; W.alpPos = null; delete all[W.sym]; }
      else {
        const e = all[W.sym] || { entryDay: todayDay(), entryPrice: +p.avg_entry_price, peakHigh: +p.avg_entry_price, peakClose: +p.avg_entry_price };
        e.qty = +p.qty; e.entryPrice = +p.avg_entry_price; all[W.sym] = e; W.alpPos = e;
      }
      saveEntries(all);
    } catch (e) { log('Alpaca: ' + esc(e.message), 'err'); }
  }
  async function alpacaBuy(d) {
    W.busy = true;
    try {
      const a = await alp.account();
      const budget = Math.min(watchBudget() * d.risk.size, +a.cash);
      const qty = Math.floor(budget / W.last);
      if (qty < 1) { log(`Wanted to buy, but ${fmt.money(budget)} isn't enough for one share of ${esc(W.sym)}.`, 'err'); return; }
      const o = await TLAlpaca.buy(alp, W.sym, qty, W.last, d.risk);
      const all = entries(); all[W.sym] = { entryDay: todayDay(), entryPrice: W.last, peakHigh: W.last, peakClose: W.last, qty }; saveEntries(all);
      log(`<b>Sent buy order</b> to Alpaca: ${qty} ${esc(W.sym)} at market (~${fmt.price(W.last)})${o.order_class && o.order_class !== 'simple' ? ', with stop-loss/take-profit orders attached' : ''}.`, 'buy');
      setTimeout(() => { syncAlpacaPos(); refreshAccount(); }, 2500);
    } catch (e) { log('Alpaca refused the buy: ' + esc(e.message), 'err'); }
    finally { W && (W.busy = false); }
  }
  async function alpacaSell(d) {
    W.busy = true;
    try {
      await TLAlpaca.sellAll(alp, W.sym);
      W.justSold = true;
      log(`<b>Sent sell order</b> to Alpaca for all ${esc(W.sym)} (${esc(d.why)}).`, 'sell');
      setTimeout(() => { syncAlpacaPos(); refreshAccount(); }, 2500);
    } catch (e) { log('Alpaca refused the sell: ' + esc(e.message), 'err'); }
    finally { W && (W.busy = false); }
  }

  function renderWatchAccount() {
    const el = $('wAccount');
    if (!W) return;
    if (W.dest === 'alpaca') {
      const cap = `<p class="hint">Budget: the robot puts up to <b>${fmt.money(watchBudget())}</b> of your Alpaca practice money into each purchase.</p>`;
      el.innerHTML = cap + (W.alpPos ? `<div class="kv-grid"><div>Alpaca position<b>${W.alpPos.qty} sh</b></div><div>Bought at<b>${fmt.price(W.alpPos.entryPrice)}</b></div><div>Now<b class="${fmt.signClass(W.last - W.alpPos.entryPrice)}">${fmt.pct((W.last / W.alpPos.entryPrice - 1) * 100)}</b></div></div>` : `<p class="hint">No ${esc(W.sym)} position in your Alpaca practice account.</p>`);
      return;
    }
    const val = acct.cash + (acct.shares > 0 ? acct.shares * (acct.sym === W.sym ? W.last : acct.pos.entryPrice) : 0);
    el.innerHTML = `<div class="kv-grid"><div>Pretend account<b>${fmt.money(val)}</b></div><div>Cash<b>${fmt.money(acct.cash)}</b></div>
      <div>Holding<b>${acct.shares > 0 ? acct.shares.toFixed(2) + ' ' + esc(acct.sym) : 'nothing'}</b></div>
      <div>Since start<b class="${fmt.signClass(val - acct.start)}">${fmt.pct((val / acct.start - 1) * 100, 2)}</b></div></div>
      <p class="hint">Started with ${fmt.money(acct.start)}. Each purchase uses up to ${fmt.money(watchBudget())}${acct.start !== watchBudget() ? ' (press Reset pretend account to start over with your new budget)' : ''}.</p>
      ${acct.shares > 0 && acct.sym !== W.sym ? `<p class="warnline">The pretend account is holding ${esc(acct.sym)}, so it won't buy ${esc(W.sym)}. Watch ${esc(acct.sym)} or reset the account.</p>` : ''}`;
  }

  /* ---------- Alpaca account panel ---------- */
  async function refreshAccount() {
    const el = $('acctBody');
    if (!alp) return;
    try {
      const [a, pos, ord] = await Promise.all([alp.account(), alp.positions(), alp.orders('all', 15)]);
      const chg = +a.equity - +a.last_equity;
      el.innerHTML = `<div class="kv-grid">
        <div>Total value<b>${fmt.money(+a.equity)}</b></div>
        <div>Today<b class="${fmt.signClass(chg)}">${chg >= 0 ? '+' : '−'}${fmt.money(Math.abs(chg))}</b></div>
        <div>Cash<b>${fmt.money(+a.cash)}</b></div>
        <div>Buying power<b>${fmt.money(+a.buying_power)}</b></div></div>
        <h3 class="sub">Positions</h3><div id="acctPos"></div>
        <h3 class="sub">Recent orders</h3>
        ${ord.length ? `<div class="tbl-wrap"><table class="data"><thead><tr><th class="l">When</th><th class="l">Stock</th><th class="l">Side</th><th>Qty</th><th class="l">Type</th><th class="l">Status</th><th>Filled at</th></tr></thead><tbody>${ord.map(o => `<tr><td class="l">${new Date(o.submitted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td class="l">${esc(o.symbol)}</td><td class="l ${o.side === 'buy' ? 'up' : 'down'}">${o.side}</td><td>${o.qty || '–'}</td><td class="l">${esc(o.type)}${o.order_class && o.order_class !== 'simple' ? ' · ' + esc(o.order_class) : ''}</td><td class="l">${esc(o.status.replace(/_/g, ' '))}</td><td>${o.filled_avg_price ? fmt.price(+o.filled_avg_price) : '–'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">No orders yet.</p>'}`;
      const pe = $('acctPos');
      if (!pos.length) pe.innerHTML = '<p class="hint">No positions.</p>';
      else {
        const w = h('div', { class: 'tbl-wrap' }), t = h('table', { class: 'data' });
        t.innerHTML = '<thead><tr><th class="l">Stock</th><th>Shares</th><th>Bought at</th><th>Now</th><th>Value</th><th>Gain</th><th></th></tr></thead>';
        const tb = h('tbody');
        for (const p of pos) {
          const tr = h('tr');
          tr.innerHTML = `<td class="l">${esc(p.symbol)}</td><td>${p.qty}</td><td>${fmt.price(+p.avg_entry_price)}</td><td>${fmt.price(+p.current_price)}</td><td>${fmt.money(+p.market_value)}</td><td class="${fmt.signClass(+p.unrealized_pl)}">${fmt.pct(+p.unrealized_plpc * 100)}</td>`;
          const td = h('td');
          td.append(A.confirmBtn('Sell all', 'Sure?', async () => { try { await TLAlpaca.sellAll(alp, p.symbol); A.toast(`Sell order sent for ${p.symbol}.`); setTimeout(refreshAccount, 2000); } catch (e) { A.toast('Alpaca: ' + e.message); } }, 'btn sm danger'));
          tr.append(td); tb.append(tr);
        }
        t.append(tb); w.append(t); pe.innerHTML = ''; pe.append(w);
      }
      setAlpStatus(`Connected · practice account ${fmt.money(+a.equity)}`, 'ok');
    } catch (e) { el.innerHTML = `<p class="hint">Couldn't load the account: ${esc(e.message)}</p>`; }
  }

  /* ---------- 4. automatic daily bot ---------- */
  async function fetchRepoJSON(path) {
    try { const r = await fetch(REPO_RAW + path + '?t=' + Date.now()); if (r.ok) return await r.json(); } catch (e) { /* fall back */ }
    try { const r = await fetch(path + '?t=' + Date.now()); if (r.ok) return await r.json(); } catch (e) { /* none */ }
    return null;
  }
  // A bot's budget: a dollar amount, or a share of the account. Older settings used "allocation" (%).
  function budgetOf(bot) {
    if (bot.budget != null) return { amount: +bot.budget, unit: bot.budgetType === 'pct' ? 'pct' : 'usd' };
    return { amount: +bot.allocation || 0, unit: 'pct' };
  }
  const budgetText = (bot) => { const b = budgetOf(bot); return b.unit === 'pct' ? `up to ${b.amount}% of the account` : `up to ${fmt.money(b.amount)}`; };
  const botWhat = (x) => x.type === 'portfolio' ? `portfolio of ${x.strategy.assets.join(', ')}` : x.sym;
  function budgetField(bot) {
    const b = bot ? budgetOf(bot) : { amount: 5000, unit: 'usd' };
    const amount = h('input', { type: 'number', min: 1, step: 'any', value: b.amount, 'aria-label': 'Budget amount', style: 'width:110px' });
    const unit = h('select', { 'aria-label': 'Budget unit' }, h('option', { value: 'usd' }, 'dollars'), h('option', { value: 'pct' }, '% of the account'));
    unit.value = b.unit;
    return { el: h('span', { class: 'btns', style: 'gap:6px' }, h('span', { class: 'muted' }, 'budget up to'), amount, unit), get: () => ({ budget: +amount.value, budgetType: unit.value }) };
  }
  // Check budgets add up, then write the settings for live/bot.json.
  async function botSettingsOut(outEl, copyEl, bots, enabled) {
    if (bots.some(x => !(x.budget > 0))) { A.toast('Every budget needs to be more than zero.'); return; }
    const pfs = bots.filter(x => x.type === 'portfolio');
    if (pfs.length > 1) { A.toast('Use at most one portfolio bot: two portfolios would fight over the same funds.'); return; }
    const pfFunds = pfs.length ? [...pfs[0].strategy.assets, ...(pfs[0].strategy.safe && pfs[0].strategy.safe !== 'cash' ? [pfs[0].strategy.safe] : [])] : [];
    const syms = bots.filter(x => x.type !== 'portfolio').map(x => x.sym);
    if (new Set(syms).size !== syms.length) { A.toast('Each bot needs a different stock: two bots on one stock would fight over it.'); return; }
    const clash = syms.find(x => pfFunds.includes(x));
    if (clash) { A.toast(`${clash} is in both a stock bot and the portfolio bot. Pick one, so they don't fight over it.`); return; }
    const pct = bots.filter(x => x.budgetType === 'pct').reduce((t, x) => t + x.budget, 0);
    if (pct > 100) { A.toast(`The % budgets add up to ${pct}%. Keep the total at 100% or less.`); return; }
    const usd = bots.filter(x => x.budgetType === 'usd').reduce((t, x) => t + x.budget, 0);
    let warn = '';
    if (usd && alp) {
      try { const acctNow = await alp.account(); if (usd > +acctNow.equity) warn = `Heads up: the dollar budgets add up to ${fmt.money(usd)}, more than the ${fmt.money(+acctNow.equity)} in your Alpaca practice account. A bot that runs out of cash skips the purchase.`; } catch (e) { /* not important */ }
    }
    const cfg = { enabled, note: 'Made in the Trading Lab. Set enabled to false to pause the bot. Each budget is the most that bot puts into one purchase, in dollars (usd) or as a percent of the account (pct).', bots };
    outEl.value = JSON.stringify(cfg, null, 2);
    outEl.classList.remove('hidden'); copyEl.classList.remove('hidden');
    if (warn) A.toast(warn);
  }
  function copyButton(out) {
    const copy = h('button', { class: 'btn hidden' }, 'Copy');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(out.value); A.toast('Copied. Now paste it into live/bot.json on GitHub.'); } catch (e) { out.select(); A.toast('Press Ctrl/Cmd+C to copy.'); } };
    return copy;
  }
  const EDIT_URL = 'https://github.com/Just-Rice/trading-lab/edit/main/live/bot.json';

  async function renderBot() {
    const [cfg, logs] = await Promise.all([fetchRepoJSON('live/bot.json'), fetchRepoJSON('live/auto-log.json')]);
    const pill = $('botStatus'), body = $('botBody');
    const has = cfg && cfg.bots && cfg.bots.length, on = has && cfg.enabled;
    pill.className = 'pill ' + (on ? 'ok' : '');
    pill.textContent = on ? `On · ${cfg.bots.length} bot${cfg.bots.length > 1 ? 's' : ''}` : has ? 'Paused' : 'Off';
    body.innerHTML = '';
    if (has) {
      // Change the running bot's budgets (or pause it) without starting over.
      body.append(h('p', {}, h('b', {}, on ? 'Running: ' : 'Paused: '), cfg.bots.map(x => `${x.name} (${botWhat(x)}, ${budgetText(x)})`).join('; ') + '.'));
      const box = h('details', { class: 'setup' }, h('summary', {}, 'Change budgets or pause the bot'));
      const fields = cfg.bots.map(x => ({ x, f: budgetField(x) }));
      for (const { x, f } of fields) box.append(h('div', { class: 'bot-pick' }, h('b', { style: 'flex:1' }, `${x.name}`), f.el));
      const enabled = h('input', { type: 'checkbox' }); enabled.checked = !!cfg.enabled;
      box.append(h('label', { class: 'check', style: 'margin:10px 0' }, enabled, 'Bot switched on (untick to pause it; it keeps any shares it holds)'));
      const out = h('textarea', { class: 'json hidden', readonly: true, 'aria-label': 'Updated bot settings' }), copy = copyButton(out);
      const make = h('button', { class: 'btn primary' }, 'Make updated settings');
      make.onclick = () => botSettingsOut(out, copy, fields.map(({ x, f }) => { const { allocation, ...rest } = x; return { ...rest, ...f.get() }; }), enabled.checked);
      box.append(h('div', { class: 'btns', style: 'margin:10px 0' }, make, copy, h('a', { class: 'btn ghost', href: EDIT_URL, target: '_blank', rel: 'noopener' }, 'Open live/bot.json on GitHub ↗')), out,
        h('p', { class: 'hint' }, 'Copy the updated settings, open live/bot.json on GitHub, replace everything in it, and press Commit changes. The new budget applies from the bot\'s next purchase; shares it already holds are not resized.'));
      body.append(box);
    } else body.append(h('p', { class: 'hint' }, 'The bot is switched off. Follow the setup steps below to turn it on.'));
    const list = Array.isArray(logs) ? logs.slice(0, 40) : [];
    const logBox = h('div');
    logBox.innerHTML = '<h3 class="sub">What the bot did</h3>' + (list.length ? `<div class="tbl-wrap"><table class="data"><thead><tr><th class="l">When</th><th class="l">Bot</th><th class="l">Action</th><th>Qty</th><th>Price</th><th class="l">Why</th></tr></thead><tbody>${list.map(e => `<tr><td class="l">${new Date(e.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td class="l">${esc(e.name || '')} <span class="muted">${esc(e.sym || '')}</span></td><td class="l ${e.action === 'buy' ? 'up' : e.action === 'sell' || e.action === 'error' ? 'down' : ''}">${esc(e.action)}</td><td>${e.qty || ''}</td><td>${e.price ? fmt.price(e.price) : ''}</td><td class="l" style="white-space:normal;min-width:200px">${esc(e.why || e.note || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">No runs yet.</p>');
    body.append(logBox);
  }
  function renderBotMaker() {
    const el = $('botMaker');
    el.innerHTML = '';
    if (!A.S.forward.length) { el.append(h('p', { class: 'hint' }, 'First lock in at least one forward test (the bot runs forward tests, so their settings are frozen).')); return; }
    el.append(h('p', { class: 'hint' }, 'The budget is the most each bot puts into one purchase, in dollars or as a share of your Alpaca account. The strategy\'s "money per trade" setting then applies to that budget.'));
    const picks = [];
    for (const f of A.S.forward) {
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Include ' + f.name }), bf = budgetField(null);
      picks.push({ f, cb, bf });
      el.append(h('div', { class: 'bot-pick' }, h('label', { class: 'check', style: 'flex:1' }, cb, h('b', {}, f.name)), bf.el));
    }
    const out = h('textarea', { class: 'json hidden', readonly: true, 'aria-label': 'Bot settings' }), copy = copyButton(out);
    const make = h('button', { class: 'btn primary' }, 'Make bot settings');
    make.onclick = () => {
      const chosen = picks.filter(p => p.cb.checked);
      if (!chosen.length) { A.toast('Tick at least one forward test.'); return; }
      botSettingsOut(out, copy, chosen.map(p => p.f.kind === 'portfolio'
        ? { type: 'portfolio', name: p.f.name, ...p.bf.get(), strategy: p.f.strat }
        : { name: p.f.name, sym: p.f.sym, ...p.bf.get(), strategy: p.f.strat }), true);
    };
    el.append(h('div', { class: 'btns', style: 'margin:10px 0' }, make, copy), out);
  }

  /* ---------- boot ---------- */
  function boot() {
    initKeys(); initFinnhub(); pickDefaultSource(); initWatchBudget();
    if (acct.trades.length === 0 && acct.shares === 0 && acct.start !== watchBudget()) { acct = freshAcct(); saveAcct(); }
    $('wSrc').addEventListener('change', () => { $('wSrc').dataset.touched = '1'; });
    fillAlgoSelect(); fillSymSelect();
    $('wAlgo').onchange = () => { const a = chosenAlgo(); if (a && a.sym) $('wSym').value = a.sym; };
    $('wStart').onclick = startWatch;
    $('wStop').onclick = () => stopWatch();
    $('wReset').onclick = () => { acct = freshAcct(); saveAcct(); renderWatchAccount(); A.toast(`Pretend account reset to ${fmt.money(acct.start)}.`); };
    $('acctRefresh').onclick = () => alp ? refreshAccount() : A.toast('Connect your Alpaca key first.');
    const orig = document.querySelector('[data-tab=live]');
    orig.addEventListener('click', () => { renderForward(); renderBot(); fillAlgoSelect(); if (alp) refreshAccount(); refreshClock(); });
    if (A.S.tab === 'live') { renderForward(); renderBot(); }
    document.addEventListener('tl-forward', () => { fillAlgoSelect(); if (A.S.tab === 'live') renderForward(); else renderBotMaker(); });
    document.addEventListener('tl-strategies', fillAlgoSelect);
  }
  if (A.ready) boot(); else document.addEventListener('tl-ready', boot, { once: true });
})();
