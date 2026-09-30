// Crash guard: cut the boost when the market falls g% in a day, then wait `cool` days.
// Settings chosen on 2001-2020 only; older periods were already used once to judge the boost bots.
const X = require('./xbench.js'); const F = require('./xfam.js');
const BOTS = [['Gentle 1.5x', F.A({ L: 1.5, n: 150, b: 3 })], ['Smooth (vol steering)', F.AB({ tv: 21, n: 20, cap: 2, tn: 200, b: 2 })], ['Moderate 2x', F.A({ L: 2, n: 150, b: 2 })]];
const bh = X.simulate(X.HOLD, 'design');
console.log('Holding 2001-2020:', X.fm(bh));
const pick = {};
for (const [name, e] of BOTS) {
  const base = X.simulate(e, 'design');
  let best = null;
  const rows = [];
  for (const g of [3, 4, 5, 6, 8]) for (const cool of [0, 5, 10, 20]) {
    const m = X.simulate(e, 'design', { guard: { g, cool } });
    const a = X.simulate(e, 'designA', { guard: { g, cool } }), b = X.simulate(e, 'designB', { guard: { g, cool } });
    const a0 = X.simulate(e, 'designA'), b0 = X.simulate(e, 'designB');
    // better than the same bot without the guard in both decades, on growth, with no bigger worst drop
    const score = m.maxDD <= base.maxDD + 0.5 ? Math.min(a.cagr - a0.cagr, b.cagr - b0.cagr) : -99;
    rows.push({ g, cool, m, score });
  }
  rows.sort((x, y) => y.score - x.score);
  console.log(`\n${name} without guard: ${X.fm(base)}`);
  for (const r of rows.slice(0, 4)) console.log(`  guard ${r.g}% cool ${String(r.cool).padStart(2)}d: ${X.fm(r.m)}  score ${r.score.toFixed(2)}`);
  pick[name] = rows[0];
}
console.log('\n=== Chosen guards on older years (seen once before) and recent years ===');
for (const [name, e] of BOTS) {
  const g = pick[name];
  for (const p of ['exam', 'stress', 'recent']) {
    const h = X.simulate(X.HOLD, p), a = X.simulate(e, p), b = X.simulate(e, p, { guard: { g: g.g, cool: g.cool } });
    console.log(`${name.padEnd(22)} ${p.padEnd(7)} hold ${h.cagr.toFixed(1)}%/${h.maxDD.toFixed(0)}% | no guard ${a.cagr.toFixed(1)}%/${a.maxDD.toFixed(0)}% | guard ${g.g}%,${g.cool}d ${b.cagr.toFixed(1)}%/${b.maxDD.toFixed(0)}%`);
  }
}
// Black Monday check
const e = F.A({ L: 2, n: 150, b: 2 }), g = pick['Moderate 2x'];
const p = { from: X.idx(19870801), to: X.idx(19871231) };
console.log(`\nModerate 2x, Aug-Dec 1987: no guard ${((X.simulate(e, p).final - 1) * 100).toFixed(0)}%, with guard ${((X.simulate(e, p, { guard: { g: g.g, cool: g.cool } }).final - 1) * 100).toFixed(0)}%, holding ${((X.simulate(X.HOLD, p).final - 1) * 100).toFixed(0)}%`);
