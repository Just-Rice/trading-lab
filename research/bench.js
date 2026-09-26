// Research bench: runs strategies through the site's own engine (js/core.js).
require('../js/core.js');
const fs = require('fs');
const DATA = require('path').join(__dirname, '..', 'data') + '/';
const iso = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const ETFS = ['SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'XLE', 'XLF', 'XLK', 'TLT', 'GLD'];
const PERIODS = { train: ['2000-01-01', '2014-12-31'], valid: ['2015-01-01', '2020-12-31'], hold: ['2021-01-01', '2026-12-31'] };
const cache = {};
function series(sym) { return cache[sym] || (cache[sym] = TL.makeSeries(JSON.parse(fs.readFileSync(DATA + sym + '.json')))); }
function window(s, period) {
  const [a, b] = PERIODS[period];
  let from = Math.max(1, TL.indexOnOrAfter(s, iso(a))), to = Math.min(s.n - 1, TL.indexOnOrAfter(s, iso(b) + 1) - 1);
  // leave ~1 year of warm-up for indicators when a fund starts mid-period
  from = Math.max(from, 260);
  return to - from > 200 ? { from, to } : null;
}
const OPT = { capital: 10000, fee: 0.05, slip: 0.05 };
function run(strat, sym, period, record = false) {
  const s = series(sym), w = window(s, period);
  if (!w) return null;
  const r = TL.backtest(s, strat, { ...OPT, ...w, record });
  const bh = TL.curveStats(TL.buyHoldCurve(s, r.from, r.to, 10000), r.metrics.years);
  return { m: r.metrics, bh, r };
}
function median(a) { const b = [...a].sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[(n - 1) >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN; }
function evalBasket(strat, period, syms = ETFS) {
  const rows = syms.map(sym => { const x = run(strat, sym, period); return x && { sym, ...x }; }).filter(Boolean);
  const sh = rows.map(r => r.m.sharpe), dsh = rows.map(r => r.m.sharpe - r.bh.sharpe);
  return {
    rows, medSharpe: median(sh), meanSharpe: sh.reduce((a, b) => a + b, 0) / sh.length,
    medDeltaSharpe: median(dsh), meanDeltaSharpe: dsh.reduce((a, b) => a + b, 0) / dsh.length,
    medCagr: median(rows.map(r => r.m.cagr)), medBhCagr: median(rows.map(r => r.bh.cagr)),
    medDD: median(rows.map(r => r.m.maxDD)), medBhDD: median(rows.map(r => r.bh.maxDD)),
    medCalmar: median(rows.map(r => r.m.calmar)), medExposure: median(rows.map(r => r.m.exposure)),
    trades: median(rows.map(r => r.m.trades)),
  };
}
const N = (v) => ({ v }), P = (p) => ({ p });
const op = (k, ...args) => ({ k, args });
const rule = (a, cmp, b) => ({ a, cmp, b });
function strat(name, params, buy, sell, risk = {}) {
  return { id: name, name, params: params || {}, buy, sell, risk: Object.assign(TL.defaultRisk(), risk) };
}
function fmtRow(label, e) {
  return `${label.padEnd(44)} medSh ${e.medSharpe.toFixed(2)}  dSh ${e.medDeltaSharpe >= 0 ? '+' : ''}${e.medDeltaSharpe.toFixed(2)}  CAGR ${e.medCagr.toFixed(1)} (bh ${e.medBhCagr.toFixed(1)})  DD ${e.medDD.toFixed(0)} (bh ${e.medBhDD.toFixed(0)})  exp ${e.medExposure.toFixed(0)}%  tr ${e.trades}`;
}
module.exports = { TL, ETFS, PERIODS, series, window, run, evalBasket, median, N, P, op, rule, strat, fmtRow, iso };
