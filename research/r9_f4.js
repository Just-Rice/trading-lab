const B = require('./bench.js');
const { evalBasket, op, rule, N, strat } = B;
const all = (...r) => ({ mode: 'all', rules: r }), any = (...r) => ({ mode: 'any', rules: r });
const score = (e) => e.medDeltaSharpe + 0.015 * (e.medCagr - e.medBhCagr);
const mk = (c) => strat('F4', {},
  any(rule(op('dist', N(c.n)), '>', op('value', N(0))), ...(c.dip ? [rule(op('rsi', N(4)), '<', op('value', N(10)))] : []), rule(op('roc', N(c.m)), '>', op('value', N(c.e)))),
  all(rule(op('dist', N(c.n)), '<', op('value', N(-c.b))), rule(op('roc', N(c.m)), '<', op('value', N(-c.c)))));
const dims = { n: [150, 200, 250], b: [4, 6, 8, 10], m: [10, 15, 21, 30, 42], c: [1, 2, 3, 4, 6], e: [0], dip: [1] };
const res = new Map(), keys = Object.keys(dims);
const rec = (i, cur) => {
  if (i === keys.length) { const st = mk(cur), t = evalBasket(st, 'train'), v = evalBasket(st, 'valid'); res.set(keys.map(k => cur[k]).join('|'), { c: { ...cur }, t, v, robust: Math.min(score(t), score(v)) }); return; }
  for (const x of dims[keys[i]]) { cur[keys[i]] = x; rec(i + 1, cur); }
};
rec(0, {});
for (const r of res.values()) {
  let s = r.robust, n = 1;
  keys.forEach(k => { const idx = dims[k].indexOf(r.c[k]); for (const d of [-1, 1]) { const x = dims[k][idx + d]; if (x === undefined) continue; const o = res.get(keys.map(kk => kk === k ? x : r.c[kk]).join('|')); if (o) { s += o.robust; n++; } } });
  r.smooth = s / n;
}
const list = [...res.values()].sort((a, b) => b.smooth - a.smooth);
const f = (e) => `Sh ${e.medSharpe.toFixed(2)} CAGR ${e.medCagr.toFixed(1)}/${e.medBhCagr.toFixed(1)} DD ${e.medDD.toFixed(0)}/${e.medBhDD.toFixed(0)} exp ${e.medExposure.toFixed(0)} tr ${e.trades}`;
console.log('Top by stable robust score (neighbour-averaged worse-of-two-periods):');
for (const r of list.slice(0, 12)) console.log(r.smooth.toFixed(3), r.robust.toFixed(3), JSON.stringify(r.c).padEnd(46), '| design', f(r.t), '| check', f(r.v));
console.log('\nShare of this whole grid that beats buy & hold in both periods:', ([...res.values()].filter(r => r.robust > 0).length / res.size * 100).toFixed(0) + '%');
// ablations on the chosen centre
const centre = list[0].c;
for (const [lab, c] of [['centre', centre], ['no dip entry', { ...centre, dip: 0 }], ['re-entry needs +2% month', { ...centre, e: 2 }]]) {
  const st = mk(c), t = evalBasket(st, 'train'), v = evalBasket(st, 'valid');
  console.log(lab.padEnd(26), '| design', f(t), '| check', f(v), '| robust', Math.min(score(t), score(v)).toFixed(3));
}

