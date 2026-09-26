const B = require('./bench.js'); const C = require('./cands.js');
for (const period of ['train', 'valid']) {
  console.log(`\n=== ${period === 'train' ? 'DESIGN 2000-2014' : 'CHECK 2015-2020 (never used for tuning)'} ===`);
  for (const [n, mk] of [['Buy & hold', C.BH], ['Simple trend: sma50>sma200', C.SMA], ['Simple trend: dist200 ±3%', C.DIST], ['Finalist C1', C.C1], ['Finalist C2', C.C2]]) console.log(B.fmtRow(n, B.evalBasket(mk(), period)));
}
console.log('\nPer fund, CHECK 2015-2020: C1 vs C2 vs buy & hold (yearly growth / worst drop / Sharpe)');
for (const sym of B.ETFS) {
  const a = B.run(C.C1(), sym, 'valid'), b = B.run(C.C2(), sym, 'valid');
  const f = (m) => `${m.cagr.toFixed(1).padStart(5)}% ${m.maxDD.toFixed(0).padStart(3)}% ${m.sharpe.toFixed(2)}`;
  console.log(sym.padEnd(5), 'C1', f(a.m), ' | C2', f(b.m), ' | B&H', f(a.bh));
}
