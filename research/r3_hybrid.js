const B = require('./bench.js');
const { evalBasket, fmtRow, op, rule, N, strat } = B;
const all = (...r) => ({ mode: 'all', rules: r }), any = (...r) => ({ mode: 'any', rules: r });
const trends = {
  'dist200>3': [rule(op('dist', N(200)), '>', op('value', N(3))), rule(op('dist', N(200)), '<', op('value', N(-3)))],
  'dist200>0': [rule(op('dist', N(200)), '>', op('value', N(0))), rule(op('dist', N(200)), '<', op('value', N(0)))],
  'sma50>200': [rule(op('sma', N(50)), '>', op('sma', N(200))), rule(op('sma', N(50)), '<', op('sma', N(200)))],
  'sma20>250': [rule(op('sma', N(20)), '>', op('sma', N(250))), rule(op('sma', N(20)), '<', op('sma', N(250)))],
  'roc252>2': [rule(op('roc', N(252)), '>', op('value', N(2))), rule(op('roc', N(252)), '<', op('value', N(-2)))],
};
const out = [];
for (const [tn, [tin, tout]] of Object.entries(trends)) {
  for (const rp of [2, 3]) for (const x of [5, 10, 20]) for (const y of [50, 65, 80]) {
    // In on the trend OR on a deep short-term dip; out only when the trend is broken AND the dip has bounced.
    const st = strat('H', {}, any(tin, rule(op('rsi', N(rp)), '<', op('value', N(x)))), all(tout, rule(op('rsi', N(rp)), '>', op('value', N(y)))));
    out.push({ label: `H ${tn} | rsi${rp}<${x} | out rsi>${y}`, e: evalBasket(st, 'train') });
  }
}
out.sort((a, b) => b.e.medDeltaSharpe - a.e.medDeltaSharpe);
console.log('TRAIN 2000-2014 · trend + dip hybrids, sorted by median Sharpe improvement');
for (const o of out.slice(0, 20)) console.log(fmtRow(o.label, o.e));
// how flat is the top? show spread by trend family
for (const tn of Object.keys(trends)) { const xs = out.filter(o => o.label.includes(tn)).map(o => o.e.medDeltaSharpe); console.log(tn.padEnd(12), 'best', Math.max(...xs).toFixed(2), 'median', B.median(xs).toFixed(2), 'worst', Math.min(...xs).toFixed(2)); }
