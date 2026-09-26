const X = require('./xbench.js'); const F = require('./xfam.js');
const bh = { d: X.simulate(X.HOLD, 'design'), a: X.simulate(X.HOLD, 'designA'), b: X.simulate(X.HOLD, 'designB') };
// Fixed rule: worst drop no bigger than holding over 2001-2020, and more growth than holding in BOTH decades.
function judge(expo) {
  const d = X.simulate(expo, 'design'), a = X.simulate(expo, 'designA'), b = X.simulate(expo, 'designB');
  const ok = d.maxDD <= bh.d.maxDD;
  return { d, a, b, ok, score: ok ? Math.min(a.cagr - bh.a.cagr, b.cagr - bh.b.cagr) : -99 };
}
function grid(name, dims, mk) {
  const keys = Object.keys(dims), res = new Map();
  const rec = (i, c) => { if (i === keys.length) { res.set(keys.map(k => c[k]).join('|'), { c: { ...c }, ...judge(mk(c)) }); return; } for (const v of dims[keys[i]]) { c[keys[i]] = v; rec(i + 1, c); } };
  rec(0, {});
  for (const r of res.values()) { let s = r.score, n = 1; keys.forEach(k => { const j = dims[k].indexOf(r.c[k]); for (const dd of [-1, 1]) { const v = dims[k][j + dd]; if (v === undefined) continue; const o = res.get(keys.map(kk => kk === k ? v : r.c[kk]).join('|')); if (o) { s += Math.max(o.score, -10); n++; } } }); r.smooth = s / n; }
  const list = [...res.values()].sort((x, y) => y.smooth - x.smooth);
  const pass = list.filter(r => r.score > 0).length;
  console.log(`\n${name}: ${pass} of ${list.length} settings beat holding by the rule`);
  for (const r of list.slice(0, 6)) console.log(`  stable ${r.smooth.toFixed(2).padStart(6)} · ${JSON.stringify(r.c).padEnd(46)} 2001-20 ${X.fm(r.d)} | 00s ${r.a.cagr.toFixed(1)}% vs ${bh.a.cagr.toFixed(1)} | 10s ${r.b.cagr.toFixed(1)}% vs ${bh.b.cagr.toFixed(1)}`);
  return list;
}
console.log('Holding the market 2001-2020:', X.fm(bh.d), `| 2001-10 ${bh.a.cagr.toFixed(1)}% | 2011-20 ${bh.b.cagr.toFixed(1)}%`);
const out = {};
out.A = grid('A. Leverage + trend switch', { L: [1, 1.5, 2, 2.5, 3], n: [100, 150, 200, 250], b: [0, 1, 2, 3] }, F.A);
out.B = grid('B. Volatility steering', { tv: [10, 12, 14, 16, 18, 20], n: [20, 40, 60], cap: [1, 1.5, 2, 3] }, F.B);
out.AB = grid('A+B. Trend switch + volatility steering', { tv: [12, 15, 18, 21], n: [20, 60], cap: [1.5, 2, 3], tn: [150, 200], b: [0, 2] }, F.AB);
const CL = ['trend', 'mom', 'calm', 'curve', 'credit', 'vix'];
const sets = { 'trend+calm': ['trend', 'calm'], 'trend+mom+calm': ['trend', 'mom', 'calm'], 'trend+curve': ['trend', 'curve'], 'trend+calm+curve': ['trend', 'calm', 'curve'], 'all six': CL, 'trend+calm+vix+credit': ['trend', 'calm', 'vix', 'credit'] };
out.C = grid('C. More clues (exposure = leverage x share of bullish clues)', { set: Object.keys(sets), L: [1, 1.5, 2, 2.5, 3], need: [1, 2, 3] }, (c) => F.C({ clues: sets[c.set], L: c.L, need: Math.min(c.need, sets[c.set].length) }));

