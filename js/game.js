/* Beat the robot: trade a hidden stretch of real history day by day against a robot and just holding. */
(function () {
  'use strict';
  const A = window.TLApp;
  const { makeChart, fmt, esc, css, T } = window.TLCharts;
  const $ = (id) => document.getElementById(id);
  const FEE = 0.001; // fee + slippage per trade
  const SKEY = 'tradinglab.game';
  const RANDOM_POOL = ['USMKT', 'USMKT', 'SPY', 'QQQ', 'IWM', 'DIA', 'EFA', 'EEM', 'GLD', 'TLT', 'XLE', 'XLK', 'XLF', 'AAPL', 'MSFT', 'KO', 'JPM', 'XOM'];
  const CRASHES = [
    { sym: 'USMKT', start: '1929-06-03', days: 252, name: 'the 1929 crash' },
    { sym: 'USMKT', start: '1937-03-01', days: 252, name: 'the 1937 crash' },
    { sym: 'USMKT', start: '1973-01-02', days: 504, name: 'the 1973–74 bear market' },
    { sym: 'USMKT', start: '1987-06-01', days: 252, name: 'Black Monday 1987' },
    { sym: 'SPY', start: '2000-03-01', days: 504, name: 'the dot-com bust' },
    { sym: 'SPY', start: '2007-10-01', days: 504, name: 'the 2008 financial crisis' },
    { sym: 'SPY', start: '2020-01-02', days: 252, name: 'the 2020 COVID crash' },
    { sym: 'SPY', start: '2022-01-03', days: 252, name: 'the 2022 bear market' },
    { sym: 'QQQ', start: '2000-01-03', days: 504, name: 'the Nasdaq bubble bursting' },
  ];
  let G = null, chart = null, priceS = null, timer = 0;

  function stats() { try { return Object.assign({ played: 0, beatRobot: 0, beatHold: 0 }, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch (e) { return { played: 0, beatRobot: 0, beatHold: 0 }; } }
  function saveStats(x) { try { localStorage.setItem(SKEY, JSON.stringify(x)); } catch (e) { /* storage blocked */ } }
  function renderStats() {
    const x = stats();
    $('gStats').textContent = x.played ? `Played ${x.played} · beat the robot ${x.beatRobot} · beat just holding ${x.beatHold}` : 'No games yet.';
  }

  async function start() {
    stopTimer();
    const mode = $('gMode').value, robotId = $('gRobot').value, len = +$('gLen').value;
    let pick;
    if (mode === 'crash') pick = CRASHES[Math.floor(Math.random() * CRASHES.length)];
    else {
      const sym = RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
      pick = { sym, days: len };
    }
    const s = await A.loadSeries(pick.sym);
    let from;
    if (pick.start) from = TL.indexOnOrAfter(s, A.isoToDay(pick.start));
    else from = TL.WARM + 60 + Math.floor(Math.random() * Math.max(1, s.n - pick.days - TL.WARM - 62));
    const to = Math.min(s.n - 1, from + pick.days);
    const robot = A.getStrategy(robotId);
    const r = TL.backtest(s, robot, { from, to, capital: 10000, fee: 0.05, slip: 0.05 });
    G = { s, from, to, k: from, pick, robot, r, cash: 10000, shares: 0, pending: null, trades: [], done: false };
    $('gSetup').classList.add('hidden'); $('gPlay').classList.remove('hidden'); $('gEnd').classList.add('hidden');
    setupChart();
    render();
  }

  function setupChart() {
    if (!chart) {
      // Theme changes reapply the shared chart options, so put the game's own back afterwards.
      const gameOpts = { timeScale: { visible: false, rightOffset: 8 }, crosshair: { vertLine: { labelVisible: false } }, handleScroll: false, handleScale: false };
      chart = makeChart($('gChart'), () => { chart.chart.applyOptions(gameOpts); if (priceS) priceS.applyOptions({ color: css('--ink-2') }); });
      chart.chart.applyOptions(gameOpts);
    }
    if (priceS) chart.chart.removeSeries(priceS);
    priceS = chart.chart.addLineSeries({ color: css('--ink-2'), lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const { s, from } = G, base = s.close[from], pts = [];
    for (let i = Math.max(0, from - 60); i <= from; i++) pts.push({ time: T(s.t[i]), value: s.close[i] / base * 100 });
    priceS.setData(pts);
    chart.chart.timeScale().fitContent();
  }

  // Your order from day k fills at day k+1's open (the next close for one-price-a-day history).
  function step() {
    if (!G || G.done) return;
    const { s } = G, i = G.k + 1;
    if (G.pending) {
      const px = s.open[i];
      if (G.pending === 'buy' && G.cash > 0) { G.shares = G.cash * (1 - FEE) / px; G.cash = 0; G.trades.push({ i, side: 'buy' }); }
      if (G.pending === 'sell' && G.shares > 0) { G.cash = G.shares * px * (1 - FEE); G.shares = 0; G.trades.push({ i, side: 'sell' }); }
      G.pending = null;
    }
    G.k = i;
    priceS.update({ time: T(s.t[i]), value: s.close[i] / s.close[G.from] * 100 });
    setMarkers(false);
    chart.chart.timeScale().scrollToRealTime();
    if (G.k >= G.to) finish(); else render();
  }
  function setMarkers(showRobot) {
    const { s } = G, good = css('--good'), bad = css('--bad');
    const m = G.trades.map(t => ({ time: T(s.t[t.i]), position: t.side === 'buy' ? 'belowBar' : 'aboveBar', shape: t.side === 'buy' ? 'arrowUp' : 'arrowDown', color: t.side === 'buy' ? good : bad, text: t.side === 'buy' ? 'You buy' : 'You sell' }));
    if (showRobot) for (const t of G.r.trades) {
      m.push({ time: T(s.t[t.entryIdx]), position: 'belowBar', shape: 'circle', color: css('--s2'), text: 'Robot buys' });
      if (!t.open) m.push({ time: T(s.t[t.exitIdx]), position: 'aboveBar', shape: 'circle', color: css('--s2'), text: 'Robot sells' });
    }
    m.sort((a, b) => a.time - b.time);
    priceS.setMarkers(m);
  }
  const yourMoney = () => G.cash + G.shares * G.s.close[G.k];
  const robotMoney = () => G.r.equity[G.k - G.from];
  const holdMoney = () => 10000 * G.s.close[G.k] / G.s.open[G.from];

  function render() {
    const day = G.k - G.from, total = G.to - G.from;
    $('gDay').textContent = `Day ${day} of ${total}`;
    $('gYou').textContent = fmt.money(yourMoney());
    $('gRobotM').textContent = fmt.money(robotMoney());
    $('gHold').textContent = fmt.money(holdMoney());
    const inMkt = G.shares > 0;
    $('gPos').textContent = G.pending ? (G.pending === 'buy' ? 'Buying at the next price…' : 'Selling at the next price…') : inMkt ? 'You are invested' : 'You are in cash';
    $('gBuy').disabled = inMkt || G.pending === 'buy';
    $('gSell').disabled = !inMkt || G.pending === 'sell';
  }

  function finish() {
    stopTimer();
    G.done = true;
    const you = yourMoney(), robot = G.r.metrics.final, hold = holdMoney();
    $('gDay').textContent = 'Finished'; $('gPos').textContent = '';
    $('gYou').textContent = fmt.money(you); $('gRobotM').textContent = fmt.money(robot); $('gHold').textContent = fmt.money(hold);
    const x = stats(); x.played++; if (you > robot) x.beatRobot++; if (you > hold) x.beatHold++; saveStats(x);
    setMarkers(true);
    const meta = A.metaOf(G.s.sym);
    const what = G.pick.name ? `${G.pick.name}, traded on ${meta ? meta.n : G.s.sym}` : (meta ? meta.n : G.s.sym);
    const verdict = you > robot && you > hold ? 'You beat the robot and just holding!' : you > robot ? 'You beat the robot, but just holding did even better.' : you > hold ? 'You beat just holding, but the robot did better.' : 'The robot and just holding both beat you this time.';
    $('gEnd').classList.remove('hidden');
    $('gEnd').innerHTML = `<div class="verdict ${you >= Math.max(robot, hold) ? 'pass' : you > Math.min(robot, hold) ? 'meh' : 'fail'}"><div><b>${verdict}</b>
      <p>It was <b>${esc(what)}</b>, from ${fmt.date(G.s.t[G.from])} to ${fmt.date(G.s.t[G.to])}.</p></div></div>
      <div class="tiles"><div class="tile"><div class="lab">You</div><div class="val">${fmt.money(you)}</div><div class="cmp">${G.trades.length} trades</div></div>
      <div class="tile"><div class="lab">Robot: ${esc(G.robot.name)}</div><div class="val">${fmt.money(robot)}</div><div class="cmp">${G.r.trades.length} trades · orange dots on the chart</div></div>
      <div class="tile"><div class="lab">Just holding</div><div class="val">${fmt.money(hold)}</div><div class="cmp">Bought on day one</div></div></div>
      <div class="btns"><button class="btn primary" id="gAgain">Play again</button><button class="btn" id="gBack">Change the challenge</button></div>`;
    $('gAgain').onclick = start;
    $('gBack').onclick = () => { $('gPlay').classList.add('hidden'); $('gSetup').classList.remove('hidden'); };
    $('gBuy').disabled = $('gSell').disabled = true;
    renderStats();
  }

  function stopTimer() { clearInterval(timer); timer = 0; const b = $('gAuto'); if (b) b.textContent = '▶ Play'; }
  function toggleAuto() {
    if (!G || G.done) return;
    if (timer) { stopTimer(); return; }
    $('gAuto').textContent = '❚❚ Pause';
    timer = setInterval(step, 1000 / +$('gSpeed').value);
  }

  function boot() {
    const sel = $('gRobot');
    for (const r of TL.RECIPES) sel.append(new Option(r.name, r.id));
    sel.value = 'shield';
    $('gStart').onclick = start;
    $('gNext').onclick = step;
    $('gAuto').onclick = toggleAuto;
    $('gSpeed').onchange = () => { if (timer) { stopTimer(); toggleAuto(); } };
    $('gBuy').onclick = () => { if (G && !G.done) { G.pending = 'buy'; render(); } };
    $('gSell').onclick = () => { if (G && !G.done) { G.pending = 'sell'; render(); } };
    document.addEventListener('keydown', (e) => {
      if (A.S.tab !== 'game' || !G || G.done || e.target.closest('input,select,textarea')) return;
      if (e.key === 'b' || e.key === 'B') $('gBuy').click();
      else if (e.key === 's' || e.key === 'S') $('gSell').click();
      else if (e.key === 'ArrowRight' || e.key === 'n') step();
      else if (e.key === ' ') { e.preventDefault(); toggleAuto(); }
    });
    renderStats();
  }
  if (A.ready) boot(); else document.addEventListener('tl-ready', boot, { once: true });
})();
