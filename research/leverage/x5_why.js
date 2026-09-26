const X = require('./xbench.js'); const F = require('./xfam.js');
function worst(expo, period) {
  const w = X.win(period), m = X.simulate(expo, w, { curve: true }), c = m.curve;
  let peak = c[0], pi = 0, best = { dd: 0 };
  for (let k = 0; k < c.length; k++) { if (c[k] > peak) { peak = c[k]; pi = k; } const dd = 1 - c[k] / peak; if (dd > best.dd) best = { dd, from: w.from + pi, to: w.from + k }; }
  return best;
}
const fmtD = (i) => String(X.D.d[i]).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3');
for (const [n, e] of [['Moderate 2x', F.A({ L: 2, n: 150, b: 2 })], ['Gentle 1.5x', F.A({ L: 1.5, n: 150, b: 3 })], ['Holding', X.HOLD]]) {
  const b = worst(e, 'exam'); console.log(`${n.padEnd(12)} worst drop 1950-2000: ${(b.dd * 100).toFixed(0)}% from ${fmtD(b.from)} to ${fmtD(b.to)}`);
}
// the October 1987 crash, day by day for the 2x bot
const e = F.A({ L: 2, n: 150, b: 2 });
console.log('\nOct 1987: market move vs the 2x bot (exposure decided two closes earlier)');
for (let i = X.idx(19871012); i <= X.idx(19871023); i++) { const ex = e(i - 2); console.log(fmtD(i), `market ${(X.D.mkt[i] * 100).toFixed(1).padStart(6)}%`, ` exposure ${ex}x`, ` bot ≈ ${(ex * X.D.mkt[i] * 100).toFixed(1).padStart(6)}%`); }
