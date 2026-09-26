/* Trading Lab app: state, data loading, and the Auto-tune, Build your own and Saved tabs. */
(function () {
  'use strict';
  const { Results, heatmap, lineChart, fmt, esc } = window.TLCharts;
  const { renderBody, dialsEditor, summary, h } = window.TLBuilder;
  const $ = (id) => document.getElementById(id);

  /* ---------- state ---------- */
  const KEY = 'tradinglab.v1';
  const DEFAULTS = {
    market: { sym: 'SPY', period: 'all', start: '', end: '', capital: 10000, fee: 0.05, slip: 0.05 },
    auto: { stratId: 'shield', strat: null, goal: 'sharpe', split: 70, budget: 1500, minTrades: 5 },
    edit: { strat: null, sourceId: 'trend' },
    pf: { stratId: 'pf-balanced', strat: null },
    custom: [], portfolios: [], setups: [], forward: [], tab: 'home',
  };
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; }
  S = Object.assign(TL.clone(DEFAULTS), S || {});
  for (const k of ['market', 'auto', 'edit', 'pf']) S[k] = Object.assign(TL.clone(DEFAULTS[k]), S[k] || {});
  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } }, 150);
  }

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- data ---------- */
  let manifest = { tickers: [] };
  const rawCache = new Map(), seriesCache = new Map();
  const metaOf = (sym) => manifest.tickers.find(t => t.s === sym);
  function loadRaw(sym) {
    if (!rawCache.has(sym)) {
      rawCache.set(sym, fetch(`data/${sym}.json?v=${encodeURIComponent(manifest.updated || '')}`).then(r => {
        if (!r.ok) throw new Error(`Couldn't load prices for ${sym}`);
        return r.json();
      }).catch(e => { rawCache.delete(sym); throw e; }));
    }
    return rawCache.get(sym);
  }
  async function loadSeries(sym) {
    if (!seriesCache.has(sym)) seriesCache.set(sym, TL.makeSeries(await loadRaw(sym), metaOf(sym)));
    return seriesCache.get(sym);
  }
  const isoToDay = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);

  // Portfolios: every fund they may hold, lined up on the S&P 500's trading days.
  const pfSyms = (st) => [...new Set(['SPY', 'IEF', ...(st.assets || []), ...(st.safe && st.safe !== 'cash' ? [st.safe] : [])])].filter(x => metaOf(x));
  const uniCache = new Map();
  async function loadUniverse(syms) {
    const list = [...new Set(['SPY', ...syms])].sort(), key = list.join(',');
    if (!uniCache.has(key)) {
      const series = await Promise.all(list.map(loadSeries)), map = {};
      list.forEach((x, k) => { map[x] = series[k]; });
      uniCache.set(key, TL.alignUniverse(map, 'SPY'));
    }
    return uniCache.get(key);
  }
  // The years to test, on the portfolio calendar; start once there is a year of history.
  // Start once every fund in the portfolio has a year of history, so early years aren't secretly all stocks.
  function pfRange(U, st, m = S.market) {
    const r = rangeFor(U.cal, m);
    if (!r) return null;
    let from = Math.max(r.from, TL.WARM);
    for (const sym of (st && st.assets) || []) {
      const idx = U.idx[sym]; if (!idx) continue;
      let i = from; while (i < U.cal.n && idx[i] < TL.WARM) i++;
      from = Math.max(from, i);
    }
    return r.to - from >= 60 ? { from, to: r.to } : null;
  }
  function pfBenchmarks(U, from, to, capital, fee, slip) {
    const spy = { type: 'portfolio', mode: 'fixed', assets: ['SPY'], weights: { SPY: 100 }, safe: 'cash', params: {} };
    const sixty = { type: 'portfolio', mode: 'fixed', assets: ['SPY', 'IEF'], weights: { SPY: 60, IEF: 40 }, safe: 'cash', params: {} };
    const o = { from, to, capital, fee, slip };
    return { spy: TL.backtestPortfolio(U, spy, o), sixty: TL.backtestPortfolio(U, sixty, o) };
  }

  function rangeFor(s, m = S.market) {
    let from = 0, to = s.n - 1;
    if (m.period === 'custom') {
      if (m.start) from = TL.indexOnOrAfter(s, isoToDay(m.start));
      if (m.end) to = Math.min(s.n - 1, TL.indexOnOrAfter(s, isoToDay(m.end) + 1) - 1);
    } else if (m.period !== 'all') {
      from = TL.indexOnOrAfter(s, s.t[to] - Math.round(+m.period * 365.25));
    }
    // Leave about a year of history first, so every rule's averages are ready on day one.
    from = Math.max(TL.WARM, from);
    if (to - from < 60) return null;
    return { from, to };
  }

  /* ---------- strategies ---------- */
  function allStrategies() { return [...TL.RECIPES, ...S.custom]; }
  function getStrategy(id) { return allStrategies().find(s => s.id === id); }
  function strategyOptions(sel, current) {
    sel.innerHTML = '';
    const g1 = h('optgroup', { label: 'Built-in' }), g2 = h('optgroup', { label: 'My algorithms' });
    TL.RECIPES.forEach(r => g1.append(h('option', { value: r.id }, r.name)));
    S.custom.forEach(r => g2.append(h('option', { value: r.id }, r.name)));
    sel.append(g1); if (S.custom.length) sel.append(g2);
    sel.value = getStrategy(current) ? current : 'shield';
  }

  /* ---------- theme + tabs ---------- */
  $('themeBtn').onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('tradinglab.theme', next); } catch (e) { /* ignore */ }
    TLCharts.restyleAll();
  };

  const tabHooks = {};
  function showTab(name) {
    S.tab = name; persist();
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + name));
    $('marketBar').classList.toggle('hidden', !(name === 'auto' || name === 'custom' || name === 'portfolio'));
    $('mSymWrap').classList.toggle('hidden', name === 'portfolio');
    if (tabHooks[name]) tabHooks[name]();
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); showTab(go.dataset.go); }
  });

  /* ---------- market bar ---------- */
  function initMarket() {
    const sel = $('mSym'), groups = {};
    manifest.tickers.forEach(t => (groups[t.g] = groups[t.g] || []).push(t));
    for (const [g, list] of Object.entries(groups)) {
      const og = h('optgroup', { label: g });
      list.forEach(t => og.append(h('option', { value: t.s }, `${t.s}: ${t.n}`)));
      sel.append(og);
    }
    const m = S.market;
    if (!metaOf(m.sym)) m.sym = 'SPY';
    sel.value = m.sym; $('mPeriod').value = m.period;
    $('mStart').value = m.start; $('mEnd').value = m.end;
    $('mCapital').value = m.capital; $('mFee').value = m.fee; $('mSlip').value = m.slip;
    const showCustom = () => { const c = m.period === 'custom'; $('mStartWrap').classList.toggle('hidden', !c); $('mEndWrap').classList.toggle('hidden', !c); };
    showCustom();
    const onChange = () => {
      m.sym = sel.value; m.period = $('mPeriod').value;
      if (m.period === 'custom' && !m.start) { const t = metaOf(m.sym); m.start = t.from; m.end = t.to; $('mStart').value = m.start; $('mEnd').value = m.end; }
      m.start = $('mStart').value; m.end = $('mEnd').value;
      m.capital = Math.max(100, +$('mCapital').value || 10000);
      m.fee = Math.max(0, +$('mFee').value || 0); m.slip = Math.max(0, +$('mSlip').value || 0);
      showCustom(); persist(); marketChanged();
    };
    ['mSym', 'mPeriod', 'mStart', 'mEnd', 'mCapital', 'mFee', 'mSlip'].forEach(id => $(id).addEventListener('change', onChange));
  }
  function marketChanged() {
    autoResult = null; renderExamEmpty();
    autoStale = true; customStale = true;
    if (S.tab === 'auto') refreshAuto(); else if (S.tab === 'custom') refreshCustom();
    document.dispatchEvent(new CustomEvent('tl-market'));
  }
  let autoStale = true, customStale = true;

  async function context(strat, extra) {
    const s = await loadSeries(S.market.sym);
    const r = rangeFor(s);
    if (!r) throw new Error('That period is too short. Pick at least three months of prices.');
    return { series: s, strat, from: r.from, to: r.to, capital: S.market.capital, fee: S.market.fee, slip: S.market.slip, ...extra };
  }

  /* ---------- AUTO-TUNE ---------- */
  const autoRes = new Results($('aResults'));
  let autoResult = null, autoView = null, worker = null;

  function initAuto() {
    const sel = $('aStrat');
    strategyOptions(sel, S.auto.stratId);
    if (!S.auto.strat || S.auto.strat.id !== S.auto.stratId) S.auto.strat = TL.clone(getStrategy(sel.value));
    sel.onchange = () => { S.auto.stratId = sel.value; S.auto.strat = TL.clone(getStrategy(sel.value)); persist(); autoResult = null; renderExamEmpty(); renderAutoControls(); refreshAuto(); };
    const goal = $('aGoal');
    for (const [k, g] of Object.entries(TL.GOALS)) goal.append(h('option', { value: k }, g.label));
    goal.value = S.auto.goal;
    goal.onchange = () => { S.auto.goal = goal.value; persist(); };
    $('aSplit').value = S.auto.split;
    $('aSplit').oninput = () => { S.auto.split = +$('aSplit').value; persist(); splitLabel(); debouncedAuto(); };
    $('aBudget').value = S.auto.budget; $('aBudget').onchange = () => { S.auto.budget = +$('aBudget').value; persist(); };
    $('aMinTrades').value = S.auto.minTrades; $('aMinTrades').onchange = () => { S.auto.minTrades = +$('aMinTrades').value; persist(); };
    $('aRun').onclick = runTuner;
    renderAutoControls();
  }
  function renderAutoControls() {
    const st = S.auto.strat;
    $('aStrat').value = S.auto.stratId;
    $('aDesc').textContent = st.desc || '';
    $('aRules').innerHTML = summary(st);
    dialsEditor($('aDials'), st, {
      onChange: () => { persist(); $('aRules').innerHTML = summary(st); autoView = null; debouncedAuto(); },
      editableLabels: false, allowDelete: false, rerender: renderAutoControls,
      emptyText: 'This strategy has no dials, so there is nothing to tune. Add dials to it in Build your own.',
    });
  }
  async function splitInfo() {
    const s = await loadSeries(S.market.sym), r = rangeFor(s);
    if (!r) return null;
    const splitIdx = r.from + Math.floor((r.to - r.from) * S.auto.split / 100);
    return { s, ...r, splitIdx };
  }
  async function splitLabel() {
    $('aSplitOut').textContent = S.auto.split + '%';
    const x = await splitInfo();
    $('aSplitDates').textContent = x ? `Tuning years: ${fmt.date(x.s.t[x.from])} – ${fmt.date(x.s.t[x.splitIdx - 1])}. Exam years: ${fmt.date(x.s.t[x.splitIdx])} – ${fmt.date(x.s.t[x.to])}.` : '';
  }
  async function refreshAuto() {
    autoStale = false;
    splitLabel();
    try {
      const x = await splitInfo();
      const strat = autoView ? autoView.strat : S.auto.strat;
      const ctx = await context(strat, { splitIdx: x && x.splitIdx, title: autoView ? autoView.title : strat.name });
      autoRes.render(ctx);
    } catch (e) { toast(e.message); }
  }
  const debouncedAuto = debounce(refreshAuto, 250);

  function renderExamEmpty() {
    const el = $('aExam');
    el.className = 'card exam hidden';
    el.innerHTML = '';
  }

  async function runTuner() {
    const st = S.auto.strat, tun = TL.tunables(st);
    if (!tun.length) { toast('Tick "Tune" on at least one dial first.'); return; }
    const x = await splitInfo();
    if (!x) { toast('That period is too short.'); return; }
    if (x.splitIdx - x.from < 250 || x.to - x.splitIdx < 120) { toast('Pick a longer period: the tuner needs at least a year to tune on and six months for the exam.'); return; }
    const raw = await loadRaw(S.market.sym);
    if (worker) worker.terminate();
    worker = new Worker('js/tuner-worker.js');
    const prog = $('aProgress'), bar = prog.querySelector('i'), label = prog.querySelector('span');
    prog.classList.remove('hidden'); bar.style.width = '0%'; label.textContent = 'Starting…';
    $('aRun').disabled = true;
    const t0 = performance.now();
    const snapshot = TL.clone(st), market = TL.clone(S.market), goal = S.auto.goal;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') { bar.style.width = (m.done / m.total * 100).toFixed(0) + '%'; label.textContent = `Tried ${m.done.toLocaleString()} of ${m.total.toLocaleString()}`; return; }
      if (m.type === 'done') {
        $('aRun').disabled = false; prog.classList.add('hidden');
        worker.terminate(); worker = null;
        autoResult = { ...m, strat: snapshot, market, goal, x, secs: (performance.now() - t0) / 1000, sel: 0 };
        renderExam();
        if (m.top.length) viewSettings(m.top[0].values, 'Best settings from the tuner');
      }
    };
    worker.onerror = (e) => { $('aRun').disabled = false; prog.classList.add('hidden'); toast('The tuner hit an error: ' + (e.message || 'unknown')); };
    worker.postMessage({
      type: 'tune', key: S.market.sym + ':' + raw.t[raw.t.length - 1], raw: { s: raw.s, t: raw.t, o: raw.o, h: raw.h, l: raw.l, c: raw.c, v: raw.v },
      strategy: snapshot, budget: S.auto.budget, goal, minTrades: S.auto.minTrades,
      capital: market.capital, fee: market.fee, slip: market.slip,
      trainFrom: x.from, trainTo: x.splitIdx - 1, testFrom: x.splitIdx, testTo: x.to,
    });
  }

  function valuesText(st, values) {
    return Object.entries(values).map(([k, v]) => `${st.params[k] ? st.params[k].label : k}: ${v}`).join(' · ');
  }

  function viewSettings(values, title) {
    const st = TL.withValues(autoResult ? autoResult.strat : S.auto.strat, values);
    autoView = { strat: st, values, title: `${title}: ${valuesText(st, values)}` };
    refreshAuto();
  }

  function renderExam() {
    const R = autoResult, el = $('aExam'), s = R.x.s, G = TL.GOALS[R.goal];
    el.className = 'card exam';
    if (!R.top.length) {
      el.innerHTML = `<p class="empty-note">None of the ${R.tried.toLocaleString()} settings made at least ${S.auto.minTrades} trades in the tuning years. Try a longer period, wider dial ranges, or lower the "Ignore settings with fewer than" option.</p>`;
      return;
    }
    const best = R.top[R.sel], cap = R.market.capital;
    const trainBH = TL.curveStats(TL.buyHoldCurve(s, R.x.from, R.x.splitIdx - 1, cap), best.train.years);
    const testBH = TL.curveStats(TL.buyHoldCurve(s, R.x.splitIdx, R.x.to, cap), best.test.years);
    const bhGoal = (st) => G.get(st);
    const beatBH = R.top.filter(r => r.test && G.get(r.test) > bhGoal(testBH)).length;
    let cls, title, text;
    if (best.test.cagr > 0 && G.get(best.test) >= bhGoal(testBH)) { cls = 'pass'; title = 'Passed the exam'; text = `On years it never saw, these settings made money and beat simply holding ${s.sym} on your goal (${G.short}).`; }
    else if (best.test.cagr > 0) { cls = 'meh'; title = 'Made money, but holding did better'; text = `On the exam years the robot grew ${fmt.pct(best.test.cagr)} a year, but just buying ${s.sym} and holding it scored better on ${G.short}.`; }
    else { cls = 'fail'; title = 'Failed the exam'; text = `It looked good on the tuning years but lost money on the years it hadn't seen. That usually means the settings memorized the past rather than finding something real.`; }
    const keep = best.score > 0 && Number.isFinite(best.testScore) ? ` It kept ${Math.round(best.testScore / best.score * 100)}% of its training score.` : '';
    const icon = { pass: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>', meh: '<path d="M12 8v5m0 3.5v.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>', fail: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' }[cls];
    const row = (label, a, b, fmtf, higher = true) => {
      const better = higher ? a > b : a < b;
      return `<tr><th>${label}</th><td class="${better ? 'up' : 'down'}">${fmtf(a)}</td><td>${fmtf(b)}</td></tr>`;
    };
    const col = (name, when, m, bh) => `<div class="exam-col"><h3>${name}</h3><div class="when">${when}</div>
      <table class="kv"><thead><tr><th></th><th>Robot</th><th>Just holding</th></tr></thead><tbody>
      ${row('Yearly growth', m.cagr, bh.cagr, fmt.pct)}
      ${row('Total return', m.totalReturn, bh.totalReturn, (x) => fmt.pct(x, 0))}
      ${row('Worst drop', m.maxDD, bh.maxDD, (x) => fmt.pctPlain(x), false)}
      ${row('Smoothness (Sharpe)', m.sharpe, bh.sharpe, fmt.num)}
      <tr><th>Trades</th><td>${m.trades}</td><td class="muted">1</td></tr>
      <tr><th>Winning trades</th><td>${fmt.pctPlain(m.winRate, 0)}</td><td class="muted">–</td></tr>
      </tbody></table></div>`;
    const tun = TL.tunables(R.strat);
    el.innerHTML = `
      <div class="verdict ${cls}"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
        <div><b>${title}</b><p>${text}${keep} ${beatBH} of the top ${R.top.length} settings beat buy &amp; hold in the exam.</p></div></div>
      <p class="hint">Settings shown: <b>${esc(valuesText(R.strat, best.values))}</b>${R.sel ? ` (number ${R.sel + 1} in training)` : ' (the best in training)'}. Tried ${R.tried.toLocaleString()} ${R.grid ? '(every combination)' : `of ${R.total.toLocaleString()} possible combinations, picked at random`} in ${R.secs.toFixed(1)}s.</p>
      <div class="exam-cols">
        ${col('Learning years', `${fmt.date(s.t[R.x.from])} – ${fmt.date(s.t[R.x.splitIdx - 1])} · the tuner could see these`, best.train, trainBH)}
        ${col('Exam years', `${fmt.date(s.t[R.x.splitIdx])} – ${fmt.date(s.t[R.x.to])} · never seen while tuning`, best.test, testBH)}
      </div>
      <div class="btn-row">
        <button class="btn primary" data-act="use">Use these settings</button>
        <button class="btn" data-act="open">Open in Build your own</button>
        <button class="btn" data-act="save">Save setup</button>
        <button class="btn" data-act="lock">Lock in forward test</button>
      </div>
      <details class="fold"><summary>Show every setting it tried, and the top 10</summary>
      <div class="exam-extra">
        <div><h3>Map of every setting tried</h3>
          <p class="hint" style="margin-top:0">Each square is one combination, colored by its training score. The ringed square is the winner. A broad bright area is a good sign. A single bright square among dark ones is probably luck.</p>
          <div class="heat-ctl" id="heatCtl"></div><div id="heat"></div></div>
        <div><h3>Top ${R.top.length} in training, and how each did in the exam</h3>
          <div class="tbl-wrap"><table class="data"><thead><tr><th>#</th><th class="l">Settings</th><th>Learning score</th><th>Exam score</th><th>Exam growth / yr</th></tr></thead><tbody>
          ${R.top.map((r, k) => `<tr class="pick${k === R.sel ? ' sel' : ''}" data-k="${k}"><td>${k + 1}</td><td class="l">${esc(tun.map(t => r.values[t.key]).join(' · '))}</td><td>${G.fmt(r.score)}</td><td class="${r.testScore > G.get(testBH) ? 'up' : 'down'}">${G.fmt(r.testScore)}</td><td class="${fmt.signClass(r.test.cagr)}">${fmt.pct(r.test.cagr)}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="hint">Columns in settings: ${esc(tun.map(t => t.label).join(' · '))}. Just holding's exam score: ${G.fmt(G.get(testBH))}. Click a row to view it.</p></div>
      </div></details>`;
    el.querySelectorAll('tr.pick').forEach(tr => tr.onclick = () => { R.sel = +tr.dataset.k; renderExam(); viewSettings(R.top[R.sel].values, `Number ${R.sel + 1} from the tuner`); });
    el.querySelector('[data-act=use]').onclick = () => {
      for (const [k, v] of Object.entries(best.values)) if (S.auto.strat.params[k]) S.auto.strat.params[k].v = v;
      persist(); renderAutoControls(); toast('Dials set to these values.');
    };
    el.querySelector('[data-act=open]').onclick = () => {
      const st = TL.withValues(R.strat, best.values);
      openInBuilder(st, st.builtin ? null : st.id);
    };
    el.querySelector('[data-act=save]').onclick = async () => saveSetup(await context(TL.withValues(R.strat, best.values)));
    el.querySelector('[data-act=lock]').onclick = async () => lockForward(await context(TL.withValues(R.strat, best.values)));
    renderHeat();
  }

  function renderHeat() {
    const R = autoResult, tun = TL.tunables(R.strat), ctl = $('heatCtl'), G = TL.GOALS[R.goal];
    if (!R.heat) R.heat = { x: tun[0] && tun[0].key, y: tun[1] ? tun[1].key : null };
    ctl.innerHTML = '';
    if (tun.length >= 2) {
      const mk = (which) => { const sel = h('select', { 'aria-label': which + ' axis' }); tun.forEach(t => sel.append(h('option', { value: t.key }, t.label))); sel.value = R.heat[which]; sel.onchange = () => { R.heat[which] = sel.value; renderHeat(); }; return sel; };
      ctl.append('Across:', mk('x'), 'Up:', mk('y'));
    }
    const xAx = R.axes.find(a => a.key === R.heat.x), yAx = R.heat.y ? R.axes.find(a => a.key === R.heat.y) : { key: null, vals: ['all'] };
    const cells = new Map();
    for (const r of R.all) {
      const k = r.values[xAx.key] + '|' + (yAx.key ? r.values[yAx.key] : 'all');
      const prev = cells.get(k);
      if (prev == null || r.score > prev || (!Number.isFinite(prev) && Number.isFinite(r.score))) cells.set(k, r.score);
    }
    const best = R.top[0];
    heatmap($('heat'), {
      xAxis: { key: xAx.key, label: R.strat.params[xAx.key].label, vals: xAx.vals },
      yAxis: { key: yAx.key, label: yAx.key ? R.strat.params[yAx.key].label : '', vals: yAx.vals },
      cells, fmt: G.fmt, best: best && { x: best.values[xAx.key], y: yAx.key ? best.values[yAx.key] : 'all' },
      onPick: (xv, yv) => {
        let pick = null;
        for (const r of R.all) if (r.values[xAx.key] === xv && (!yAx.key || r.values[yAx.key] === yv) && (!pick || r.score > pick.score)) pick = r;
        if (pick) viewSettings(pick.values, 'Picked from the map');
      },
    });
  }

  /* ---------- BUILD YOUR OWN ---------- */
  const customRes = new Results($('cResults'));
  function initCustom() {
    if (!S.edit.strat) {
      const st = TL.clone(TL.RECIPES[0]);
      delete st.builtin; st.name += ' (my version)'; st.id = 'c' + Date.now().toString(36);
      S.edit = { strat: st, sourceId: null };
    }
    renderBuilder();
  }
  function renderBuilder() {
    const el = $('builder'), st = S.edit.strat;
    el.innerHTML = '';
    const isCustom = S.custom.some(c => c.id === S.edit.sourceId);
    const open = h('select', { 'aria-label': 'Open a strategy' });
    open.append(h('option', { value: '' }, 'Open…'));
    const g1 = h('optgroup', { label: 'Start from a built-in' }); TL.RECIPES.forEach(r => g1.append(h('option', { value: 'r:' + r.id }, r.name)));
    open.append(g1);
    if (S.custom.length) { const g2 = h('optgroup', { label: 'My algorithms' }); S.custom.forEach(r => g2.append(h('option', { value: 'c:' + r.id }, r.name))); open.append(g2); }
    open.append(h('option', { value: 'blank' }, '＋ Blank algorithm'));
    open.onchange = () => {
      const v = open.value;
      if (v === 'blank') openInBuilder(TL.blankStrategy(), null);
      else if (v.startsWith('r:')) { const r = TL.clone(getStrategy(v.slice(2))); openInBuilder(r, null); }
      else if (v.startsWith('c:')) openInBuilder(TL.clone(getStrategy(v.slice(2))), v.slice(2));
    };
    const name = h('input', { value: st.name, 'aria-label': 'Algorithm name' });
    name.oninput = () => { st.name = name.value; persist(); };
    el.append(h('div', { class: 'b-head' },
      h('label', { class: 'fld' }, h('span', {}, 'Algorithm name'), name),
      h('label', { class: 'fld', style: 'flex:0 1 170px' }, h('span', {}, 'Open another'), open)));
    const status = h('p', { class: 'hint' }, isCustom ? 'Editing one of your saved algorithms. Changes are kept in this browser; press Save to update it.' : st.builtin ? `A copy of the built-in "${st.name}". Save it to keep your version.` : 'A new algorithm. Save it to keep it and use it in Auto-tune and Live.');
    el.append(status);
    el.append(h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: saveAlgorithm }, isCustom ? 'Save changes' : 'Save to My algorithms'),
      isCustom ? h('button', { class: 'btn', onclick: () => { S.edit.sourceId = null; saveAlgorithm(true); } }, 'Save as a copy') : null,
      isCustom ? confirmBtn('Delete', 'Really delete?', () => { S.custom = S.custom.filter(c => c.id !== S.edit.sourceId); S.edit.sourceId = null; persist(); renderBuilder(); refreshStrategyLists(); toast('Deleted.'); }) : null));
    const sum = h('div', { class: 'rules-plain', style: 'margin-top:12px' });
    sum.innerHTML = summary(st);
    el.append(sum);
    const body = h('div', {});
    el.append(body);
    renderBody(body, st, (quiet) => { persist(); sum.innerHTML = summary(st); if (!quiet) debouncedCustom(); });
    el.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: sendToTuner }, 'Send to the auto-tuner'),
      h('button', { class: 'btn', onclick: async () => saveSetup(await context(TL.clone(st))) }, 'Save setup'),
      h('button', { class: 'btn', onclick: async () => lockForward(await context(TL.clone(st))) }, 'Lock in forward test')));
  }
  function confirmBtn(label, ask, fn, cls = 'btn danger') {
    const b = h('button', { class: cls }, label);
    let armed = false, t;
    b.onclick = () => {
      if (armed) { clearTimeout(t); fn(); return; }
      armed = true; b.textContent = ask;
      t = setTimeout(() => { armed = false; b.textContent = label; }, 3000);
    };
    return b;
  }
  function openInBuilder(st, sourceId) {
    delete st.builtin;
    if (!sourceId && TL.RECIPES.some(r => r.id === st.id)) { st.name = st.name + ' (my version)'; st.id = 'c' + Date.now().toString(36); st.builtin = false; }
    S.edit = { strat: st, sourceId };
    persist();
    showTab('custom');
    renderBuilder();
    refreshCustom();
  }
  function saveAlgorithm(asCopy) {
    const st = TL.clone(S.edit.strat);
    delete st.builtin;
    const idx = S.custom.findIndex(c => c.id === S.edit.sourceId);
    if (idx >= 0 && !asCopy) { S.custom[idx] = st; toast('Saved.'); }
    else {
      st.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      if (asCopy === true) st.name += ' (copy)';
      S.custom.push(st); S.edit.sourceId = st.id; S.edit.strat.id = st.id; S.edit.strat.name = st.name;
      toast('Saved to My algorithms. It now appears in Auto-tune and Live.');
    }
    persist(); renderBuilder(); refreshStrategyLists();
  }
  function sendToTuner() {
    const st = TL.clone(S.edit.strat);
    if (!TL.tunables(st).length) { toast('Make at least one number a dial and tick "Tune" first.'); return; }
    if (!S.custom.some(c => c.id === S.edit.sourceId)) saveAlgorithm();
    S.auto.stratId = S.edit.sourceId; S.auto.strat = TL.clone(S.edit.strat);
    persist(); autoResult = null; autoView = null; renderExamEmpty();
    strategyOptions($('aStrat'), S.auto.stratId); renderAutoControls();
    showTab('auto');
  }
  async function refreshCustom() {
    customStale = false;
    try { customRes.render(await context(S.edit.strat, { title: S.edit.strat.name })); } catch (e) { toast(e.message); }
  }
  const debouncedCustom = debounce(refreshCustom, 250);
  function refreshStrategyLists() {
    strategyOptions($('aStrat'), S.auto.stratId);
    document.dispatchEvent(new CustomEvent('tl-strategies'));
  }

  /* ---------- setups + forward tests ---------- */
  function snapshotOf(ctx) {
    const res = TL.backtest(ctx.series, ctx.strat, ctx);
    const m = res.metrics;
    return {
      sym: ctx.series.sym, strat: TL.clone(ctx.strat),
      fromDay: ctx.series.t[res.from], toDay: ctx.series.t[res.to],
      capital: ctx.capital, fee: ctx.fee, slip: ctx.slip,
      metrics: { cagr: m.cagr, totalReturn: m.totalReturn, maxDD: m.maxDD, sharpe: m.sharpe, trades: m.trades, winRate: m.winRate, bhCagr: m.bhCagr, bhReturn: m.bhReturn },
    };
  }
  function saveSetup(ctx) {
    const snap = snapshotOf(ctx);
    S.setups.unshift({ id: 's' + Date.now().toString(36), name: `${ctx.strat.name} on ${snap.sym}`, savedAt: new Date().toISOString(), ...snap });
    persist(); toast('Setup saved. Find it in the Saved tab.');
  }
  function savePortfolioSetup(strat, U, r, bench) {
    const m = r.metrics, b = bench.spy.metrics;
    S.setups.unshift({
      id: 's' + Date.now().toString(36), kind: 'portfolio', name: strat.name, savedAt: new Date().toISOString(), sym: 'Portfolio',
      strat: TL.clone(strat), fromDay: U.cal.t[r.from], toDay: U.cal.t[r.to], capital: S.market.capital, fee: S.market.fee, slip: S.market.slip,
      metrics: { cagr: m.cagr, totalReturn: m.totalReturn, maxDD: m.maxDD, sharpe: m.sharpe, trades: m.trades, winRate: 0, bhCagr: b.cagr, bhReturn: b.totalReturn },
    });
    persist(); toast('Setup saved. Find it in the Saved tab.');
  }
  async function lockForwardPortfolio(strat, capital = S.market.capital, fee = S.market.fee, slip = S.market.slip) {
    const spy = await loadSeries('SPY'), lockedDay = spy.t[spy.n - 1];
    S.forward.unshift({
      id: 'f' + Date.now().toString(36), kind: 'portfolio', name: strat.name, sym: 'Portfolio', strat: TL.clone(strat),
      lockedDay, lockedAt: new Date().toISOString(), capital, fee, slip,
    });
    persist();
    toast(`Locked in. It will be scored on trading days after ${fmt.date(lockedDay)}. See Go live.`);
    document.dispatchEvent(new CustomEvent('tl-forward'));
  }
  function lockForward(ctx) {
    const s = ctx.series, lockedDay = s.t[s.n - 1];
    S.forward.unshift({
      id: 'f' + Date.now().toString(36), name: `${ctx.strat.name} on ${s.sym}`, sym: s.sym, strat: TL.clone(ctx.strat),
      lockedDay, lockedAt: new Date().toISOString(), capital: ctx.capital, fee: ctx.fee, slip: ctx.slip,
    });
    persist();
    toast(`Locked in. It will be scored on trading days after ${fmt.date(lockedDay)}. See Go live.`);
    document.dispatchEvent(new CustomEvent('tl-forward'));
  }

  /* ---------- SAVED ---------- */
  let compareChart = null, checked = new Set();
  function renderSaved() {
    const list = $('sList');
    checked = new Set([...checked].filter(id => S.setups.some(x => x.id === id)));
    if (!S.setups.length) list.innerHTML = '<p class="hint">Nothing saved yet. Use <b>Save setup</b> on the Stock bot, Portfolio bot or Build your own pages.</p>';
    else {
      const wrap = h('div', { class: 'tbl-wrap' });
      const tbl = h('table', { class: 'data' });
      tbl.innerHTML = `<thead><tr><th class="l">Compare</th><th class="l">Name</th><th class="l">What</th><th class="l">Years</th><th>Growth / yr</th><th>Just holding / yr</th><th>Worst drop</th><th>Smoothness</th><th>Trades</th><th></th></tr></thead>`;
      const tb = h('tbody');
      for (const x of S.setups) {
        const tr = h('tr', { class: 'save-row' });
        const cb = h('input', { type: 'checkbox', 'aria-label': 'Compare ' + x.name });
        cb.checked = checked.has(x.id);
        cb.onchange = () => { if (cb.checked) { if (checked.size >= 5) { cb.checked = false; toast('Compare up to five at a time.'); return; } checked.add(x.id); } else checked.delete(x.id); renderCompare(); };
        const nm = h('input', { value: x.name, 'aria-label': 'Setup name', style: 'min-width:180px;padding:4px 6px' });
        nm.onchange = () => { x.name = nm.value; persist(); renderCompare(); };
        const m = x.metrics;
        tr.append(h('td', { class: 'l' }, cb), h('td', { class: 'l' }, nm), h('td', { class: 'l' }, x.kind === 'portfolio' ? `Portfolio of ${x.strat.assets.length}` : x.sym), h('td', { class: 'l' }, `${fmt.year(x.fromDay)}–${fmt.year(x.toDay)}`));
        tr.insertAdjacentHTML('beforeend', `<td class="${fmt.signClass(m.cagr - m.bhCagr)}">${fmt.pct(m.cagr)}</td><td>${fmt.pct(m.bhCagr)}</td><td>${fmt.pctPlain(m.maxDD)}</td><td>${fmt.num(m.sharpe)}</td><td>${m.trades}</td>`);
        const acts = h('td', {}, h('div', { class: 'btns' },
          h('button', { class: 'btn sm', onclick: () => openSetup(x) }, 'Open'),
          h('button', { class: 'btn sm', onclick: async () => { if (x.kind === 'portfolio') return lockForwardPortfolio(x.strat, x.capital, x.fee, x.slip); const s = await loadSeries(x.sym); lockForward({ series: s, strat: x.strat, capital: x.capital, fee: x.fee, slip: x.slip }); } }, 'Forward test'),
          confirmBtn('Delete', 'Sure?', () => { S.setups = S.setups.filter(y => y.id !== x.id); persist(); renderSaved(); }, 'btn sm danger')));
        tr.append(acts); tb.append(tr);
      }
      tbl.append(tb); wrap.append(tbl);
      list.innerHTML = ''; list.append(wrap);
    }
    renderCompare();
    renderAlgos();
  }
  function openSetup(x) {
    Object.assign(S.market, { sym: x.kind === 'portfolio' ? S.market.sym : x.sym, period: 'custom', start: TL.dayToISO(x.fromDay), end: TL.dayToISO(x.toDay), capital: x.capital, fee: x.fee, slip: x.slip });
    $('mSym').value = S.market.sym; $('mPeriod').value = 'custom'; $('mStart').value = S.market.start; $('mEnd').value = S.market.end;
    $('mCapital').value = x.capital; $('mFee').value = x.fee; $('mSlip').value = x.slip;
    $('mStartWrap').classList.remove('hidden'); $('mEndWrap').classList.remove('hidden');
    const st = TL.clone(x.strat);
    persist(); autoStale = true; customStale = true;
    if (x.kind === 'portfolio') { document.dispatchEvent(new CustomEvent('tl-open-portfolio', { detail: st })); showTab('portfolio'); return; }
    openInBuilder(st, null);
  }
  async function renderCompare() {
    const card = $('sCompareCard');
    const picks = S.setups.filter(x => checked.has(x.id));
    card.classList.toggle('hidden', !picks.length);
    if (!picks.length) return;
    if (!compareChart) compareChart = lineChart($('sChart'), $('sLegend'));
    const lines = [], rows = [];
    for (const x of picks) {
      if (x.kind === 'portfolio') {
        const U = await loadUniverse(pfSyms(x.strat));
        const from = Math.max(TL.WARM, TL.indexOnOrAfter(U.cal, x.fromDay)), to = Math.min(U.cal.n - 1, TL.indexOnOrAfter(U.cal, x.toDay + 1) - 1);
        const res = TL.backtestPortfolio(U, x.strat, { from, to, capital: 10000, fee: x.fee, slip: x.slip });
        const bh = pfBenchmarks(U, from, to, 10000, x.fee, x.slip).spy.metrics;
        lines.push({ label: x.name, pts: Array.from(res.equity, (v, i) => ({ time: TLCharts.T(U.cal.t[from + i]), value: v })) });
        rows.push({ x, m: { ...res.metrics, bhCagr: bh.cagr, winRate: NaN } });
        continue;
      }
      const s = await loadSeries(x.sym);
      const from = Math.max(1, TL.indexOnOrAfter(s, x.fromDay)), to = Math.min(s.n - 1, TL.indexOnOrAfter(s, x.toDay + 1) - 1);
      const res = TL.backtest(s, x.strat, { from, to, capital: 10000, fee: x.fee, slip: x.slip });
      lines.push({ label: `${x.name}`, pts: Array.from(res.equity, (v, i) => ({ time: TLCharts.T(s.t[from + i]), value: v })) });
      rows.push({ x, m: res.metrics });
    }
    compareChart.set(lines);
    const r = (label, f) => `<tr><th class="l">${label}</th>${rows.map(y => `<td>${f(y.m, y.x)}</td>`).join('')}</tr>`;
    $('sTable').innerHTML = `<div class="tbl-wrap" style="margin-top:12px"><table class="data"><thead><tr><th class="l"></th>${rows.map(y => `<th>${esc(y.x.name)}</th>`).join('')}</tr></thead><tbody>
      ${r('What', (m, x) => x.kind === 'portfolio' ? esc(x.strat.assets.join(', ')) : x.sym)}${r('Years', (m, x) => `${fmt.year(x.fromDay)}–${fmt.year(x.toDay)}`)}
      ${r('$10,000 became', m => fmt.money(m.final))}${r('Growth per year', m => fmt.pct(m.cagr))}${r('Just holding / yr', m => fmt.pct(m.bhCagr))}
      ${r('Worst drop', m => fmt.pctPlain(m.maxDD))}${r('Smoothness (Sharpe)', m => fmt.num(m.sharpe))}${r('Trades', m => m.trades)}
      </tbody></table></div>`;
  }
  function renderAlgos() {
    const el = $('sAlgos');
    if (!S.custom.length && !S.portfolios.length) { el.innerHTML = '<p class="hint">None yet.</p>'; return; }
    el.innerHTML = '';
    for (const c of S.portfolios) {
      el.append(h('div', { class: 'bot-pick' }, h('b', { style: 'flex:1' }, c.name), h('span', { class: 'muted' }, `Portfolio · ${c.assets.join(', ')}`),
        h('button', { class: 'btn sm', onclick: () => { document.dispatchEvent(new CustomEvent('tl-open-portfolio', { detail: TL.clone(c) })); showTab('portfolio'); } }, 'Open'),
        confirmBtn('Delete', 'Sure?', () => { S.portfolios = S.portfolios.filter(x => x.id !== c.id); persist(); renderAlgos(); document.dispatchEvent(new CustomEvent('tl-strategies')); }, 'btn sm danger')));
    }
    for (const c of S.custom) {
      const row = h('div', { class: 'bot-pick' }, h('b', { style: 'flex:1' }, c.name), h('span', { class: 'muted' }, `${Object.keys(c.params).length} dials · ${c.buy.rules.length} buy / ${c.sell.rules.length} sell rules`),
        h('button', { class: 'btn sm', onclick: () => openInBuilder(TL.clone(c), c.id) }, 'Edit'),
        confirmBtn('Delete', 'Sure?', () => { S.custom = S.custom.filter(x => x.id !== c.id); persist(); renderAlgos(); refreshStrategyLists(); }, 'btn sm danger'));
      el.append(row);
    }
  }
  $('sExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'trading-lab', version: 2, custom: S.custom, portfolios: S.portfolios, setups: S.setups, forward: S.forward }, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `trading-lab-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
  };
  $('sImport').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const merge = (a, b) => { const ids = new Set(a.map(x => x.id)); return a.concat((b || []).filter(x => !ids.has(x.id))); };
      S.custom = merge(S.custom, d.custom); S.portfolios = merge(S.portfolios, d.portfolios); S.setups = merge(S.setups, d.setups); S.forward = merge(S.forward, d.forward);
      persist(); renderSaved(); refreshStrategyLists(); document.dispatchEvent(new CustomEvent('tl-forward'));
      toast('Imported.');
    } catch (err) { toast("That file couldn't be read."); }
    e.target.value = '';
  };

  /* ---------- boot ---------- */
  tabHooks.auto = () => { if (autoStale) refreshAuto(); };
  tabHooks.custom = () => { if (customStale) refreshCustom(); };
  tabHooks.saved = renderSaved;

  async function boot() {
    try {
      manifest = await (await fetch('data/manifest.json', { cache: 'no-cache' })).json();
    } catch (e) { $('dataStamp').textContent = "Couldn't load prices."; return; }
    const last = manifest.tickers.reduce((a, t) => t.to > a ? t.to : a, '');
    $('dataStamp').textContent = `Prices up to ${fmt.date(isoToDay(last))} · updated every weeknight`;
    initMarket(); initAuto(); initCustom();
    window.TLApp.ready = true;
    document.dispatchEvent(new CustomEvent('tl-ready'));
    showTab(S.tab || 'home');
  }

  tabHooks.portfolio = () => document.dispatchEvent(new CustomEvent('tl-show-portfolio'));
  window.TLApp = {
    S, persist, toast, loadSeries, loadRaw, metaOf, getStrategy, allStrategies, lockForward, lockForwardPortfolio, savePortfolioSetup, confirmBtn,
    loadUniverse, pfSyms, pfRange, pfBenchmarks, debounce, showTab, get manifest() { return manifest; }, isoToDay,
  };
  boot();
})();
