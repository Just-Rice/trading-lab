const B = require('./bench.js');
const { evalBasket, op, rule, N, strat } = B;
const all = (...r) => ({ mode: 'all', rules: r }), any = (...r) => ({ mode: 'any', rules: r });
const score = (e) => e.medDeltaSharpe + 0.015 * (e.medCagr - e.medBhCagr);
const res = [];
function test(fam, c, st) {
  const t = evalBasket(st, 'train'), v = evalBasket(st, 'valid');
  res.push({ fam, c, t, v, st: score(t), sv: score(v), robust: Math.min(score(t), score(v)) });
}
// F1 simple trend with band
for (const n of [150, 200, 250]) for (const b of [0, 2, 4, 6])
  test('F1', { n, b }, strat('F1', {}, all(rule(op('dist', N(n)), '>', op('value', N(b)))), any(rule(op('dist', N(n)), '<', op('value', N(-b))))));
// F3 slow out (long trend broken by a margin AND below short average), fast back in (above short average or a deep dip)
for (const n of [150, 200, 250]) for (const b of [0, 3, 6, 10]) for (const f of [20, 50, 100]) for (const x of [0, 10])
  test('F3', { n, b, f, x }, strat('F3', {},
    any(rule(op('close'), '>', op('sma', N(f))), ...(x ? [rule(op('rsi', N(4)), '<', op('value', N(x)))] : [])),
    all(rule(op('dist', N(n)), '<', op('value', N(-b))), rule(op('close'), '<', op('sma', N(f))))));
// F4 stay invested unless the long trend is broken AND recent momentum is sharply negative
for (const n of [150, 200, 250]) for (const b of [0, 3, 6]) for (const m of [21, 63]) for (const c of [3, 6, 10])
  test('F4', { n, b, m, c }, strat('F4', {},
    any(rule(op('dist', N(n)), '>', op('value', N(0))), rule(op('rsi', N(4)), '<', op('value', N(10))), rule(op('roc', N(m)), '>', op('value', N(0)))),
    all(rule(op('dist', N(n)), '<', op('value', N(-b))), rule(op('roc', N(m)), '<', op('value', N(-c))))));
res.sort((a, b) => b.robust - a.robust);
const f = (e) => `Sh ${e.medSharpe.toFixed(2)} CAGR ${e.medCagr.toFixed(1)}/${e.medBhCagr.toFixed(1)} DD ${e.medDD.toFixed(0)}/${e.medBhDD.toFixed(0)}`;
console.log('Robust score = worse of (design, check). Buy & hold scores 0. Top 18:');
for (const r of res.slice(0, 18)) console.log(r.robust.toFixed(3).padStart(7), r.fam, JSON.stringify(r.c).padEnd(34), '| design', f(r.t), '| check', f(r.v));
console.log('\nHow many beat buy & hold in BOTH periods (robust > 0):', res.filter(r => r.robust > 0).length, 'of', res.length);

