const B = require('./pbench.js');
const fs = require('fs');
// Engine check: 100% SPY portfolio vs single-asset buy & hold on the same window
const w = B.win('full'), m = B.run(B.SPY, 'full').metrics;
const s = B.U.cal, bh = B.TL.curveStats(B.TL.buyHoldCurve(s, w.from, w.to, 10000), m.years);
console.log('100% SPY portfolio :', B.fm(m), ' orders', m.trades);
console.log('SPY buy & hold      :', `CAGR ${bh.cagr.toFixed(1).padStart(5)}%  DD ${bh.maxDD.toFixed(0).padStart(3)}%  Sh ${bh.sharpe.toFixed(2)}`);
console.log('60/40 SPY/IEF       :', B.fm(B.run(B.SIXTY, 'full').metrics), ' orders', B.run(B.SIXTY, 'full').metrics.trades);
