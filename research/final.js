const B = require('./bench.js');
const { op, rule, N, strat } = B;
const all = (...r) => ({ mode: 'all', rules: r }), any = (...r) => ({ mode: 'any', rules: r });
const SHIELD = () => strat('Crash shield', {},
  any(rule(op('dist', N(200)), '>', op('value', N(0))), rule(op('roc', N(15)), '>', op('value', N(0)))),
  all(rule(op('dist', N(200)), '<', op('value', N(-6))), rule(op('roc', N(15)), '<', op('value', N(-4)))));
module.exports = { SHIELD };
if (require.main === module) {
  const C = require('./cands.js');
  const f = (e) => `Sh ${e.medSharpe.toFixed(2)}  CAGR ${e.medCagr.toFixed(1)}% (hold ${e.medBhCagr.toFixed(1)}%)  worst drop ${e.medDD.toFixed(0)}% (hold ${e.medBhDD.toFixed(0)}%)  in market ${e.medExposure.toFixed(0)}%`;
  console.log('=== FINAL EXAM 2021-01 → 2026-09 (opened once) · median of 10 funds ===');
  for (const [n, mk] of [['Crash shield', SHIELD], ['Buy & hold', C.BH], ['(for reference) earlier finalist C2', C.C2], ['(for reference) simple trend sma50>200', C.SMA]]) console.log(n.padEnd(40), f(B.evalBasket(mk(), 'hold')));
  console.log('\nPer fund, final exam: yearly growth / worst drop / Sharpe');
  let beatDD = 0, beatSh = 0, beatCagr = 0;
  for (const sym of B.ETFS) {
    const a = B.run(SHIELD(), sym, 'hold');
    const g = (m) => `${m.cagr.toFixed(1).padStart(5)}% ${m.maxDD.toFixed(0).padStart(3)}% ${m.sharpe.toFixed(2).padStart(5)}`;
    if (a.m.maxDD < a.bh.maxDD - 0.5) beatDD++; if (a.m.sharpe > a.bh.sharpe) beatSh++; if (a.m.cagr > a.bh.cagr) beatCagr++;
    console.log(sym.padEnd(5), 'shield', g(a.m), ' | hold', g(a.bh), ' trades', a.m.trades);
  }
  console.log(`\nShield beat holding on: smaller worst drop ${beatDD}/10, Sharpe ${beatSh}/10, yearly growth ${beatCagr}/10`);
}
