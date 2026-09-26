// Strategy families as exposure functions.
const X = require('./xbench.js');
const { D, N, P, sma, rv, roc } = X;
// A: leverage while the trend is up (with a band to avoid whipsaws), otherwise T-bills
function trendState(n, b) {
  return X.__memo ? null : (() => {
    const m = sma(n), o = new Uint8Array(N); let on = 0;
    for (let i = 0; i < N; i++) { if (!Number.isFinite(m[i])) { o[i] = 0; continue; } if (on && P[i] < m[i] * (1 - b / 100)) on = 0; else if (!on && P[i] > m[i] * (1 + b / 100)) on = 1; o[i] = on; }
    return o;
  })();
}
const tcache = new Map();
const trend = (n, b) => { const k = n + '|' + b; if (!tcache.has(k)) tcache.set(k, trendState(n, b)); return tcache.get(k); };
const A = ({ L, n, b }) => { const t = trend(n, b); return (i) => i < 0 ? 0 : t[i] ? L : 0; };
// B: volatility steering: hold target / recent volatility, capped; only trade when the change is meaningful
const B = ({ tv, n, cap, band = 0.1 }) => { const v = rv(n); let last = 1; return (i) => { if (i < 0 || !Number.isFinite(v[i])) return 1; const w = Math.min(cap, tv / 100 / v[i]); if (Math.abs(w - last) >= band) last = w; return last; }; };
// AB: trend on AND volatility steering
const AB = ({ tv, n, cap, tn, b }) => { const t = trend(tn, b), v = rv(n); let last = 0; return (i) => { if (i < 0 || !Number.isFinite(v[i])) return 0; const w = t[i] ? Math.min(cap, tv / 100 / v[i]) : 0; if (Math.abs(w - last) >= 0.1 || w === 0) last = w; return last; }; };
// C: more clues. Each clue is bullish (1) or bearish (0); missing data counts as bullish (neutral).
const clue = {
  trend: (i) => { const m = sma(200)[i]; return Number.isFinite(m) ? +(P[i] > m) : 1; },
  mom: (i) => { const r = roc(126)[i]; return Number.isFinite(r) ? +(r > 0) : 1; },
  calm: (i) => { const a = rv(20)[i], b2 = rv(252)[i]; return Number.isFinite(a) && Number.isFinite(b2) ? +(a < b2) : 1; },
  curve: (i) => { const y = D.y10[i], t = D.tb3[i]; return y != null && t != null ? +(y - t > 0) : 1; },
  credit: (i) => { const c = D.baa[i]; if (c == null) return 1; let s = 0, k = 0; for (let j = Math.max(0, i - 251); j <= i; j++) if (D.baa[j] != null) { s += D.baa[j]; k++; } return +(c < s / k + 0.25); },
  vix: (i) => { const v = D.vix[i]; return v != null ? +(v < 25) : 1; },
};
const clueCache = new Map();
function clueArr(name) { if (!clueCache.has(name)) { const o = new Uint8Array(N); for (let i = 0; i < N; i++) o[i] = clue[name](i); clueCache.set(name, o); } return clueCache.get(name); }
const C = ({ clues, L, need }) => { const arrs = clues.map(clueArr); return (i) => { if (i < 0) return 0; let k = 0; for (const a of arrs) k += a[i]; return k >= need ? L * (k / arrs.length) : 0; }; };
module.exports = { A, B, AB, C, trend, clueArr };
