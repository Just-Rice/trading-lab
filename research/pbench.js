// Portfolio research bench on the site's engine.
require('../js/core.js');
const fs = require('fs');
const DATA = require('path').join(__dirname, '..', 'data') + '/';
const iso = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const ALL = ['SPY','QQQ','DIA','IWM','VTI','EFA','EEM','TLT','IEF','SHY','BIL','AGG','TIP','LQD','GLD','SLV','DBC','VNQ','XLK','XLF','XLE','XLV','XLP','XLY','XLI','XLU','XLB'];
const map = {}; for (const s of ALL) map[s] = TL.makeSeries(JSON.parse(fs.readFileSync(DATA + s + '.json')));
const U = TL.alignUniverse(map, 'SPY');
const PERIODS = { train: ['2003-09-01', '2014-12-31'], valid: ['2015-01-01', '2020-12-31'], hold: ['2021-01-01', '2026-12-31'], full: ['2003-09-01', '2026-12-31'] };
function win(period) { const [a, b] = PERIODS[period]; return { from: Math.max(TL.WARM, TL.indexOnOrAfter(U.cal, iso(a))), to: Math.min(U.cal.n - 1, TL.indexOnOrAfter(U.cal, iso(b) + 1) - 1) }; }
const OPT = { capital: 10000, fee: 0.05, slip: 0.05 };
function run(strat, period, record = false) { return TL.backtestPortfolio(U, strat, { ...OPT, ...win(period), record }); }
const P = (o) => Object.assign({ type: 'portfolio', params: {}, rebalance: 'monthly', safe: 'cash' }, o);
const SPY = P({ name: 'SPY', mode: 'fixed', assets: ['SPY'], weights: { SPY: 100 } });
const SIXTY = P({ name: '60/40', mode: 'fixed', assets: ['SPY', 'IEF'], weights: { SPY: 60, IEF: 40 } });
const bm = {}; for (const p of Object.keys(PERIODS)) bm[p] = { spy: run(SPY, p).metrics, sixty: run(SIXTY, p).metrics };
const score = (m, b) => (m.sharpe - b.sharpe) + 0.015 * (m.cagr - b.cagr);
function evalBoth(strat) {
  const t = run(strat, 'train').metrics, v = run(strat, 'valid').metrics;
  return { t, v, st: score(t, bm.train.spy), sv: score(v, bm.valid.spy), robust: Math.min(score(t, bm.train.spy), score(v, bm.valid.spy)) };
}
const fm = (m) => `CAGR ${m.cagr.toFixed(1).padStart(5)}%  DD ${m.maxDD.toFixed(0).padStart(3)}%  Sh ${m.sharpe.toFixed(2)}`;
module.exports = { TL, U, run, P, SPY, SIXTY, bm, evalBoth, score, fm, win, PERIODS };
