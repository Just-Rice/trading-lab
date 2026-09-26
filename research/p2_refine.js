const B = require('./pbench.js');
const { P, fm, bm, run } = B;
// Selection rule, fixed before looking at 2021-2026: worse-of-two-periods score vs SPY,
// where 1% of yearly growth is worth 0.03 of Sharpe; choose from a stable area (neighbour average).
const sc = (m, b) => (m.sharpe - b.sharpe) + 0.03 * (m.cagr - b.cagr);
const ev = (st) => { const t = run(st, 'train').metrics, v = run(st, 'valid').metrics; return { t, v, robust: Math.min(sc(t, bm.train.spy), sc(v, bm.valid.spy)) }; };
const rows = [];
for (const bond of ['TLT', 'IEF']) for (const eq of [30, 40, 50, 60, 70]) for (const g of [0, 10, 15, 20, 25, 30]) {
  const b = 100 - eq - g; if (b < 10) continue;
  const w = { SPY: eq, [bond]: b, GLD: g };
  const assets = Object.keys(w).filter(k => w[k] > 0);
  rows.push({ fam: 'fixed', bond, eq, g, f: 0, safe: '-', ...ev(P({ mode: 'fixed', assets, weights: w })) });
  for (const f of [100, 150, 200, 250]) for (const safe of ['SHY', 'cash'])
    rows.push({ fam: 'trend', bond, eq, g, f, safe, ...ev(P({ mode: 'trend', assets, weights: w, filter: { v: f }, safe })) });
}
// neighbour smoothing inside each (fam, bond, safe) over eq, g, f
const key = (r) => [r.fam, r.bond, r.safe, r.eq, r.g, r.f].join('|');
const byKey = new Map(rows.map(r => [key(r), r]));
const steps = { eq: [30, 40, 50, 60, 70], g: [0, 10, 15, 20, 25, 30], f: [100, 150, 200, 250] };
for (const r of rows) {
  let s = r.robust, n = 1;
  for (const d of ['eq', 'g', ...(r.fam === 'trend' ? ['f'] : [])]) { const i = steps[d].indexOf(r[d]); for (const k of [-1, 1]) { const x = steps[d][i + k]; if (x === undefined) continue; const o = byKey.get(key({ ...r, [d]: x })); if (o) { s += o.robust; n++; } } }
  r.smooth = s / n;
}
const lab = (r) => `${r.fam} SPY${r.eq}/${r.bond}${100 - r.eq - r.g}/GLD${r.g}${r.fam === 'trend' ? ` sma${r.f}→${r.safe}` : ''}`;
for (const fam of ['fixed', 'trend']) {
  const list = rows.filter(r => r.fam === fam).sort((a, b) => b.smooth - a.smooth);
  console.log(`\n${fam.toUpperCase()} top by stable robust score:`);
  for (const r of list.slice(0, 8)) console.log(r.smooth.toFixed(3), r.robust.toFixed(3), lab(r).padEnd(40), '| design', fm(r.t), '| check', fm(r.v));
  console.log(`share beating SPY in both periods: ${(list.filter(r => r.robust > 0).length / list.length * 100).toFixed(0)}%`);
}
console.log(`\nSPY design ${fm(bm.train.spy)} | check ${fm(bm.valid.spy)}`);
