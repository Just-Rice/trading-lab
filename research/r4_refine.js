const B = require('./bench.js');
const { evalBasket, fmtRow, op, rule, N, strat } = B;
const all = (...r) => ({ mode: 'all', rules: r }), any = (...r) => ({ mode: 'any', rules: r });
const score = (e) => e.medDeltaSharpe + 0.015 * (e.medCagr - e.medBhCagr);
function grid(dims, build) {
  const keys = Object.keys(dims), res = new Map();
  const rec = (i, cur) => {
    if (i === keys.length) { const e = evalBasket(build(cur), 'train'); res.set(keys.map(k => cur[k]).join('|'), { cur: { ...cur }, e, s: score(e) }); return; }
    for (const v of dims[keys[i]]) { cur[keys[i]] = v; rec(i + 1, cur); }
  };
  rec(0, {});
  // neighbour-smoothed score: average over points one step away in any single dimension
  for (const r of res.values()) {
    let sum = r.s, n = 1;
    keys.forEach((k, j) => {
      const idx = dims[k].indexOf(r.cur[k]);
      for (const d of [-1, 1]) {
        const v = dims[k][idx + d]; if (v === undefined) continue;
        const key = keys.map((kk) => kk === k ? v : r.cur[kk]).join('|');
        const o = res.get(key); if (o) { sum += o.s; n++; }
      }
    });
    r.smooth = sum / n;
  }
  return [...res.values()].sort((a, b) => b.smooth - a.smooth);
}
const T1 = grid({ f: [10, 20, 30, 50], s: [150, 200, 250], p: [2, 3, 4], x: [5, 10, 15], y: [40, 50, 60] }, (c) =>
  strat('T1', {}, any(rule(op('sma', N(c.f)), '>', op('sma', N(c.s))), rule(op('rsi', N(c.p)), '<', op('value', N(c.x)))),
    all(rule(op('sma', N(c.f)), '<', op('sma', N(c.s))), rule(op('rsi', N(c.p)), '>', op('value', N(c.y))))));
const T2 = grid({ n: [150, 200, 250], b: [2, 3, 4], p: [2, 3, 4], x: [5, 10, 15], y: [40, 50, 60] }, (c) =>
  strat('T2', {}, any(rule(op('dist', N(c.n)), '>', op('value', N(c.b))), rule(op('rsi', N(c.p)), '<', op('value', N(c.x)))),
    all(rule(op('dist', N(c.n)), '<', op('value', N(-c.b))), rule(op('rsi', N(c.p)), '>', op('value', N(c.y))))));
const show = (name, list) => { console.log(`\n${name}: top by stable (neighbour-averaged) score`); for (const r of list.slice(0, 8)) console.log(`smooth ${r.smooth.toFixed(3)} raw ${r.s.toFixed(3)} `, fmtRow(JSON.stringify(r.cur), r.e)); };
show('T1 average-cross trend + RSI dip', T1);
show('T2 distance-from-average trend + RSI dip', T2);

