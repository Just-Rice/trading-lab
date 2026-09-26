// The fresh exam: candidates fixed from 2001-2020 only, now run once on 1950-2000 and the 1928-1949 stress test.
const X = require('./xbench.js'); const F = require('./xfam.js'); const { simInd } = require('./x2_sectors.js');
const C = [
  ['1. Bold: 3x while above 250-day avg', (p) => X.simulate(F.A({ L: 3, n: 250, b: 3 }), p)],
  ['2. Moderate: 2x while above 150-day avg', (p) => X.simulate(F.A({ L: 2, n: 150, b: 2 }), p)],
  ['3. Gentle: 1.5x while above 150-day avg', (p) => X.simulate(F.A({ L: 1.5, n: 150, b: 3 }), p)],
  ['4. Clues: trend + calm, up to 3x', (p) => X.simulate(F.C({ clues: ['trend', 'calm'], L: 3, need: 2 }), p)],
  ['5. Volatility steering, up to 3x', (p) => X.simulate(F.B({ tv: 20, n: 20, cap: 3 }), p)],
  ['6. Sector rotation: top 2 of 10', (p) => simInd({ K: 2, look: 126 }, p)],
  ['(ref) Trend + vol steering, up to 2x', (p) => X.simulate(F.AB({ tv: 21, n: 20, cap: 2, tn: 200, b: 2 }), p)],
];
for (const [label, period] of [['DESIGN 2001-2020 (used for choosing)', 'design'], ['FRESH EXAM 1950-2000 (never seen)', 'exam'], ['STRESS TEST 1928-1949 (never seen, includes the Depression)', 'stress'], ['RECENT 2021-2026 (seen before)', 'recent']]) {
  const bh = X.simulate(X.HOLD, period);
  console.log(`\n=== ${label} ===\nJust holding                              ${X.fm(bh)}`);
  for (const [n, f] of C) { const m = f(period); const pass = m.cagr > bh.cagr && m.maxDD <= bh.maxDD + 0.5; console.log(`${n.padEnd(42)} ${X.fm(m)}  ${pass ? 'PASS' : m.cagr > bh.cagr ? 'more money, bigger drop' : 'less money'}`); }
}
