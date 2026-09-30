/* Portfolio bot tab: hold a mix of funds, or rotate between them, and test it fairly. */
(function () {
  'use strict';
  const A = window.TLApp;
  const { lineChart, luckPanel, fmt, esc, css, SLOTS, T } = window.TLCharts;
  const { h, dialsEditor } = window.TLBuilder;
  const $ = (id) => document.getElementById(id);
  const S = A.S;

  const FUND_GROUPS = ['Index funds', 'International', 'Bonds', 'Gold & commodities', 'Real estate', 'Sector funds', 'Leveraged funds', 'Long history (since 1926)'];
  const SAFE_CHOICES = [['SHY', 'Short-term bonds (SHY)'], ['BIL', 'Treasury bills (BIL)'], ['IEF', 'Medium-term bonds (IEF)'], ['AGG', 'Total bond market (AGG)'], ['cash', 'Cash (earns nothing)']];
  const MODES = {
    fixed: 'Fixed mix: always holds the same shares of each fund, topped back up every month.',
    trend: 'Trend-protected: like a fixed mix, but each fund steps aside into the safe fund while its price is below its long-term average.',
    momentum: 'Momentum rotation: each month, holds the funds that have risen most recently.',
    leverage: 'Boost with leverage: holds up to 2x the S&P 500 while it is trending up (a mix of the S&P 500 fund and a 2x fund), and T-bills when it is not.',
  };
  const allPf = () => [...TL.PORTFOLIOS, ...S.portfolios];
  const getPf = (id) => allPf().find(p => p.id === id);
  const nameOf = (sym) => { const m = A.metaOf(sym); return m ? m.n : sym; };

  let current = null, stale = true, pfResult = null, worker = null, chart = null, stripRedraw = null;

  /* ---------- controls ---------- */
  function fillSelect() {
    const sel = $('pStrat');
    sel.innerHTML = '';
    const g0 = h('optgroup', { label: 'Boost with leverage (riskier)' }), g1 = h('optgroup', { label: 'Mixes and rotation' });
    TL.PORTFOLIOS.forEach(p => (p.mode === 'leverage' ? g0 : g1).append(h('option', { value: p.id }, p.name)));
    sel.append(g1, g0);
    if (S.portfolios.length) { const g2 = h('optgroup', { label: 'My portfolios' }); S.portfolios.forEach(p => g2.append(h('option', { value: p.id }, p.name))); sel.append(g2); }
    sel.value = getPf(S.pf.stratId) ? S.pf.stratId : 'pf-balanced';
  }
  function useStrategy(st, id) {
    S.pf.stratId = id || st.id; S.pf.strat = TL.clone(st);
    A.persist(); pfResult = null; hideExam();
    fillSelect(); renderControls(); refresh();
  }

  function renderControls() {
    const st = S.pf.strat;
    $('pDesc').textContent = st.desc || describe(st);
    const ed = $('pEditor');
    ed.innerHTML = '';
    const changed = () => { st.desc = ''; $('pDesc').textContent = describe(st); A.persist(); pfResult = null; hideExam(); debouncedRefresh(); };

    const name = h('input', { value: st.name, 'aria-label': 'Portfolio name' });
    name.oninput = () => { st.name = name.value; A.persist(); };
    ed.append(h('label', { class: 'fld' }, h('span', {}, 'Name'), name));

    const mode = h('select', { 'aria-label': 'How it decides' }, ...Object.keys(MODES).map(k => h('option', { value: k }, { fixed: 'Fixed mix', trend: 'Trend-protected mix', momentum: 'Momentum rotation', leverage: 'Boost with leverage' }[k])));
    mode.value = st.mode;
    mode.onchange = () => {
      const prev = st.mode; st.mode = mode.value;
      if (st.mode === 'leverage' && prev !== 'leverage') Object.assign(st, TL.clone(TL.PORTFOLIOS.find(p => p.id === 'lev-gentle')), { id: st.id, name: st.name, builtin: st.builtin });
      else if (prev === 'leverage' && st.mode !== 'leverage') { st.assets = ['SPY', 'IEF', 'GLD']; st.weights = { SPY: 50, IEF: 35, GLD: 15 }; st.safe = 'SHY'; st.rebalance = 'monthly'; }
      if (st.mode !== 'momentum' && !st.weights) st.weights = {};
      changed(); renderControls();
    };
    ed.append(h('label', { class: 'fld' }, h('span', {}, 'How it decides'), mode), h('p', { class: 'hint' }, MODES[st.mode]));
    if (st.mode === 'leverage') { renderLeverage(ed, st, changed); return; }

    // Funds to choose from
    ed.append(h('h3', { class: 'sub' }, st.mode === 'momentum' ? 'Funds it can choose from' : 'Funds it holds'));
    const groups = h('div', { class: 'asset-groups' });
    const tickers = A.manifest.tickers;
    const addGroup = (label, list, note) => {
      const chips = h('div', { class: 'chips' });
      for (const t of list) {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = st.assets.includes(t.s);
        const chip = h('label', { class: 'chip' + (cb.checked ? ' on' : ''), title: t.n }, cb, t.s);
        cb.onchange = () => {
          if (cb.checked) { st.assets.push(t.s); if (st.weights && st.mode !== 'momentum') st.weights[t.s] = st.weights[t.s] || 10; }
          else { st.assets = st.assets.filter(x => x !== t.s); if (st.weights) delete st.weights[t.s]; }
          chip.classList.toggle('on', cb.checked); changed(); renderWeights();
        };
        chips.append(chip);
      }
      const g = h('div', { class: 'asset-group' }, h('h4', {}, label), chips);
      if (note) g.append(h('p', { class: 'warnline' }, note));
      return g;
    };
    for (const g of FUND_GROUPS) { const list = tickers.filter(t => t.g === g); if (list.length) groups.append(addGroup(g, list)); }
    const stocks = tickers.filter(t => !FUND_GROUPS.includes(t.g));
    const sd = h('details', { class: 'fold' }, h('summary', {}, `Individual stocks (${stocks.length})`));
    sd.append(addGroup('Stocks', stocks, 'Careful: these are today\'s big successful companies, so any test that includes them looks better than it would have in real time.'));
    groups.append(sd);
    ed.append(groups);

    // Weights for fixed and trend mixes
    const wbox = h('div', { class: 'weights', id: 'pWeights' });
    ed.append(wbox);
    function renderWeights() {
      wbox.innerHTML = '';
      if (st.mode === 'momentum') return;
      st.weights = st.weights || {};
      wbox.append(h('h3', { class: 'sub' }, 'How much of each (%)'));
      let total = 0;
      for (const sym of st.assets) {
        const inp = h('input', { type: 'number', min: 0, step: 5, value: st.weights[sym] != null ? st.weights[sym] : '', placeholder: 'equal', 'aria-label': 'Weight for ' + sym });
        inp.oninput = () => { const v = parseFloat(inp.value); if (Number.isFinite(v) && v >= 0) st.weights[sym] = v; else delete st.weights[sym]; totalEl.textContent = totalText(); changed(); };
        total += +st.weights[sym] || 0;
        wbox.append(h('div', { class: 'weight-row' }, h('span', {}, h('b', {}, sym), ' ', h('span', { class: 'muted' }, nameOf(sym))), inp));
      }
      const totalText = () => { const t = st.assets.reduce((a, x) => a + (+st.weights[x] || 0), 0); return t ? `Total ${t}%${Math.abs(t - 100) > 0.01 ? ' (scaled to 100% when it runs)' : ''}` : 'All blank: split evenly'; };
      const totalEl = h('span', { class: 'muted' }, totalText());
      wbox.append(h('div', { class: 'btns' }, totalEl, h('button', { class: 'btn sm', onclick: () => { st.assets.forEach(x => { st.weights[x] = +(100 / st.assets.length).toFixed(1); }); changed(); renderWeights(); } }, 'Split evenly')));
    }
    renderWeights();

    // Momentum and trend settings
    if (st.mode === 'momentum') {
      const topIn = h('input', { type: 'number', min: 1, max: 10, step: 1, value: TL.val(st, st.top), style: 'width:80px' });
      topIn.oninput = () => { const v = Math.round(+topIn.value); if (v >= 1) { setNum(st, 'top', v); changed(); } };
      const look = h('select', {}, h('option', { value: 'blend' }, 'Average of 1, 3, 6 and 12 months'), h('option', { value: '63' }, 'Last 3 months'), h('option', { value: '126' }, 'Last 6 months'), h('option', { value: '252' }, 'Last 12 months'));
      look.value = st.lookMode === 'blend' ? 'blend' : String(TL.val(st, st.look));
      if (![...look.options].some(o => o.value === look.value)) { look.append(h('option', { value: look.value }, `Last ${look.value} days`)); look.value = String(TL.val(st, st.look)); }
      look.onchange = () => { if (look.value === 'blend') st.lookMode = 'blend'; else { st.lookMode = 'single'; setNum(st, 'look', +look.value); } changed(); };
      const filt = h('select', {}, h('option', { value: 'none' }, 'No extra condition'), h('option', { value: 'positive' }, 'Only if it has been rising'), h('option', { value: 'beatsSafe' }, 'Only if it beat the safe fund'), h('option', { value: 'trend' }, 'Only if above its long-term average'));
      filt.value = st.absFilter || 'none';
      filt.onchange = () => { st.absFilter = filt.value; changed(); renderControls(); };
      ed.append(h('h3', { class: 'sub' }, 'Rotation rules'),
        h('label', { class: 'fld' }, h('span', {}, 'How many funds to hold at once'), topIn),
        h('label', { class: 'fld' }, h('span', {}, 'Rank funds by how much they rose over'), look),
        h('label', { class: 'fld' }, h('span', {}, 'Extra safety condition'), filt));
    }
    if (st.mode === 'trend' || (st.mode === 'momentum' && st.absFilter === 'trend')) {
      const f = h('input', { type: 'number', min: 20, max: 400, step: 10, value: TL.val(st, st.filter), style: 'width:90px' });
      f.oninput = () => { const v = Math.round(+f.value); if (v >= 20) { setNum(st, 'filter', v); changed(); } };
      ed.append(h('label', { class: 'fld' }, h('span', {}, 'Long-term average (days)'), f));
    }
    const safe = h('select', {}, ...SAFE_CHOICES.map(([v, l]) => h('option', { value: v }, l)));
    safe.value = st.safe || 'cash';
    safe.onchange = () => { st.safe = safe.value; changed(); };
    const reb = h('select', {}, h('option', { value: 'monthly' }, 'Every month'), h('option', { value: 'quarterly' }, 'Every 3 months'), h('option', { value: 'weekly' }, 'Every week'));
    reb.value = st.rebalance || 'monthly';
    reb.onchange = () => { st.rebalance = reb.value; changed(); };
    const more = h('details', { class: 'fold' }, h('summary', {}, 'More options'));
    if (st.mode !== 'fixed') {
      more.append(h('label', { class: 'fld' }, h('span', {}, 'Money it isn\'t using goes to'), safe));
      const wt = h('select', {}, h('option', { value: 'equal' }, 'Equal amounts'), h('option', { value: 'invvol' }, 'More in calmer funds'));
      wt.value = st.weighting || 'equal';
      wt.onchange = () => { st.weighting = wt.value; changed(); };
      more.append(h('label', { class: 'fld' }, h('span', {}, 'How to split the money'), wt));
    }
    more.append(h('label', { class: 'fld' }, h('span', {}, 'Rebalance'), reb));
    if (st.mode !== 'fixed') {
      more.append(h('p', { class: 'hint' }, 'Settings the tuner may change (tick to allow):'));
      const dials = h('div', { class: 'dials' });
      dialsEditor(dials, relevantDials(st), { onChange: () => { A.persist(); debouncedRefresh(); }, editableLabels: false, allowDelete: false, rerender: renderControls });
      more.append(dials);
    }
    ed.append(more);
  }
  // Settings for the leverage bots: how much boost, the trend switch, and optional volatility steering.
  function renderLeverage(ed, st, changed) {
    const num = (key, label, step, min, max) => {
      const i = h('input', { type: 'number', step, min, max, value: TL.val(st, st[key]), style: 'width:100px' });
      i.oninput = () => { const v = parseFloat(i.value); if (Number.isFinite(v) && v >= min && v <= max) { setNum(st, key, v); changed(); } };
      return h('label', { class: 'fld' }, h('span', {}, label), i);
    };
    const steer = h('select', {}, h('option', { value: 'trend' }, 'Fixed boost while the trend is up'), h('option', { value: 'vol' }, 'Steer by volatility: more when calm, less when wild'));
    steer.value = st.steer || 'trend';
    steer.onchange = () => { st.steer = steer.value; changed(); renderControls(); };
    const market = h('select', {}, h('option', { value: 'spy' }, 'S&P 500 funds (2001 to today)'), h('option', { value: 'long' }, 'Whole US market since 1926 (research data)'));
    market.value = st.base === 'USMKT' ? 'long' : 'spy';
    market.onchange = () => {
      if (market.value === 'long') Object.assign(st, { base: 'USMKT', lev: 'USMKT2X', safe: 'USTB', assets: ['USMKT', 'USMKT2X'] });
      else Object.assign(st, { base: 'SPY', lev: 'SSO', safe: 'BIL', assets: ['SPY', 'SSO'] });
      changed(); renderControls();
    };
    ed.append(h('label', { class: 'fld' }, h('span', {}, 'Test it on'), market),
      h('p', { class: 'hint' }, market.value === 'long' ? 'Runs on the whole US stock market back to 1926, with a simulated 2x version and T-bills. Use the "Years to test" menu to pick eras like the Great Depression. It only has one price a day, so the crash trigger can only react at the close. The daily bot can\'t trade these: switch back to the S&P 500 funds for live use.' : 'Uses the real S&P 500 fund (SPY), a 2x fund (SSO) and a T-bill fund (BIL).'));
    ed.append(h('p', { class: 'warnline' }, 'Leverage multiplies gains and losses. A sudden one-day crash can hit before the trend switch reacts: on Black Monday 1987 a 2x version lost about 35% in a day.'));
    ed.append(h('label', { class: 'fld' }, h('span', {}, 'How it sizes the boost'), steer));
    if (st.steer === 'vol') {
      ed.append(num('tv', 'Aim for this yearly volatility (%)', 1, 5, 40), num('cap', 'Most boost allowed (x, up to 2)', 0.25, 1, 2), num('volDays', 'Volatility lookback (days)', 5, 5, 120));
    } else ed.append(num('boost', 'Boost: how many times the S&P 500 (1 to 2)', 0.25, 1, 2));
    ed.append(num('trendDays', 'Trend average (days)', 25, 20, 400), num('band', 'Buffer around the average (%)', 1, 0, 10));
    // Crash trigger
    const g = TL.val(st, st.guard) || 0;
    const gOn = h('input', { type: 'checkbox' }); gOn.checked = g > 0;
    gOn.onchange = () => { setNum(st, 'guard', gOn.checked ? 6 : 0); changed(); renderControls(); };
    ed.append(h('h3', { class: 'sub' }, 'Crash trigger'), h('label', { class: 'check' }, gOn, 'Sell straight away if the S&P 500 falls sharply during a day'));
    ed.append(h('p', { class: 'hint' }, 'The trend switch only checks closing prices, so a sudden crash can hit first. The trigger sells the stock positions the moment the price is a set % below the previous close. It helped hugely on Black Monday 1987 and in March 2020, but on 6 May 2010 (the "Flash Crash") it sold at the bottom of a 10% plunge that recovered within minutes. It is off by default because the evidence is mixed.'));
    if (g > 0) ed.append(num('guard', 'Trigger when it falls this much in a day (%)', 1, 1, 15), num('cool', 'Then wait this many days before boosting again', 5, 0, 60));
    ed.append(h('p', { class: 'hint' }, 'It checks every day. It holds the boost while the S&P 500 is above its average by more than the buffer, and moves to T-bills (BIL) once it falls below by more than the buffer.'));
    const more = h('details', { class: 'fold' }, h('summary', {}, 'Settings the tuner may change'));
    const dials = h('div', { class: 'dials' });
    dialsEditor(dials, relevantDials(st), { onChange: () => { A.persist(); debouncedRefresh(); }, editableLabels: false, allowDelete: false, rerender: renderControls });
    more.append(dials); ed.append(more);
  }
  // Numbers in the rotation rules live in dials, so the tuner can use them too.
  function setNum(st, key, v) {
    st.params = st.params || {};
    if (!st.params[key]) st.params[key] = { label: key, v, min: v, max: v, step: 1, tune: false };
    st.params[key].v = v;
    st[key] = { p: key };
  }
  // A view of the strategy whose params list only the dials this mode actually uses.
  function relevantDials(st) {
    const keys = st.mode === 'leverage' ? (st.steer === 'vol' ? ['tv', 'cap', 'trendDays', 'band'] : ['boost', 'trendDays', 'band'])
      : st.mode === 'trend' ? ['filter'] : ['top', ...(st.lookMode === 'single' ? ['look'] : []), ...(st.absFilter === 'trend' ? ['filter'] : [])];
    const view = Object.create(st);
    view.params = {};
    for (const k of keys) if (st.params && st.params[k]) view.params[k] = st.params[k];
    return view;
  }
  function describe(st) {
    if (st.mode === 'leverage') return st.steer === 'vol'
      ? `While the S&P 500 is above its ${TL.val(st, st.trendDays)}-day average, holds up to ${TL.val(st, st.cap)}x, aiming for ${TL.val(st, st.tv)}% yearly volatility; T-bills otherwise.`
      : `Holds ${TL.val(st, st.boost)}x the S&P 500 while it is above its ${TL.val(st, st.trendDays)}-day average; T-bills otherwise.`;
    if (st.mode === 'momentum') return `Each ${st.rebalance === 'weekly' ? 'week' : st.rebalance === 'quarterly' ? 'quarter' : 'month'}, holds the top ${TL.val(st, st.top)} of ${st.assets.join(', ')} by recent gains.`;
    const w = st.weights || {}, tot = st.assets.reduce((a, x) => a + (+w[x] || 0), 0);
    const parts = st.assets.map(x => `${tot ? Math.round((+w[x] || 0) / tot * 100) : Math.round(100 / st.assets.length)}% ${x}`);
    return (st.mode === 'trend' ? 'Trend-protected mix: ' : 'Fixed mix: ') + parts.join(', ') + '.';
  }

  /* ---------- results ---------- */
  function colorFor(st, sym) {
    if (sym === 'cash') return css('--surface-3');
    const k = st.assets.indexOf(sym);
    if (k >= 0 && k < SLOTS.length) return css(SLOTS[k]);
    if (sym === st.safe) return css('--bench');
    return css('--muted');
  }
  async function refresh() {
    stale = false;
    const st = S.pf.strat;
    if (!st.assets.length) { $('pResults').innerHTML = '<div class="card"><p class="hint">Pick at least one fund.</p></div>'; return; }
    try {
      const U = await A.loadUniverse(A.pfSyms(st));
      const r = A.pfRange(U, st);
      if (!r) throw new Error('That period is too short for this portfolio. Pick more years, or funds with a longer history.');
      const opt = { ...r, capital: S.market.capital, fee: S.market.fee, slip: S.market.slip, tax: A.taxRates() };
      const res = TL.backtestPortfolio(U, st, opt);
      const bench = A.pfBenchmarks(U, res.from, res.to, opt.capital, opt.fee, opt.slip);
      current = { U, res, bench, st };
      renderResults();
    } catch (e) { A.toast(e.message); }
  }
  const debouncedRefresh = A.debounce(refresh, 300);

  function renderResults() {
    const { U, res, bench, st } = current, m = res.metrics, b = bench.spy.metrics, c6 = bench.sixty ? bench.sixty.metrics : null, cap = S.market.capital;
    const BN = bench.label === 'the US market' ? 'US market' : 'S&amp;P 500';
    const el = $('pResults');
    const splitNote = pfResult ? ' The shaded part of the chart is the exam years.' : '';
    el.innerHTML = `<div class="card results">
      <div class="res-head"><h2>${esc(st.name)}</h2><span class="sub">${fmt.date(U.cal.t[res.from])} – ${fmt.date(U.cal.t[res.to])} · ${m.years.toFixed(1)} years</span></div>
      ${lateStart(st, U, res.from)}${simNote(st)}
      <p class="summary-line">Over ${m.years.toFixed(0)} years, this portfolio turned ${fmt.money(cap)} into <b class="${m.final >= b.final ? 'up' : 'down'}">${fmt.money(m.final)}</b>. Just holding ${esc(bench.label)} would have made ${fmt.money(b.final)}${c6 ? `, and a classic 60/40 mix ${fmt.money(c6.final)}` : ''}. Its worst drop was ${fmt.pctPlain(m.maxDD, 0)} (${BN}: ${fmt.pctPlain(b.maxDD, 0)}).${S.market.tax && S.market.tax.on ? ` <span class="muted">All figures are after estimated tax.</span>` : ''}</p>
      <div class="tiles main">
        ${tile('Money at the end', fmt.money(m.final), `${BN}: ${fmt.money(b.final)}`, m.final >= b.final)}
        ${tile('Growth per year', fmt.pct(m.cagr), `${BN}: ${fmt.pct(b.cagr)}`, m.cagr >= b.cagr)}
        ${tile('Worst drop', fmt.pctPlain(m.maxDD), `${BN}: ${fmt.pctPlain(b.maxDD)}`, m.maxDD <= b.maxDD)}
      </div>
      <details class="fold more-numbers"><summary>More numbers</summary><div class="tiles">
        ${tile('Smoothness (Sharpe ratio)', fmt.num(m.sharpe), `${BN}: ${fmt.num(b.sharpe)}${c6 ? ` · 60/40: ${fmt.num(c6.sharpe)}` : ''}`, m.sharpe >= b.sharpe)}
        ${c6 ? tile('60/40 mix, per year', fmt.pct(c6.cagr), `Worst drop ${fmt.pctPlain(c6.maxDD)}`, null) : ''}
        ${m.taxPaid ? tile('Estimated tax paid', fmt.money(m.taxPaid), `${BN} (sold at the end): ${fmt.money(b.taxPaid)}`, m.taxPaid <= b.taxPaid) : ''}
        ${tile('Orders placed', String(m.trades), `About ${(m.trades / m.years).toFixed(0)} a year`, null)}
        ${tile('Money traded per year', fmt.pctPlain(m.turnover, 0), 'Of the starting money', null)}
        ${st.mode === 'leverage' && (TL.val(st, st.guard) || 0) > 0 ? tile('Crash trigger fired', String(m.guardHits), 'Times it sold during a sharp fall', null) : ''}
      </div></details>
      <div class="chart-label">Your money vs ${c6 ? 'the S&amp;P 500 and a 60/40 mix' : 'the whole US market'}</div>
      <div class="legend" id="pLegend"></div>
      <div class="chart chart-md" id="pChart"></div>
      <div class="chart-label">What it held over time</div>
      <div class="legend" id="pStripLegend"></div>
      <div class="heat-wrap"><canvas class="alloc-strip" id="pStrip" height="120"></canvas><div class="tip hidden" id="pTip"></div></div>
      <div class="chart-label">What it would hold now</div>
      <div class="holdings" id="pNow"></div>
      <p class="hint" id="pNowNote"></p>
      <details class="fold"><summary>Every rebalance</summary><div class="tbl-wrap" id="pLog"></div></details>
      <div id="pLuck"></div>
      ${splitNote ? `<p class="hint">${splitNote}</p>` : ''}
    </div>`;
    // money chart
    if (chart) chart.dispose();
    chart = lineChart($('pChart'), $('pLegend'));
    const pts = (eq) => Array.from(eq, (v, i) => ({ time: T(U.cal.t[res.from + i]), value: v }));
    chart.set([{ label: st.name, pts: pts(res.equity), color: '--s1' }, { label: c6 ? 'S&P 500 only' : 'US market only', pts: pts(bench.spy.equity), color: '--bench', dash: true }, ...(c6 ? [{ label: '60/40 mix', pts: pts(bench.sixty.equity), color: '--s2' }] : [])]);
    drawStrip();
    luckPanel($('pLuck'), async () => {
      const raws = {}, bsym = U.calSym === 'USMKT' ? 'USMKT' : 'SPY';
      const need = [...new Set([U.calSym || 'SPY', bsym, ...st.assets, ...(st.safe && st.safe !== 'cash' ? [st.safe] : [])])];
      for (const sym of need) { const raw = await A.loadRaw(sym); raws[sym] = { s: raw.s, t: raw.t, o: raw.o, h: raw.h, l: raw.l, c: raw.c, v: raw.v }; }
      return { kind: 'portfolio', raws, calSym: U.calSym || 'SPY', strategy: st, bench: { type: 'portfolio', mode: 'fixed', assets: [bsym], weights: { [bsym]: 100 }, safe: 'cash', params: {} },
        opt: { from: res.from, to: res.to, capital: S.market.capital, fee: S.market.fee, slip: S.market.slip, tax: A.taxRates() } };
    });
    // current holdings
    const now = TL.decidePortfolio(U, st).weights;
    const syms = Object.keys(now).filter(x => now[x] > 0.0001).sort((a, c) => now[c] - now[a]);
    $('pNow').innerHTML = syms.map(x => `<div class="holding"><span class="sw" style="background:${colorFor(st, x)}"></span><span>${x === 'cash' ? 'Cash' : esc(x)}</span><b>${(now[x] * 100).toFixed(0)}%</b></div>`).join('');
    $('pNowNote').textContent = `Based on prices up to ${fmt.date(U.cal.t[U.cal.n - 1])}. ${st.mode === 'fixed' ? 'A fixed mix only tops these back up.' : 'This can change at the next rebalance.'} ${st.rebalance === 'daily' ? 'It checks every day and trades only when the mix needs to change.' : st.rebalance === 'weekly' ? 'It rebalances every week.' : `It rebalances at the start of each ${st.rebalance === 'quarterly' ? 'quarter' : 'month'}.`}`;
    // rebalance log
    const rows = res.rebal.slice().reverse().slice(0, 400).map(r => {
      const w = Object.entries(r.weights).filter(([, v]) => v > 0.0001).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k === 'cash' ? 'Cash' : k} ${(v * 100).toFixed(0)}%`).join(', ');
      return `<tr><td class="l">${fmt.date(U.cal.t[r.i])}</td><td class="l" style="white-space:normal">${esc(w)}</td></tr>`;
    }).join('');
    $('pLog').innerHTML = `<table class="data"><thead><tr><th class="l">Decided on</th><th class="l">Holds (from the next morning)</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  // Say plainly which parts of the history are simulated.
  function simNote(st) {
    const sims = A.pfSyms(st).map(A.metaOf).filter(m => m && m.simUntil && st.assets.concat(st.safe || []).includes(m.s));
    if (!sims.length) return '';
    return `<p class="hint">Simulated history: ${sims.map(m => `${esc(m.s)} before ${fmt.date(A.isoToDay(m.simUntil))}`).join(', ')}. That part is built from the S&amp;P 500 fund and T-bill rates, with the real fund's costs.</p>`;
  }
  // Explain a late start caused by a fund with a short history.
  function lateStart(st, U, from) {
    const r = A.pfRange(U, { assets: [] });
    if (!r || from <= r.from + 5) return '';
    const late = st.assets.map(x => ({ x, i: U.idx[x] ? U.idx[x].findIndex(j => j >= TL.WARM) : -1 })).sort((a, b) => b.i - a.i)[0];
    return `<p class="hint">Starts in ${new Date(U.cal.t[from] * 864e5).getUTCFullYear()}, once every fund has a year of history. The newest fund is ${esc(late.x)} (${esc(nameOf(late.x))}).</p>`;
  }
  const tile = (l, v, c, better) => `<div class="tile"><div class="lab">${l}</div><div class="val">${v}</div><div class="cmp">${c}${better == null ? '' : better ? ' · <span class="up">▲ ahead</span>' : ' · <span class="down">▼ behind</span>'}</div></div>`;

  // Stacked bar of holdings between rebalances.
  function drawStrip() {
    const { U, res, st } = current, cv = $('pStrip'), tip = $('pTip');
    const syms = [...new Set(res.rebal.flatMap(r => Object.keys(r.weights).filter(k => r.weights[k] > 0.0001)))];
    const order = [...st.assets.filter(x => syms.includes(x)), ...syms.filter(x => !st.assets.includes(x) && x !== 'cash'), ...(syms.includes('cash') ? ['cash'] : [])];
    $('pStripLegend').innerHTML = order.map(x => `<span class="li"><i class="sw" style="color:${colorFor(st, x)};height:10px;width:10px;border-radius:2px"></i>${x === 'cash' ? 'Cash' : esc(x)}</span>`).join('');
    const draw = () => {
      const W = cv.clientWidth || 600, H = 120, dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr; cv.height = (H + 18) * dpr; cv.style.height = (H + 18) + 'px';
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H + 18);
      const span = res.to - res.from + 1, x = (i) => (i - res.from) / span * W;
      res.rebal.forEach((r, k) => {
        const x0 = x(r.i + 1), x1 = k + 1 < res.rebal.length ? x(res.rebal[k + 1].i + 1) : W;
        let y = 0;
        for (const sym of order) {
          const w = r.weights[sym] || 0; if (w <= 0) continue;
          g.fillStyle = colorFor(st, sym); g.fillRect(x0, y, Math.max(1, x1 - x0), w * H); y += w * H;
        }
      });
      g.fillStyle = css('--muted'); g.font = '11px system-ui, sans-serif'; g.textBaseline = 'top';
      let lastYear = null, lastX = -99;
      for (let i = res.from; i <= res.to; i++) {
        const yr = new Date(U.cal.t[i] * 864e5).getUTCFullYear();
        if (yr !== lastYear) { const px = x(i); if (px - lastX > 34) { g.fillText(String(yr), px + 2, H + 4); lastX = px; } lastYear = yr; }
      }
    };
    draw();
    cv.onmousemove = (ev) => {
      const rect = cv.getBoundingClientRect(), px = ev.clientX - rect.left, i = res.from + Math.floor(px / rect.width * (res.to - res.from + 1));
      let r = null; for (const x2 of res.rebal) if (x2.i + 1 <= i) r = x2;
      if (!r) { tip.classList.add('hidden'); return; }
      tip.innerHTML = `<b>${fmt.date(U.cal.t[Math.min(i, res.to)])}</b><br>` + Object.entries(r.weights).filter(([, v]) => v > 0.0001).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k === 'cash' ? 'Cash' : esc(k)}: ${(v * 100).toFixed(0)}%`).join('<br>');
      tip.classList.remove('hidden');
      tip.style.left = Math.min(px + 12, rect.width - tip.offsetWidth - 4) + 'px'; tip.style.top = '4px';
    };
    cv.onmouseleave = () => tip.classList.add('hidden');
    if (stripRedraw) window.removeEventListener('resize', stripRedraw);
    stripRedraw = draw; window.addEventListener('resize', draw);
    document.addEventListener('tl-theme', draw, { once: true });
  }

  /* ---------- tuner + exam ---------- */
  function hideExam() { const el = $('pExam'); el.className = 'card exam hidden'; el.innerHTML = ''; }
  async function runTuner() {
    const st = S.pf.strat;
    if (st.mode === 'fixed') { A.toast('A fixed mix has no settings to tune. Switch "How it decides" to another option, or change the mix yourself.'); return; }
    const view = relevantDials(st);
    if (!Object.values(view.params).some(d => d.tune)) { A.toast('Tick at least one setting under "More options" for the tuner to change.'); return; }
    const U = await A.loadUniverse(A.pfSyms(st)), r = A.pfRange(U, st);
    if (!r || r.to - r.from < 500) { A.toast('Pick more years: the tuner needs at least two years.'); return; }
    const split = r.from + Math.floor((r.to - r.from) * S.auto.split / 100);
    const syms = A.pfSyms(st), raws = {};
    for (const x of syms) { const raw = await A.loadRaw(x); raws[x] = { s: raw.s, t: raw.t, o: raw.o, h: raw.h, l: raw.l, c: raw.c, v: raw.v }; }
    const strat = TL.clone(st); strat.params = TL.clone(view.params);
    if (worker) worker.terminate();
    worker = new Worker('js/tuner-worker.js');
    const prog = $('pProgress'), bar = prog.querySelector('i'), label = prog.querySelector('span');
    prog.classList.remove('hidden'); bar.style.width = '0%'; label.textContent = 'Starting…'; $('pRun').disabled = true;
    const goal = S.auto.goal;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') { bar.style.width = (m.done / m.total * 100).toFixed(0) + '%'; label.textContent = `Tried ${m.done} of ${m.total}`; return; }
      $('pRun').disabled = false; prog.classList.add('hidden'); worker.terminate(); worker = null;
      pfResult = { ...m, U, from: r.from, to: r.to, split, strat, goal, sel: 0 };
      renderExam();
    };
    worker.onerror = (e) => { $('pRun').disabled = false; prog.classList.add('hidden'); A.toast('The tuner hit an error: ' + (e.message || 'unknown')); };
    worker.postMessage({ type: 'tune-portfolio', key: syms.join(','), raws, strategy: strat, budget: S.auto.budget, goal,
      capital: S.market.capital, fee: S.market.fee, slip: S.market.slip, trainFrom: r.from, trainTo: split - 1, testFrom: split, testTo: r.to });
  }
  function renderExam() {
    const R = pfResult, el = $('pExam'), G = TL.GOALS[R.goal], cal = R.U.cal;
    el.className = 'card exam';
    if (!R.top.length) { el.innerHTML = '<p class="hint">No settings could be scored. Try more years.</p>'; return; }
    const best = R.top[R.sel];
    const bTrain = A.pfBenchmarks(R.U, R.from, R.split - 1, S.market.capital, S.market.fee, S.market.slip).spy.metrics;
    const bTest = A.pfBenchmarks(R.U, R.split, R.to, S.market.capital, S.market.fee, S.market.slip).spy.metrics;
    let cls, title, text;
    if (best.test.cagr > 0 && G.get(best.test) >= G.get(bTest)) { cls = 'pass'; title = 'Passed the exam'; text = 'On years it never saw, these settings made money and beat just holding the S&P 500 on your goal.'; }
    else if (best.test.cagr > 0) { cls = 'meh'; title = 'Made money, but the S&P 500 did better'; text = `On the exam years it grew ${fmt.pct(best.test.cagr)} a year; just holding the S&P 500 scored better on ${G.short}.`; }
    else { cls = 'fail'; title = 'Failed the exam'; text = 'It lost money on the years it had not seen.'; }
    const icon = { pass: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>', meh: '<path d="M12 8v5m0 3.5v.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>', fail: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' }[cls];
    const vals = (v) => Object.entries(v).map(([k, x]) => `${R.strat.params[k] ? R.strat.params[k].label : k}: ${x}`).join(' · ');
    const row = (l, a, b, f, hi = true) => `<tr><th>${l}</th><td class="${(hi ? a > b : a < b) ? 'up' : 'down'}">${f(a)}</td><td>${f(b)}</td></tr>`;
    const col = (name, when, m, bm) => `<div class="exam-col"><h3>${name}</h3><div class="when">${when}</div><table class="kv"><thead><tr><th></th><th>Portfolio</th><th>Just holding</th></tr></thead><tbody>
      ${row('Growth per year', m.cagr, bm.cagr, fmt.pct)}${row('Worst drop', m.maxDD, bm.maxDD, (x) => fmt.pctPlain(x), false)}${row('Smoothness (Sharpe)', m.sharpe, bm.sharpe, fmt.num)}</tbody></table></div>`;
    el.innerHTML = `<div class="verdict ${cls}"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><div><b>${title}</b><p>${text}</p></div></div>
      <p class="hint">Settings: <b>${esc(vals(best.values))}</b>${R.sel ? ` (number ${R.sel + 1})` : ' (the best on the learning years)'}.</p>
      <div class="exam-cols">${col('Learning years', `${fmt.date(cal.t[R.from])} – ${fmt.date(cal.t[R.split - 1])}`, best.train, bTrain)}${col('Exam years', `${fmt.date(cal.t[R.split])} – ${fmt.date(cal.t[R.to])} · never seen while tuning`, best.test, bTest)}</div>
      <div class="btn-row"><button class="btn primary" data-act="use">Use these settings</button></div>
      <details class="fold"><summary>Show the top ${R.top.length}</summary><div class="tbl-wrap"><table class="data"><thead><tr><th>#</th><th class="l">Settings</th><th>Learning score</th><th>Exam score</th><th>Exam growth / yr</th></tr></thead><tbody>
      ${R.top.map((r, k) => `<tr class="pick${k === R.sel ? ' sel' : ''}" data-k="${k}"><td>${k + 1}</td><td class="l">${esc(vals(r.values))}</td><td>${G.fmt(r.score)}</td><td>${G.fmt(r.testScore)}</td><td class="${fmt.signClass(r.test.cagr)}">${fmt.pct(r.test.cagr)}</td></tr>`).join('')}
      </tbody></table></div></details>`;
    el.querySelectorAll('tr.pick').forEach(tr => tr.onclick = () => { R.sel = +tr.dataset.k; renderExam(); });
    el.querySelector('[data-act=use]').onclick = () => {
      for (const [k, v] of Object.entries(best.values)) if (S.pf.strat.params[k]) S.pf.strat.params[k].v = v;
      A.persist(); renderControls(); refresh(); A.toast('Settings applied.');
    };
  }

  /* ---------- boot ---------- */
  function boot() {
    if (!S.pf.strat || !getPf(S.pf.stratId)) S.pf.strat = TL.clone(getPf(S.pf.stratId) || TL.PORTFOLIOS[0]);
    fillSelect(); renderControls();
    $('pStrat').onchange = () => useStrategy(getPf($('pStrat').value), $('pStrat').value);
    $('pRun').onclick = runTuner;
    $('pSaveAlgo').onclick = () => {
      const st = TL.clone(S.pf.strat), existing = S.portfolios.findIndex(p => p.id === S.pf.stratId);
      delete st.builtin;
      if (existing >= 0) { S.portfolios[existing] = st; A.toast('Saved.'); }
      else {
        st.id = 'p' + Date.now().toString(36);
        if (TL.PORTFOLIOS.some(p => p.name === st.name)) st.name += ' (my version)';
        S.portfolios.push(st); S.pf.stratId = st.id; S.pf.strat = TL.clone(st);
        A.toast('Saved to My portfolios.');
      }
      A.persist(); fillSelect(); renderControls(); document.dispatchEvent(new CustomEvent('tl-strategies'));
    };
    $('pSaveSetup').onclick = () => { if (current) A.savePortfolioSetup(S.pf.strat, current.U, current.res, current.bench); };
    $('pLock').onclick = () => A.lockForwardPortfolio(S.pf.strat);
    document.addEventListener('tl-open-portfolio', (e) => useStrategy(e.detail, e.detail.id));
    document.addEventListener('tl-show-portfolio', () => { if (stale || !current) refresh(); });
    document.addEventListener('tl-market', () => { stale = true; pfResult = null; hideExam(); if (S.tab === 'portfolio') refresh(); });
  }
  if (A.ready) boot(); else document.addEventListener('tl-ready', boot, { once: true });
})();
