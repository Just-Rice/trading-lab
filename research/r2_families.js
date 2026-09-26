const B = require('./bench.js');
const { evalBasket, fmtRow, op, rule, N, strat } = B;
const all = (...r) => ({ mode: 'all', rules: r }), any = (...r) => ({ mode: 'any', rules: r });
const out = [];
const test = (label, st) => { const e = evalBasket(st, 'train'); out.push({ label, e }); };

// A. Price above/below its average, with a band to cut whipsaws
for (const n of [50, 100, 150, 200, 250]) for (const b of [0, 1, 2, 3]) {
  test(`A dist(${n}) >+${b} / <-${b}`, strat('A', {}, all(rule(op('dist', N(n)), '>', op('value', N(b)))), any(rule(op('dist', N(n)), '<', op('value', N(-b))))));
}
// B. Fast average above slow average (state, not just the cross)
for (const f of [10, 20, 50]) for (const sl of [100, 150, 200, 250]) {
  test(`B sma(${f}) > sma(${sl}) state`, strat('B', {}, all(rule(op('sma', N(f)), '>', op('sma', N(sl)))), any(rule(op('sma', N(f)), '<', op('sma', N(sl))))));
  test(`B ema(${f}) > sma(${sl}) state`, strat('B', {}, all(rule(op('ema', N(f)), '>', op('sma', N(sl)))), any(rule(op('ema', N(f)), '<', op('sma', N(sl))))));
}
// C. Absolute momentum: 12-month / 6-month return positive
for (const n of [63, 126, 189, 252]) for (const b of [0, 2]) {
  test(`C roc(${n}) > ${b}`, strat('C', {}, all(rule(op('roc', N(n)), '>', op('value', N(b)))), any(rule(op('roc', N(n)), '<', op('value', N(-b))))));
}
// D. Trend + calm markets: in when above average and daily swings are not extreme
for (const n of [150, 200]) for (const v of [1.5, 2, 2.5, 3]) {
  test(`D dist(${n})>0 & atr%(20)<${v}`, strat('D', {}, all(rule(op('dist', N(n)), '>', op('value', N(0))), rule(op('atrPct', N(20)), '<', op('value', N(v)))),
    any(rule(op('dist', N(n)), '<', op('value', N(0))), rule(op('atrPct', N(20)), '>', op('value', N(v * 1.25))))));
}
out.sort((a, b) => b.e.medDeltaSharpe - a.e.medDeltaSharpe);
console.log('TRAIN 2000-2014 · sorted by median Sharpe improvement over buy & hold');
for (const o of out.slice(0, 22)) console.log(fmtRow(o.label, o.e));
console.log('... worst:'); for (const o of out.slice(-4)) console.log(fmtRow(o.label, o.e));
