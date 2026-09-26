// D. Sector rotation with the 10 Ken French industry groups: each month hold the top K by momentum.
const X = require('./xbench.js'); const { D, N } = X;
const names = Object.keys(D.ind);
const IP = {}; for (const n of names) { const p = new Float64Array(N); p[0] = 1; for (let i = 1; i < N; i++) p[i] = p[i - 1] * (1 + (D.ind[n][i] || 0)); IP[n] = p; }
const monthEnd = (i) => i < N - 1 && Math.floor(D.d[i] / 100) !== Math.floor(D.d[i + 1] / 100);
function simInd({ K, look, skip = 21, trendF }, period) {
  const { from, to } = X.win(period);
  let w = {}, pending = null, eq = 1, peak = 1, mdd = 0, s = 0, s2 = 0, n = 0;
  const trendOn = trendF ? require('./xfam.js').trend(200, 2) : null;
  for (let i = from - 30; i <= to; i++) {
    if (i >= from) {
      let r = 0, tw = 0; for (const k in w) { r += w[k] * (D.ind[k][i] || 0); tw += w[k]; } r += (1 - tw) * D.rf[i];
      eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak); const ex = r - D.rf[i]; s += ex; s2 += ex * ex; n++;
    }
    if (pending) { let turn = 0; const all = new Set([...Object.keys(w), ...Object.keys(pending)]); for (const k of all) turn += Math.abs((pending[k] || 0) - (w[k] || 0)); if (i >= from) eq *= 1 - turn * 0.001; w = pending; pending = null; }
    if (monthEnd(i)) {
      const score = names.map(k => ({ k, m: IP[k][i - skip] / IP[k][i - look] - 1 })).filter(x => Number.isFinite(x.m)).sort((a, b) => b.m - a.m);
      const pick = score.slice(0, K), nw = {};
      const on = trendOn ? trendOn[i] : 1;
      for (const x of pick) nw[x.k] = on ? 1 / K : 0;
      pending = nw;
    }
  }
  const yrs = n / 252, mean = s / n, sd = Math.sqrt(s2 / n - mean * mean);
  return { cagr: (eq ** (1 / yrs) - 1) * 100, maxDD: mdd * 100, sharpe: mean / sd * Math.sqrt(252), avgExposure: 1 };
}
module.exports = { simInd };
if (require.main === module) {
  const bh = { d: X.simulate(X.HOLD, 'design'), a: X.simulate(X.HOLD, 'designA'), b: X.simulate(X.HOLD, 'designB') };
  const rows = [];
  for (const K of [1, 2, 3, 4, 5]) for (const look of [63, 126, 189, 252]) for (const trendF of [false, true]) {
    const c = { K, look, trendF }, d = simInd(c, 'design'), a = simInd(c, 'designA'), b = simInd(c, 'designB');
    const ok = d.maxDD <= bh.d.maxDD; rows.push({ c, d, a, b, score: ok ? Math.min(a.cagr - bh.a.cagr, b.cagr - bh.b.cagr) : -99 });
  }
  rows.sort((x, y) => y.score - x.score);
  console.log(`D. Sector rotation: ${rows.filter(r => r.score > 0).length} of ${rows.length} beat holding by the rule`);
  for (const r of rows.slice(0, 8)) console.log(`  ${r.score.toFixed(2).padStart(6)} ${JSON.stringify(r.c).padEnd(40)} 2001-20 ${X.fm(r.d)} | 00s ${r.a.cagr.toFixed(1)}% | 10s ${r.b.cagr.toFixed(1)}%`);
  const F = require('./xfam.js');
  console.log('\nBest moderate leverage settings (A family) on 2001-2020:');
  for (const L of [1.5, 2]) { let best = null; for (const n of [100, 150, 200, 250]) for (const b2 of [0, 1, 2, 3]) { const e = F.A({ L, n, b: b2 }); const d = X.simulate(e, 'design'), a = X.simulate(e, 'designA'), b3 = X.simulate(e, 'designB'); const sc = d.maxDD <= bh.d.maxDD ? Math.min(a.cagr - bh.a.cagr, b3.cagr - bh.b.cagr) : -99; if (!best || sc > best.sc) best = { sc, n, b: b2, d, a, b3 }; } console.log(`  ${L}x: n=${best.n} band=${best.b}% · ${X.fm(best.d)} | 00s ${best.a.cagr.toFixed(1)}% | 10s ${best.b3.cagr.toFixed(1)}% | rule score ${best.sc.toFixed(2)}`); }
}
