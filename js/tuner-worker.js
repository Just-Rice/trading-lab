/* Auto-tuner, run in a Web Worker so the page stays responsive.
 * Tunes on the training years, then sits the winners down for the "exam":
 * the later years they never saw. */
importScripts('core.js');

let series = null, seriesKey = '';

onmessage = (e) => {
  const m = e.data;
  if (m.type !== 'tune') return;
  if (m.key !== seriesKey) { series = TL.makeSeries(m.raw); seriesKey = m.key; }
  const s = series, opt = { capital: m.capital, fee: m.fee, slip: m.slip, record: false };
  const space = TL.paramSpace(m.strategy, m.budget);
  const results = [];
  const every = Math.max(1, Math.floor(space.combos.length / 50));
  space.combos.forEach((values, k) => {
    const strat = TL.withValues(m.strategy, values);
    const r = TL.backtest(s, strat, { ...opt, from: m.trainFrom, to: m.trainTo });
    results.push({ values, score: TL.score(r.metrics, m.goal, m.minTrades), train: r.metrics });
    if (k % every === 0) postMessage({ type: 'progress', done: k + 1, total: space.combos.length });
  });
  results.sort((a, b) => b.score - a.score);
  // The exam: the top 10 settings on years they never saw.
  const top = results.slice(0, 10).filter(r => Number.isFinite(r.score));
  for (const r of top) {
    const strat = TL.withValues(m.strategy, r.values);
    r.test = TL.backtest(s, strat, { ...opt, from: m.testFrom, to: m.testTo }).metrics;
    r.testScore = TL.score(r.test, m.goal, 0);
  }
  postMessage({
    type: 'done', grid: space.grid, total: space.total, tried: results.length,
    axes: space.axes, top,
    all: results.map(r => ({ values: r.values, score: r.score })),
    profitableShare: results.filter(r => r.train.totalReturn > 0).length / results.length,
  });
};
