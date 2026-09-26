const B = require('./bench.js'); const { SHIELD } = require('./final.js'); const C = require('./cands.js');
B.PERIODS.full = ['2000-01-01', '2026-12-31'];
const f = (e) => `Sh ${e.medSharpe.toFixed(2)}  CAGR ${e.medCagr.toFixed(1)}% (hold ${e.medBhCagr.toFixed(1)}%)  worst drop ${e.medDD.toFixed(0)}% (hold ${e.medBhDD.toFixed(0)}%)`;
console.log('FULL 2000 → 2026, median of 10 funds');
for (const [n, mk] of [['Crash shield', SHIELD], ['Simple trend sma50>200', C.SMA], ['Buy & hold', C.BH]]) console.log(n.padEnd(26), f(B.evalBasket(mk(), 'full')));
// SPY year by year
const s = B.series('SPY'), from = 260, to = s.n - 1;

const res = B.TL.backtest(s, SHIELD(), { capital: 10000, fee: 0.05, slip: 0.05, from, to });
const yr = (d) => new Date(d * 86400000).getUTCFullYear();
const byYear = {};
for (let i = from; i <= to; i++) { const y = yr(s.t[i]); (byYear[y] = byYear[y] || { first: i, last: i }).last = i; }
console.log('\nSPY year by year: shield vs hold');
let prevE = res.equity[0], prevC = s.close[from];
const line = [];
for (const [y, { first, last }] of Object.entries(byYear)) {
  const e = res.equity[last - from], c = s.close[last];
  line.push(`${y}: ${((e / prevE - 1) * 100).toFixed(0).padStart(4)}% vs ${((c / prevC - 1) * 100).toFixed(0).padStart(4)}%`);
  prevE = e; prevC = c;
}
for (let i = 0; i < line.length; i += 3) console.log(line.slice(i, i + 3).join('   |   '));
const m = res.metrics, bh = B.TL.curveStats(B.TL.buyHoldCurve(s, from, to, 10000), m.years);
console.log(`\nSPY ${B.TL.dayToISO(s.t[from])} → ${B.TL.dayToISO(s.t[to])}: shield $10k → $${Math.round(m.final).toLocaleString()} (CAGR ${m.cagr.toFixed(1)}%, worst ${m.maxDD.toFixed(0)}%, trades ${m.trades}) · hold → $${Math.round(10000 * (1 + bh.totalReturn / 100)).toLocaleString()} (CAGR ${bh.cagr.toFixed(1)}%, worst ${bh.maxDD.toFixed(0)}%)`);
