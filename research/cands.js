const B = require('./bench.js');
const { op, rule, N, strat } = B;
const all = (...r) => ({ mode: 'all', rules: r }), any = (...r) => ({ mode: 'any', rules: r });
const C1 = (risk) => strat('C1', {}, any(rule(op('sma', N(10)), '>', op('sma', N(250))), rule(op('rsi', N(4)), '<', op('value', N(10)))),
  all(rule(op('sma', N(10)), '<', op('sma', N(250))), rule(op('rsi', N(4)), '>', op('value', N(40)))), risk);
const C2 = (risk) => strat('C2', {}, any(rule(op('dist', N(200)), '>', op('value', N(4))), rule(op('rsi', N(4)), '<', op('value', N(10)))),
  all(rule(op('dist', N(200)), '<', op('value', N(-4))), rule(op('rsi', N(4)), '>', op('value', N(40)))), risk);
const SMA = () => strat('sma50>200', {}, all(rule(op('sma', N(50)), '>', op('sma', N(200)))), any(rule(op('sma', N(50)), '<', op('sma', N(200)))));
const DIST = () => strat('dist200±3', {}, all(rule(op('dist', N(200)), '>', op('value', N(3)))), any(rule(op('dist', N(200)), '<', op('value', N(-3)))));
const BH = () => strat('Buy & hold', {}, all(rule(op('close'), '>', op('value', N(0)))), any());
module.exports = { C1, C2, SMA, DIST, BH };
