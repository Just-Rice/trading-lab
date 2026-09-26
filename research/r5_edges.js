const B = require('./bench.js');
const { evalBasket, fmtRow, op, rule, N, strat } = B;
const all = (...r) => ({ mode: 'all', rules: r }), any = (...r) => ({ mode: 'any', rules: r });
const score = (e) => e.medDeltaSharpe + 0.015 * (e.medCagr - e.medBhCagr);
const T2 = (c) => strat('T2', {}, any(rule(op('dist', N(c.n)), '>', op('value', N(c.b))), rule(op('rsi', N(c.p)), '<', op('value', N(c.x)))),
  all(rule(op('dist', N(c.n)), '<', op('value', N(-c.b))), rule(op('rsi', N(c.p)), '>', op('value', N(c.y)))));
const T1 = (c) => strat('T1', {}, any(rule(op('sma', N(c.f)), '>', op('sma', N(c.s))), rule(op('rsi', N(c.p)), '<', op('value', N(c.x)))),
  all(rule(op('sma', N(c.f)), '<', op('sma', N(c.s))), rule(op('rsi', N(c.p)), '>', op('value', N(c.y)))));
const rows = [];
for (const n of [200, 250]) for (const b of [4, 5, 6]) for (const p of [4, 5, 6]) for (const y of [30, 40]) rows.push(['T2', { n, b, p, x: 10, y }, T2]);
for (const s of [250, 300]) for (const p of [4, 5, 6]) for (const y of [30, 40]) rows.push(['T1', { f: 10, s, p, x: 10, y }, T1]);
const out = rows.map(([t, c, f]) => { const e = evalBasket(f(c), 'train'); return { t, c, e, s: score(e) }; }).sort((a, b) => b.s - a.s);
for (const r of out.slice(0, 14)) console.log(r.s.toFixed(3), fmtRow(r.t + ' ' + JSON.stringify(r.c), r.e));
console.log('--- score by RSI length (avg):'); for (const p of [4, 5, 6]) { const xs = out.filter(r => r.c.p === p).map(r => r.s); console.log(p, (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)); }
console.log('--- score by band b (T2 avg):'); for (const b of [4, 5, 6]) { const xs = out.filter(r => r.c.b === b).map(r => r.s); console.log(b, (xs.reduce((a, b2) => a + b2, 0) / xs.length).toFixed(3)); }
