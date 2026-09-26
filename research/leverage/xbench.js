// Research bench for exposure-based bots: hold anywhere from 0x to 3x the US stock market.
// Returns include dividends (Ken French data); uninvested money earns the T-bill rate;
// borrowed money costs the T-bill rate plus a spread, and leveraged funds charge a fee.
const fs = require('fs');
const D = JSON.parse(fs.readFileSync(__dirname + '/xdata/research.json'));
const N = D.d.length;
const COST = { trade: 0.001, spread: 0.006, levFee: 0.009 }; // per unit of exposure traded; per year
const idx = (ymd) => { let lo = 0, hi = N - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (D.d[m] < ymd) lo = m + 1; else hi = m; } return lo; };
const PERIODS = { design: [20010101, 20201231], designA: [20010101, 20101231], designB: [20110101, 20201231], exam: [19500101, 20001231], stress: [19280101, 19491231], recent: [20210101, 20260831], all: [19280101, 20260831] };
const win = (p) => { const [a, b] = PERIODS[p]; return { from: idx(a), to: Math.min(N - 1, idx(b + 1) - 1 < 0 ? N - 1 : (D.d[N - 1] <= b ? N - 1 : idx(b + 1) - 1)) }; };
// cumulative index of the market (total return), for indicators
const P = new Float64Array(N); P[0] = 1; for (let i = 1; i < N; i++) P[i] = P[i - 1] * (1 + D.mkt[i]);
const cache = new Map();
function memo(key, f) { if (!cache.has(key)) cache.set(key, f()); return cache.get(key); }
const sma = (n) => memo('sma' + n, () => { const o = new Float64Array(N).fill(NaN); let s = 0; for (let i = 0; i < N; i++) { s += P[i]; if (i >= n) s -= P[i - n]; if (i >= n - 1) o[i] = s / n; } return o; });
const rv = (n) => memo('rv' + n, () => { const o = new Float64Array(N).fill(NaN); let a = 0, b = 0; for (let i = 1; i < N; i++) { const r = D.mkt[i]; a += r; b += r * r; if (i > n) { const q = D.mkt[i - n]; a -= q; b -= q * q; } if (i >= n) o[i] = Math.sqrt(Math.max(0, b / n - (a / n) ** 2) * 252); } return o; });
const roc = (n) => memo('roc' + n, () => { const o = new Float64Array(N).fill(NaN); for (let i = n; i < N; i++) o[i] = P[i] / P[i - n] - 1; return o; });
// Simulate: expo(i) is decided at the close of day i; it is traded at the close of day i+1
// and so earns from day i+2. (A one-day delay, to be safe.)
function simulate(expo, period, opt = {}) {
  const { from, to } = typeof period === 'string' ? win(period) : period;
  const cost = { ...COST, ...(opt.cost || {}) };
  let eq = 1, peak = 1, mdd = 0, sum = 0, sum2 = 0, n = 0, held = expo(from - 2) || 0, turn = 0, prevDecision = held;
  const curve = opt.curve ? new Float64Array(to - from + 1) : null;
  let expSum = 0;
  for (let i = from; i <= to; i++) {
    const want = expo(i - 2); // decided two closes ago, traded yesterday at the close
    const e = Number.isFinite(want) ? want : held;
    const tradeCost = Math.abs(e - held) * cost.trade;
    turn += Math.abs(e - held); held = e;
    const rf = D.rf[i], m = D.mkt[i];
    let r = e * m + (1 - e) * rf;
    if (e > 1) r -= ((e - 1) * cost.spread + Math.min(1, e - 1) * cost.levFee) / 252;
    r -= tradeCost;
    eq *= 1 + r; if (curve) curve[i - from] = eq;
    peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak);
    const ex = r - rf; sum += ex; sum2 += ex * ex; n++; expSum += e;
    void prevDecision;
  }
  const years = (to - from + 1) / 252;
  const mean = sum / n, sd = Math.sqrt(Math.max(1e-18, sum2 / n - mean * mean));
  return { cagr: (Math.pow(eq, 1 / years) - 1) * 100, maxDD: mdd * 100, sharpe: mean / sd * Math.sqrt(252), final: eq, years, avgExposure: expSum / n, turnover: turn / years, curve };
}
const HOLD = () => 1;
const fm = (m) => `${m.cagr.toFixed(1).padStart(5)}%/yr  worst ${m.maxDD.toFixed(0).padStart(3)}%  Sh ${m.sharpe.toFixed(2)}  avgExp ${m.avgExposure.toFixed(2)}`;
module.exports = { D, N, P, idx, win, PERIODS, sma, rv, roc, simulate, HOLD, fm, COST };
