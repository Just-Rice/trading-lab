const X = require('./xbench.js'); const F = require('./xfam.js');
const bots = [['Just holding', X.HOLD], ['Gentle 1.5x + trend switch', F.A({ L: 1.5, n: 150, b: 3 })], ['Moderate 2x + trend switch', F.A({ L: 2, n: 150, b: 2 })], ['Trend + vol steering (up to 2x)', F.AB({ tv: 21, n: 20, cap: 2, tn: 200, b: 2 })]];
console.log('FULL 1928-2026 (98 years)');
for (const [n, e] of bots) { const m = X.simulate(e, 'all'); console.log(`${n.padEnd(32)} ${X.fm(m)}  $10,000 → $${Math.round(m.final * 10000).toLocaleString()}`); }
// calendar-year returns for key years
const years = [1929, 1930, 1931, 1937, 1974, 1987, 2000, 2001, 2002, 2008, 2011, 2018, 2020, 2022, 2025];
console.log('\nYear      ' + bots.map(b => b[0].split(' ')[0].padStart(10)).join(''));
for (const y of years) {
  const p = { from: X.idx(y * 10000 + 101), to: X.idx((y + 1) * 10000 + 101) - 1 };
  console.log(String(y).padEnd(10) + bots.map(([, e]) => { const m = X.simulate(e, p); return ((m.final - 1) * 100).toFixed(0).padStart(9) + '%'; }).join(''));
}
