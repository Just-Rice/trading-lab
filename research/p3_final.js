const B = require('./pbench.js');
const { P, fm, run } = B;
const BAL = P({ name: 'Balanced', mode: 'fixed', assets: ['SPY', 'TLT', 'GLD'], weights: { SPY: 50, TLT: 35, GLD: 15 } });
const STEADY = P({ name: 'Steady', mode: 'fixed', assets: ['SPY', 'IEF', 'GLD'], weights: { SPY: 30, IEF: 60, GLD: 10 } });
const TREND = P({ name: 'Trend-protected', mode: 'trend', assets: ['SPY', 'IEF', 'GLD'], weights: { SPY: 30, IEF: 50, GLD: 20 }, filter: { v: 150 }, safe: 'SHY' });
const MOM = P({ name: 'Momentum top 3', mode: 'momentum', assets: ['SPY', 'EFA', 'TLT', 'GLD'], top: { v: 3 }, lookMode: 'blend', look: { v: 126 }, absFilter: 'none', safe: 'SHY', weighting: 'equal' });
module.exports = { BAL, STEADY, TREND, MOM };
if (require.main === module) {
  const list = [['S&P 500 only (SPY)', B.SPY], ['60/40 SPY/IEF', B.SIXTY], ['Balanced 50/35/15', BAL], ['Steady 30/60/10', STEADY], ['(ref) Trend-protected', TREND], ['(ref) Momentum top 3', MOM]];
  for (const period of ['hold', 'full']) {
    console.log(period === 'hold' ? '\n=== FINAL EXAM 2021-01 → 2026-09 (opened once) ===' : '\n=== EVERYTHING 2003-09 → 2026-09 ===');
    for (const [n, st] of list) { const m = run(st, period).metrics; console.log(n.padEnd(26), fm(m), ` $10k → $${Math.round(m.final).toLocaleString()}`); }
  }
  // calendar years for the two picks vs SPY
  const yr = (st) => { const r = run(st, 'full', true), out = {}; let prevE = r.equity[0], prevY = null, lastE = prevE;
    for (let i = r.from; i <= r.to; i++) { const y = new Date(B.U.cal.t[i] * 864e5).getUTCFullYear(); const e = r.equity[i - r.from]; if (prevY !== null && y !== prevY) { out[prevY] = (lastE / prevE - 1) * 100; prevE = lastE; } prevY = y; lastE = e; } out[prevY] = (lastE / prevE - 1) * 100; return out; };
  const a = yr(B.SPY), b = yr(BAL), c = yr(STEADY);
  console.log('\nYear      SPY   Balanced   Steady');
  for (const y of Object.keys(a)) console.log(y, a[y].toFixed(0).padStart(6) + '%', b[y].toFixed(0).padStart(8) + '%', c[y].toFixed(0).padStart(8) + '%');
}
