/* Trading Lab engine: indicators, strategy rules, the backtest simulator and scoring.
 * No DOM here — this file runs in the page, in the auto-tuner's Web Worker and in
 * the Node script behind the automatic daily bot, so all three trade identically. */
(function (root) {
  'use strict';

  /* ---------- series ---------- */

  const DAY = 86400;
  function dayToISO(d) { return new Date(d * DAY * 1000).toISOString().slice(0, 10); }

  // Turn a stored price file ({t,o,h,l,c,v}) into typed arrays.
  function makeSeries(raw, meta) {
    const n = raw.t.length;
    return {
      sym: raw.s, name: (meta && meta.n) || raw.s, n,
      t: Int32Array.from(raw.t),
      open: Float64Array.from(raw.o), high: Float64Array.from(raw.h),
      low: Float64Array.from(raw.l), close: Float64Array.from(raw.c),
      volume: Float64Array.from(raw.v),
      _cache: new Map(),
    };
  }

  // Return a copy of the series with extra bars appended (used for live prices).
  function extendSeries(s, bars) {
    const raw = { s: s.sym, t: Array.from(s.t), o: Array.from(s.open), h: Array.from(s.high), l: Array.from(s.low), c: Array.from(s.close), v: Array.from(s.volume) };
    for (const b of bars) {
      const at = raw.t.length && raw.t[raw.t.length - 1] === b.t ? raw.t.length - 1 : raw.t.length;
      raw.t[at] = b.t; raw.o[at] = b.o; raw.h[at] = b.h; raw.l[at] = b.l; raw.c[at] = b.c; raw.v[at] = b.v || 0;
    }
    return makeSeries(raw, { n: s.name });
  }

  function indexOnOrAfter(s, day) {
    let lo = 0, hi = s.n - 1;
    if (day > s.t[hi]) return s.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s.t[m] < day) lo = m + 1; else hi = m; }
    return lo;
  }

  /* ---------- indicator maths ---------- */

  function nanArray(n) { const a = new Float64Array(n); a.fill(NaN); return a; }

  function smaOf(src, p) {
    const n = src.length, out = nanArray(n);
    if (p < 1) return out;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += src[i];
      if (i >= p) sum -= src[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  }

  function emaOf(src, p) {
    const n = src.length, out = nanArray(n), k = 2 / (p + 1);
    if (n < p) return out;
    let e = 0;
    for (let i = 0; i < p; i++) e += src[i];
    e /= p; out[p - 1] = e;
    for (let i = p; i < n; i++) { e = src[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }

  function stdOf(src, p) {
    const n = src.length, out = nanArray(n);
    let s = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
      s += src[i]; s2 += src[i] * src[i];
      if (i >= p) { s -= src[i - p]; s2 -= src[i - p] * src[i - p]; }
      if (i >= p - 1) out[i] = Math.sqrt(Math.max(0, s2 / p - (s / p) ** 2));
    }
    return out;
  }

  // Highest high / lowest low of the previous p days (today excluded, so a breakout can be seen).
  function priorExtreme(src, p, isMax) {
    const n = src.length, out = nanArray(n), dq = [];
    for (let i = 0; i < n; i++) {
      // window is [i-p, i-1]
      const add = i - 1;
      if (add >= 0) {
        while (dq.length && (isMax ? src[dq[dq.length - 1]] <= src[add] : src[dq[dq.length - 1]] >= src[add])) dq.pop();
        dq.push(add);
      }
      while (dq.length && dq[0] < i - p) dq.shift();
      if (i >= p) out[i] = src[dq[0]];
    }
    return out;
  }

  function rsiOf(c, p) {
    const n = c.length, out = nanArray(n);
    if (n <= p) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= p; l /= p;
    out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = p + 1; i < n; i++) {
      const d = c[i] - c[i - 1];
      g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
      l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }

  function rocOf(c, p) {
    const n = c.length, out = nanArray(n);
    for (let i = p; i < n; i++) out[i] = (c[i] / c[i - p] - 1) * 100;
    return out;
  }

  // Yearly volatility (%) of daily closes over the last p days.
  function volOf(c, p) {
    const n = c.length, out = nanArray(n);
    let a = 0, b = 0;
    for (let i = 1; i < n; i++) {
      const r = c[i] / c[i - 1] - 1; a += r; b += r * r;
      if (i > p) { const q = c[i - p] / c[i - p - 1] - 1; a -= q; b -= q * q; }
      if (i >= p) out[i] = Math.sqrt(Math.max(0, b / p - (a / p) ** 2) * 252) * 100;
    }
    return out;
  }
  // 1 while the price is above its p-day average, with a band (%) so it doesn't flip back and forth.
  function trendStateOf(s, p, band) {
    const m = smaOf(s.close, p), out = new Float64Array(s.n);
    let on = 0;
    for (let i = 0; i < s.n; i++) {
      if (!Number.isFinite(m[i])) { out[i] = 0; continue; }
      if (on && s.close[i] < m[i] * (1 - band / 100)) on = 0;
      else if (!on && s.close[i] > m[i] * (1 + band / 100)) on = 1;
      out[i] = on;
    }
    return out;
  }

  function atrPctOf(s, p) {
    const n = s.n, tr = new Float64Array(n), out = nanArray(n);
    for (let i = 0; i < n; i++) {
      const pc = i ? s.close[i - 1] : s.close[i];
      tr[i] = Math.max(s.high[i] - s.low[i], Math.abs(s.high[i] - pc), Math.abs(s.low[i] - pc));
    }
    let a = 0;
    for (let i = 0; i < n; i++) {
      if (i < p) { a += tr[i]; if (i === p - 1) { a /= p; out[i] = a / s.close[i] * 100; } }
      else { a = (a * (p - 1) + tr[i]) / p; out[i] = a / s.close[i] * 100; }
    }
    return out;
  }

  /* ---------- the ingredient list for rules ----------
   * scale: 'price' lines can be drawn on the price chart; 'pos' needs an open position. */
  const IND = {
    close:   { label: 'Price', group: 'Price', args: [], scale: 'price', help: "The day's closing price." },
    open:    { label: 'Opening price', group: 'Price', args: [], scale: 'price' },
    high:    { label: "Day's high", group: 'Price', args: [], scale: 'price' },
    low:     { label: "Day's low", group: 'Price', args: [], scale: 'price' },
    sma:     { label: 'Average price', group: 'Averages', args: [{ name: 'days', def: 50, min: 2, max: 400 }], scale: 'price', help: 'Simple moving average: the average closing price over the last N days.' },
    ema:     { label: 'Fast-reacting average', group: 'Averages', args: [{ name: 'days', def: 20, min: 2, max: 400 }], scale: 'price', help: 'Exponential moving average: like the average price, but recent days count more.' },
    highest: { label: 'Highest price of previous', group: 'Ranges', args: [{ name: 'days', def: 55, min: 2, max: 400 }], scale: 'price', help: 'The highest daily high over the N days before today.' },
    lowest:  { label: 'Lowest price of previous', group: 'Ranges', args: [{ name: 'days', def: 20, min: 2, max: 400 }], scale: 'price', help: 'The lowest daily low over the N days before today.' },
    bbUpper: { label: 'Upper band', group: 'Ranges', args: [{ name: 'days', def: 20, min: 2, max: 200 }, { name: 'width', def: 2, min: 0.5, max: 4, step: 0.5 }], scale: 'price', help: 'Bollinger band: the average price plus a number of standard deviations. Price above it is unusually high.' },
    bbLower: { label: 'Lower band', group: 'Ranges', args: [{ name: 'days', def: 20, min: 2, max: 200 }, { name: 'width', def: 2, min: 0.5, max: 4, step: 0.5 }], scale: 'price', help: 'Bollinger band: the average price minus a number of standard deviations. Price below it is unusually low.' },
    rsi:     { label: 'RSI (0–100)', group: 'Momentum', args: [{ name: 'days', def: 14, min: 2, max: 50 }], scale: 'osc', help: 'Relative Strength Index: near 100 means it has been rising hard ("overbought"), near 0 means falling hard ("oversold").' },
    roc:     { label: '% change over', group: 'Momentum', args: [{ name: 'days', def: 1, min: 1, max: 250 }], scale: 'pct', help: 'How much the price has moved, in percent, over the last N days. 1 day = today\'s change.' },
    dist:    { label: '% vs average', group: 'Momentum', args: [{ name: 'days', def: 50, min: 2, max: 400 }], scale: 'pct', help: 'How far the price is above (positive) or below (negative) its N-day average, in percent.' },
    vol:     { label: 'Volatility % a year', group: 'Momentum', args: [{ name: 'days', def: 20, min: 5, max: 250 }], scale: 'pct', help: 'How bumpy the ride has been: the yearly volatility of daily price moves over the last N days. The S&P 500 averages about 15–20%.' },
    atrPct:  { label: 'Daily swing size %', group: 'Momentum', args: [{ name: 'days', def: 14, min: 2, max: 100 }], scale: 'pct', help: 'Average true range as a % of price: how much the stock typically moves in a day.' },
    volRatio:{ label: 'Volume vs average (×)', group: 'Volume', args: [{ name: 'days', def: 20, min: 2, max: 200 }], scale: 'x', help: "Today's trading volume divided by its N-day average. 2 means twice as busy as usual." },
    daysHeld:{ label: 'Days held', group: 'My position', args: [], scale: 'pos', help: 'Trading days since the robot bought. Only meaningful in sell rules.' },
    pnl:     { label: 'Profit since buying %', group: 'My position', args: [], scale: 'pos', help: 'Gain or loss on the current position, in percent. Only meaningful in sell rules.' },
    fromPeak:{ label: '% below best close since buying', group: 'My position', args: [], scale: 'pos', help: 'How far the price has fallen from its highest close since the robot bought (as a positive number). Only meaningful in sell rules.' },
    value:   { label: 'Number', group: 'Number', args: [{ name: 'value', def: 0, min: -1000, max: 100000, step: 'any' }], scale: 'num' },
  };

  const CMP = {
    '>': 'is above', '<': 'is below', 'xa': 'crosses above', 'xb': 'crosses below',
  };

  /* ---------- strategies ----------
   * A number in a rule is either fixed ({v: 20}) or a dial ({p: 'fast'}) that points
   * into strategy.params. Dials marked tune:true are the ones the auto-tuner turns. */

  function val(strat, x) {
    if (x == null) return NaN;
    if (x.p != null) { const d = strat.params && strat.params[x.p]; return d ? d.v : NaN; }
    return x.v;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function defaultRisk() {
    return {
      size: { v: 100 },
      stop: { on: false, v: 8 },
      take: { on: false, v: 20 },
      trail: { on: false, v: 12 },
      maxDays: { on: false, v: 20 },
    };
  }

  const RECIPES = [
    {
      id: 'shield', builtin: true, name: 'Crash shield (researched)',
      desc: 'Found by testing thousands of settings on 10 funds and checking them on years they never saw. It stays invested almost all the time and steps aside only when the price is well below its long-term average AND has just dropped sharply, then buys back quickly. Over 2000–2026 it earned about the same as holding with much smaller crashes, but it trailed holding in 2021–2026. See How it works.',
      params: {
        trend: { label: 'Long-term average (days)', v: 200, min: 100, max: 300, step: 25, tune: true },
        below: { label: 'Sell line: price vs average (%)', v: -6, min: -12, max: -2, step: 1, tune: true },
        mom: { label: 'Recent change window (days)', v: 15, min: 5, max: 60, step: 5, tune: true },
        drop: { label: 'Sell line: recent change (%)', v: -4, min: -10, max: -1, step: 1, tune: true },
      },
      buy: { mode: 'any', rules: [
        { a: { k: 'dist', args: [{ p: 'trend' }] }, cmp: '>', b: { k: 'value', args: [{ v: 0 }] } },
        { a: { k: 'roc', args: [{ p: 'mom' }] }, cmp: '>', b: { k: 'value', args: [{ v: 0 }] } },
      ] },
      sell: { mode: 'all', rules: [
        { a: { k: 'dist', args: [{ p: 'trend' }] }, cmp: '<', b: { k: 'value', args: [{ p: 'below' }] } },
        { a: { k: 'roc', args: [{ p: 'mom' }] }, cmp: '<', b: { k: 'value', args: [{ p: 'drop' }] } },
      ] },
      risk: defaultRisk(),
    },
    {
      id: 'trend', builtin: true, name: 'Trend following',
      desc: 'Buys when the short-term average price climbs above the long-term average (the trend has turned up) and sells when it drops back below.',
      params: {
        fast: { label: 'Short average (days)', v: 50, min: 10, max: 100, step: 5, tune: true },
        slow: { label: 'Long average (days)', v: 200, min: 60, max: 300, step: 10, tune: true },
      },
      buy: { mode: 'all', rules: [{ a: { k: 'sma', args: [{ p: 'fast' }] }, cmp: 'xa', b: { k: 'sma', args: [{ p: 'slow' }] } }] },
      sell: { mode: 'any', rules: [{ a: { k: 'sma', args: [{ p: 'fast' }] }, cmp: 'xb', b: { k: 'sma', args: [{ p: 'slow' }] } }] },
      risk: defaultRisk(),
    },
    {
      id: 'breakout', builtin: true, name: 'Momentum breakout',
      desc: 'Buys when the price breaks above its highest point of recent weeks (it has momentum) and sells when it falls below its recent low.',
      params: {
        entry: { label: 'Breakout lookback (days)', v: 55, min: 10, max: 120, step: 5, tune: true },
        exit: { label: 'Exit lookback (days)', v: 20, min: 5, max: 60, step: 5, tune: true },
      },
      buy: { mode: 'all', rules: [{ a: { k: 'close', args: [] }, cmp: '>', b: { k: 'highest', args: [{ p: 'entry' }] } }] },
      sell: { mode: 'any', rules: [{ a: { k: 'close', args: [] }, cmp: '<', b: { k: 'lowest', args: [{ p: 'exit' }] } }] },
      risk: defaultRisk(),
    },
    {
      id: 'dip', builtin: true, name: 'Buy the dip',
      desc: 'In a stock that is in a long-term uptrend, buys after a sharp short drop ("oversold") and sells once it bounces, or after a set number of days.',
      params: {
        rsiDays: { label: 'RSI length (days)', v: 3, min: 2, max: 10, step: 1, tune: true },
        buyBelow: { label: 'Buy when RSI below', v: 15, min: 5, max: 40, step: 5, tune: true },
        sellAbove: { label: 'Sell when RSI above', v: 70, min: 50, max: 90, step: 5, tune: true },
        trend: { label: 'Uptrend filter average (days)', v: 200, min: 50, max: 250, step: 25, tune: true },
        hold: { label: 'Max days to hold', v: 10, min: 3, max: 30, step: 1, tune: false },
      },
      buy: { mode: 'all', rules: [
        { a: { k: 'rsi', args: [{ p: 'rsiDays' }] }, cmp: '<', b: { k: 'value', args: [{ p: 'buyBelow' }] } },
        { a: { k: 'close', args: [] }, cmp: '>', b: { k: 'sma', args: [{ p: 'trend' }] } },
      ] },
      sell: { mode: 'any', rules: [
        { a: { k: 'rsi', args: [{ p: 'rsiDays' }] }, cmp: '>', b: { k: 'value', args: [{ p: 'sellAbove' }] } },
      ] },
      risk: Object.assign(defaultRisk(), { maxDays: { on: true, p: 'hold' } }),
    },
  ];

  function blankStrategy() {
    return {
      id: 'c' + Date.now().toString(36), name: 'My algorithm', desc: '',
      params: {},
      buy: { mode: 'all', rules: [{ a: { k: 'close', args: [] }, cmp: 'xa', b: { k: 'sma', args: [{ v: 50 }] } }] },
      sell: { mode: 'any', rules: [{ a: { k: 'close', args: [] }, cmp: 'xb', b: { k: 'sma', args: [{ v: 50 }] } }] },
      risk: defaultRisk(),
    };
  }

  function tunables(strat) {
    return Object.entries(strat.params || {}).filter(([, d]) => d.tune).map(([key, d]) => ({ key, ...d }));
  }

  function withValues(strat, values) {
    const s = clone(strat);
    for (const k in values) if (s.params[k]) s.params[k].v = values[k];
    return s;
  }

  function describeOperand(strat, o) {
    const d = IND[o.k];
    if (!d) return '?';
    const a = (o.args || []).map(x => fmtNum(val(strat, x)));
    switch (o.k) {
      case 'value': return a[0];
      case 'sma': return `${a[0]}-day average`;
      case 'ema': return `${a[0]}-day fast average`;
      case 'highest': return `highest price of previous ${a[0]} days`;
      case 'lowest': return `lowest price of previous ${a[0]} days`;
      case 'bbUpper': return `upper band (${a[0]} days, ${a[1]}×)`;
      case 'bbLower': return `lower band (${a[0]} days, ${a[1]}×)`;
      case 'rsi': return `${a[0]}-day RSI`;
      case 'roc': return a[0] === '1' ? "today's % change" : `% change over ${a[0]} days`;
      case 'dist': return `price % vs ${a[0]}-day average`;
      case 'atrPct': return `daily swing size % (${a[0]} days)`;
      case 'vol': return `${a[0]}-day volatility %`;
      case 'volRatio': return `volume vs ${a[0]}-day average`;
    }
    return d.label.toLowerCase();
  }
  function describeRule(strat, r) {
    return `${describeOperand(strat, r.a)} ${CMP[r.cmp]} ${describeOperand(strat, r.b)}`;
  }
  function fmtNum(x) { return Number.isFinite(x) ? String(+x.toFixed(4)) : '?'; }

  /* ---------- compiling rules against a series ---------- */

  function indicator(s, k, args) {
    const key = k + ':' + args.join(',');
    let a = s._cache.get(key);
    if (a) return a;
    const p = Math.max(1, Math.round(args[0] || 1));
    switch (k) {
      case 'close': a = s.close; break;
      case 'open': a = s.open; break;
      case 'high': a = s.high; break;
      case 'low': a = s.low; break;
      case 'sma': a = smaOf(s.close, p); break;
      case 'ema': a = emaOf(s.close, p); break;
      case 'highest': a = priorExtreme(s.high, p, true); break;
      case 'lowest': a = priorExtreme(s.low, p, false); break;
      case 'bbUpper': case 'bbLower': {
        const m = indicator(s, 'sma', [p]), sd = stdOf(s.close, p), w = args[1] == null ? 2 : args[1];
        a = new Float64Array(s.n);
        for (let i = 0; i < s.n; i++) a[i] = k === 'bbUpper' ? m[i] + w * sd[i] : m[i] - w * sd[i];
        break;
      }
      case 'rsi': a = rsiOf(s.close, p); break;
      case 'roc': a = rocOf(s.close, p); break;
      case 'dist': { const m = indicator(s, 'sma', [p]); a = new Float64Array(s.n); for (let i = 0; i < s.n; i++) a[i] = (s.close[i] / m[i] - 1) * 100; break; }
      case 'atrPct': a = atrPctOf(s, p); break;
      case 'vol': a = volOf(s.close, p); break;
      case 'trendOn': a = trendStateOf(s, p, args[1] || 0); break;
      case 'volRatio': { const m = smaOf(s.volume, p); a = new Float64Array(s.n); for (let i = 0; i < s.n; i++) a[i] = m[i] > 0 ? s.volume[i] / m[i] : NaN; break; }
      default: a = nanArray(s.n);
    }
    s._cache.set(key, a);
    if (s._cache.size > 400) s._cache.delete(s._cache.keys().next().value);
    return a;
  }

  // Returns a function (i, pos) -> number for one operand.
  function compileOperand(s, strat, o) {
    if (o.k === 'value') { const c = val(strat, o.args[0]); return () => c; }
    if (o.k === 'daysHeld') return (i, pos) => pos ? i - pos.entryIdx : NaN;
    if (o.k === 'pnl') return (i, pos) => pos ? (s.close[i] / pos.entryPrice - 1) * 100 : NaN;
    if (o.k === 'fromPeak') return (i, pos) => pos ? (1 - s.close[i] / pos.peakClose) * 100 : NaN;
    const arr = indicator(s, o.k, (o.args || []).map(x => val(strat, x)));
    return i => arr[i];
  }

  function compileRule(s, strat, r) {
    const A = compileOperand(s, strat, r.a), B = compileOperand(s, strat, r.b);
    switch (r.cmp) {
      case '>': return (i, pos) => A(i, pos) > B(i, pos);
      case '<': return (i, pos) => A(i, pos) < B(i, pos);
      case 'xa': return (i, pos) => i > 0 && A(i, pos) > B(i, pos) && A(i - 1, pos) <= B(i - 1, pos);
      case 'xb': return (i, pos) => i > 0 && A(i, pos) < B(i, pos) && A(i - 1, pos) >= B(i - 1, pos);
    }
    return () => false;
  }

  function compileGroup(s, strat, g) {
    const fns = (g.rules || []).map(r => compileRule(s, strat, r));
    if (!fns.length) return () => false;
    if (g.mode === 'any') return (i, pos) => { for (const f of fns) if (f(i, pos)) return true; return false; };
    return (i, pos) => { for (const f of fns) if (!f(i, pos)) return false; return true; };
  }

  function riskOf(strat) {
    const r = strat.risk || defaultRisk(), g = (x) => x && x.on ? val(strat, x) : NaN;
    return {
      size: Math.min(100, Math.max(1, val(strat, r.size) || 100)) / 100,
      stop: g(r.stop), take: g(r.take), trail: g(r.trail), maxDays: g(r.maxDays),
    };
  }

  /* ---------- the simulator ----------
   * Decisions are made at each day's close and carried out at the next day's open,
   * so the robot never acts on a price it could not have known. Stop-loss, trailing
   * stop and take-profit are checked against each day's low/high and fill at the
   * level (or at the open, if the price gapped straight through it). */

  function backtest(s, strat, opt) {
    const from = Math.max(1, opt.from | 0), to = Math.min(s.n - 1, opt.to == null ? s.n - 1 : opt.to);
    const capital = opt.capital || 10000, fee = (opt.fee || 0) / 100, slip = (opt.slip || 0) / 100;
    const buyFn = compileGroup(s, strat, strat.buy), sellFn = compileGroup(s, strat, strat.sell);
    const risk = riskOf(strat), record = opt.record !== false;
    let cash = capital, shares = 0, pos = null, pending = null;
    const equity = record ? new Float64Array(to - from + 1) : null;
    const trades = [];
    let peakEq = capital, maxDD = 0, inMarket = 0;
    let sumR = 0, sumR2 = 0, prevEq = capital, days = 0;

    const exit = (i, px, why) => {
      const proceeds = shares * px * (1 - fee);
      cash += proceeds;
      const t = trades[trades.length - 1];
      t.exitIdx = i; t.exitPrice = px; t.why = why; t.ret = (proceeds / t.cost - 1) * 100;
      shares = 0; pos = null;
    };

    for (let i = from; i <= to; i++) {
      // 1. carry out yesterday's decision at today's open
      if (pending === 'buy' && !pos) {
        const px = s.open[i] * (1 + slip), eq = cash, cost = eq * risk.size;
        shares = cost * (1 - fee) / px; cash -= cost;
        pos = { entryIdx: i, entryPrice: px, peakHigh: px, peakClose: px };
        trades.push({ entryIdx: i, entryPrice: px, cost, shares });
      } else if (pending && pending !== 'buy' && pos) {
        exit(i, s.open[i] * (1 - slip), pending.why);
      }
      pending = null;

      // 2. protective orders during the day
      if (pos) {
        const stopLv = Number.isFinite(risk.stop) ? pos.entryPrice * (1 - risk.stop / 100) : -Infinity;
        const trailLv = Number.isFinite(risk.trail) ? pos.peakHigh * (1 - risk.trail / 100) : -Infinity;
        const lv = Math.max(stopLv, trailLv);
        const tpLv = Number.isFinite(risk.take) ? pos.entryPrice * (1 + risk.take / 100) : Infinity;
        if (s.low[i] <= lv) exit(i, Math.min(s.open[i], lv) * (1 - slip), lv === stopLv ? 'stop-loss' : 'trailing stop');
        else if (s.high[i] >= tpLv) exit(i, Math.max(s.open[i], tpLv) * (1 - slip), 'take-profit');
        else { if (s.high[i] > pos.peakHigh) pos.peakHigh = s.high[i]; if (s.close[i] > pos.peakClose) pos.peakClose = s.close[i]; }
      }

      // 3. decide at the close (pending is 'buy' or {why} for a sell)
      if (i < to) {
        if (pos) {
          if (Number.isFinite(risk.maxDays) && i - pos.entryIdx + 1 >= risk.maxDays) pending = { why: 'time limit' };
          else if (sellFn(i, pos)) pending = { why: 'sell rule' };
        } else if (buyFn(i, null)) pending = 'buy';
      }

      const eq = cash + shares * s.close[i];
      if (record) equity[i - from] = eq;
      if (pos) inMarket++;
      if (eq > peakEq) peakEq = eq;
      const dd = 1 - eq / peakEq;
      if (dd > maxDD) maxDD = dd;
      if (i > from) { const r = eq / prevEq - 1; sumR += r; sumR2 += r * r; days++; }
      prevEq = eq;
    }
    // close any open position at the last close, so results are in cash
    let openPos = null;
    if (pos) {
      openPos = { entryIdx: pos.entryIdx, entryPrice: pos.entryPrice, shares, peakHigh: pos.peakHigh, peakClose: pos.peakClose };
      exit(to, s.close[to] * (1 - slip), 'still holding');
      trades[trades.length - 1].open = true;
    }
    const final = cash;
    const years = Math.max(1 / 252, (s.t[to] - s.t[from]) / 365.25);
    const mean = days ? sumR / days : 0, sd = days ? Math.sqrt(Math.max(0, sumR2 / days - mean * mean)) : 0;
    const closed = trades.filter(t => !t.open);
    const wins = trades.filter(t => t.ret > 0);
    const grossWin = trades.reduce((a, t) => a + (t.ret > 0 ? t.ret : 0), 0);
    const grossLoss = trades.reduce((a, t) => a + (t.ret < 0 ? -t.ret : 0), 0);
    const bh = s.close[to] / s.open[from];
    const m = {
      final, totalReturn: (final / capital - 1) * 100,
      cagr: (Math.pow(Math.max(final, 1e-9) / capital, 1 / years) - 1) * 100,
      maxDD: maxDD * 100, sharpe: sd > 0 ? mean / sd * Math.sqrt(252) : 0,
      trades: trades.length, closedTrades: closed.length,
      winRate: trades.length ? wins.length / trades.length * 100 : 0,
      avgTrade: trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
      exposure: (inMarket / (to - from + 1)) * 100,
      years, bhReturn: (bh - 1) * 100, bhCagr: (Math.pow(bh, 1 / years) - 1) * 100,
    };
    m.calmar = m.maxDD > 0 ? m.cagr / m.maxDD : (m.cagr > 0 ? m.cagr : 0);
    return { from, to, equity, trades, metrics: m, openPos };
  }

  function buyHoldCurve(s, from, to, capital) {
    const out = new Float64Array(to - from + 1), base = s.open[from];
    for (let i = from; i <= to; i++) out[i - from] = capital * s.close[i] / base;
    return out;
  }

  // Drawdown and Sharpe for a buy & hold curve, for fair comparison.
  function curveStats(curve, years) {
    let peak = curve[0], mdd = 0, sum = 0, sum2 = 0;
    for (let i = 1; i < curve.length; i++) {
      if (curve[i] > peak) peak = curve[i];
      mdd = Math.max(mdd, 1 - curve[i] / peak);
      const r = curve[i] / curve[i - 1] - 1; sum += r; sum2 += r * r;
    }
    const n = curve.length - 1, mean = n ? sum / n : 0, sd = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
    const total = curve[curve.length - 1] / curve[0];
    const cagr = (Math.pow(total, 1 / years) - 1) * 100;
    return { totalReturn: (total - 1) * 100, cagr, maxDD: mdd * 100, sharpe: sd ? mean / sd * Math.sqrt(252) : 0, calmar: mdd ? cagr / (mdd * 100) : cagr };
  }

  /* ---------- goals for the auto-tuner ---------- */

  const GOALS = {
    sharpe: { label: 'Smoothest growth (Sharpe ratio)', short: 'Sharpe', get: m => m.sharpe, fmt: x => x.toFixed(2) },
    calmar: { label: 'Best growth for the pain (return ÷ worst drop)', short: 'Return ÷ drop', get: m => m.calmar, fmt: x => x.toFixed(2) },
    cagr:   { label: 'Most growth per year', short: 'Yearly growth', get: m => m.cagr, fmt: x => x.toFixed(1) + '%' },
  };

  function score(m, goal, minTrades) {
    if (m.trades < (minTrades || 0)) return -Infinity;
    const g = GOALS[goal] || GOALS.sharpe;
    const v = g.get(m);
    return Number.isFinite(v) ? v : -Infinity;
  }

  // Every combination of the tuned dials (grid) or a random sample of them.
  function paramSpace(strat, budget, rnd) {
    const ts = tunables(strat);
    const axes = ts.map(t => {
      const step = t.step || 1, vals = [];
      for (let x = t.min; x <= t.max + 1e-9; x += step) vals.push(+x.toFixed(6));
      return { key: t.key, vals };
    });
    const total = axes.reduce((a, ax) => a * ax.vals.length, 1);
    const combos = [];
    if (!axes.length) return { axes, total: 1, combos: [{}], grid: true };
    if (total <= budget) {
      const idx = axes.map(() => 0);
      for (let c = 0; c < total; c++) {
        const o = {}; axes.forEach((ax, j) => { o[ax.key] = ax.vals[idx[j]]; });
        combos.push(o);
        for (let j = 0; j < idx.length; j++) { if (++idx[j] < axes[j].vals.length) break; idx[j] = 0; }
      }
      return { axes, total, combos, grid: true };
    }
    const seen = new Set();
    rnd = rnd || Math.random;
    let guard = 0;
    while (combos.length < budget && guard++ < budget * 20) {
      const o = {}; let key = '';
      axes.forEach(ax => { const v = ax.vals[Math.floor(rnd() * ax.vals.length)]; o[ax.key] = v; key += v + ','; });
      if (seen.has(key)) continue;
      seen.add(key); combos.push(o);
    }
    // always include the current settings
    const cur = {}; axes.forEach(ax => { cur[ax.key] = strat.params[ax.key].v; });
    combos[0] = cur;
    return { axes, total, combos, grid: false };
  }

  /* ---------- live decisions ----------
   * Given history up to the latest bar and the current position, what does the
   * strategy want to do now? Used by live watch and by the automatic daily bot. */
  function decide(s, strat, position) {
    const i = s.n - 1;
    const risk = riskOf(strat);
    const pos = position ? {
      entryIdx: position.entryIdx != null ? position.entryIdx : Math.max(0, indexOnOrAfter(s, position.entryDay || s.t[i])),
      entryPrice: position.entryPrice, peakHigh: position.peakHigh || position.entryPrice,
      peakClose: position.peakClose || position.entryPrice,
    } : null;
    const checks = (g, p) => (g.rules || []).map(r => {
      const A = compileOperand(s, strat, r.a)(i, p), B = compileOperand(s, strat, r.b)(i, p);
      return { text: describeRule(strat, r), a: A, b: B, ok: compileRule(s, strat, r)(i, p) };
    });
    const buy = checks(strat.buy, null), sell = checks(strat.sell, pos);
    const groupOk = (g, list) => list.length ? (g.mode === 'any' ? list.some(c => c.ok) : list.every(c => c.ok)) : false;
    let action = 'hold', why = '';
    if (pos) {
      const px = s.close[i];
      const held = i - pos.entryIdx + 1;
      if (Number.isFinite(risk.stop) && px <= pos.entryPrice * (1 - risk.stop / 100)) { action = 'sell'; why = 'stop-loss'; }
      else if (Number.isFinite(risk.trail) && px <= pos.peakHigh * (1 - risk.trail / 100)) { action = 'sell'; why = 'trailing stop'; }
      else if (Number.isFinite(risk.take) && px >= pos.entryPrice * (1 + risk.take / 100)) { action = 'sell'; why = 'take-profit'; }
      else if (Number.isFinite(risk.maxDays) && held >= risk.maxDays) { action = 'sell'; why = 'time limit'; }
      else if (groupOk(strat.sell, sell)) { action = 'sell'; why = 'sell rule'; }
    } else if (groupOk(strat.buy, buy)) { action = 'buy'; why = 'buy rule'; }
    return { action, why, buy, sell, risk, price: s.close[i], day: s.t[i] };
  }

  /* ---------- portfolios ----------
   * A portfolio strategy holds several funds at once and rebalances on a schedule.
   * strat.type === 'portfolio', with:
   *   assets: fund symbols it may hold          safe: where unused money goes ('cash' or a fund)
   *   mode: 'fixed'    - hold fixed weights (strat.weights, in %)
   *         'trend'    - hold each asset only while its price is above its average (filter days)
   *         'momentum' - hold the top N assets by recent performance, if they pass the filter
   *   rebalance: 'monthly' | 'quarterly' | 'weekly'
   *   top, look, filter: numbers or dials, like everywhere else
   *   lookMode: 'single' (one lookback) | 'blend' (average of 1, 3, 6 and 12-month returns)
   *   absFilter: 'none' | 'positive' | 'beatsSafe' | 'trend'
   *   weighting: 'equal' | 'invvol' (calmer assets get more)
   * Decisions use each rebalance day's close; trades happen at the next day's open. */

  // Line every fund up on one calendar (the first symbol's trading days).
  function alignUniverse(seriesMap, calSym) {
    const cal = seriesMap[calSym], syms = Object.keys(seriesMap), idx = {};
    for (const sym of syms) {
      const s = seriesMap[sym], map = new Int32Array(cal.n).fill(-1);
      let j = 0;
      for (let i = 0; i < cal.n; i++) {
        while (j < s.n - 1 && s.t[j + 1] <= cal.t[i]) j++;
        map[i] = s.t[j] <= cal.t[i] ? j : -1;
      }
      idx[sym] = map;
    }
    return { cal, syms, idx, series: seriesMap };
  }

  const WARM = 260; // a fund needs about a year of history before it can be ranked
  function pfNum(strat, x, def) { const v = val(strat, x); return Number.isFinite(v) ? v : def; }

  function isRebalanceDay(cal, i, freq) {
    if (i >= cal.n - 1) return false;
    const a = new Date(cal.t[i] * 864e5), b = new Date(cal.t[i + 1] * 864e5);
    if (freq === 'daily') return true;
    if (freq === 'weekly') return b.getUTCDay() < a.getUTCDay() || cal.t[i + 1] - cal.t[i] >= 7;
    const monthEnd = a.getUTCMonth() !== b.getUTCMonth();
    if (freq === 'quarterly') return monthEnd && a.getUTCMonth() % 3 === 2;
    return monthEnd;
  }

  // Target weights (fractions summing to 1, 'cash' included) at the close of calendar day i.
  function portfolioTargets(U, strat, i) {
    const out = { cash: 0 }, info = [];
    const safe = strat.safe && strat.safe !== 'cash' && U.idx[strat.safe] && U.idx[strat.safe][i] >= WARM ? strat.safe : 'cash';
    const add = (sym, w) => { if (w > 0) out[sym] = (out[sym] || 0) + w; };
    const px = (sym) => { const j = U.idx[sym][i]; return j >= 0 ? U.series[sym].close[j] : NaN; };
    const ret = (sym, days) => { const j = U.idx[sym][i]; if (j < days) return NaN; const c = U.series[sym].close; return (c[j] / c[j - days] - 1) * 100; };
    const lookMode = strat.lookMode || 'single', look = Math.round(pfNum(strat, strat.look, 126));
    const momentum = (sym) => lookMode === 'blend' ? (ret(sym, 21) + ret(sym, 63) + ret(sym, 126) + ret(sym, 252)) / 4 : ret(sym, look);
    const filterDays = Math.round(pfNum(strat, strat.filter, 200));
    const aboveAvg = (sym) => { const s = U.series[sym], j = U.idx[sym][i]; const m = indicator(s, 'sma', [filterDays]); return j >= 0 && s.close[j] > m[j]; };
    const vol = (sym) => { const s = U.series[sym], j = U.idx[sym][i]; let a = 0, b = 0, n = 0; for (let k = Math.max(1, j - 62); k <= j; k++) { const r = s.close[k] / s.close[k - 1] - 1; a += r; b += r * r; n++; } const m = a / n; return Math.sqrt(Math.max(1e-12, b / n - m * m)); };
    const eligible = (strat.assets || []).filter(sym => U.idx[sym] && U.idx[sym][i] >= WARM);
    const safeMom = safe === 'cash' ? 0 : momentum(safe);
    const passes = (sym, score) => {
      const f = strat.absFilter || 'none';
      if (f === 'positive') return score > 0;
      if (f === 'beatsSafe') return score > safeMom;
      if (f === 'trend') return aboveAvg(sym);
      return true;
    };
    const weigh = (list) => {
      if (strat.weighting === 'invvol') { const inv = list.map(s2 => 1 / vol(s2)), tot = inv.reduce((a, b) => a + b, 0); return list.map((s2, k) => inv[k] / tot); }
      return list.map(() => 1 / list.length);
    };
    if (strat.mode === 'leverage') {
      // Boost: hold up to 2x the base fund while its trend is up (optionally steered by volatility), T-bills otherwise.
      const base = strat.base || 'SPY', lev = strat.lev || 'SSO', levX = strat.levX || 2;
      const bs = U.series[base], jb = U.idx[base][i];
      if (jb < 0 || !U.idx[lev] || U.idx[lev][i] < 0) { add(safe, 1); return { weights: out, info, safe }; }
      const on = indicator(bs, 'trendOn', [Math.round(pfNum(strat, strat.trendDays, 150)), pfNum(strat, strat.band, 3)])[jb];
      let e = on ? pfNum(strat, strat.boost, 1.5) : 0;
      if (on && strat.steer === 'vol') {
        const v = indicator(bs, 'vol', [Math.round(pfNum(strat, strat.volDays, 20))])[jb];
        if (v > 0) e = Math.round(Math.min(pfNum(strat, strat.cap, 2), pfNum(strat, strat.tv, 21) / v) * 4) / 4; // quarter steps, to limit trading
      }
      e = Math.max(0, Math.min(levX, e));
      if (e <= 1) { add(base, e); add(safe, 1 - e); }
      else { const wl = (e - 1) / (levX - 1); add(lev, wl); add(base, 1 - wl); }
      info.push({ sym: base, ok: !!on, score: e, exposure: e });
      return { weights: out, info, safe, exposure: e };
    }
    if (!eligible.length) { add(safe, 1); return { weights: out, info, safe }; }
    if (strat.mode === 'fixed') {
      const w = strat.weights || {}, tot = eligible.reduce((a, s2) => a + (+w[s2] || 0), 0);
      if (tot <= 0) add(safe, 1); else eligible.forEach(s2 => add(s2, (+w[s2] || 0) / tot));
      eligible.forEach(s2 => info.push({ sym: s2, ok: true }));
    } else if (strat.mode === 'trend') {
      const base = strat.weights && Object.keys(strat.weights).length ? strat.weights : null;
      const tot = base ? eligible.reduce((a, s2) => a + (+base[s2] || 0), 0) : eligible.length;
      const invw = strat.weighting === 'invvol' ? weigh(eligible) : null;
      eligible.forEach((s2, k) => {
        const w0 = invw ? invw[k] : base ? (+base[s2] || 0) / tot : 1 / eligible.length;
        const ok = aboveAvg(s2);
        info.push({ sym: s2, ok, score: (px(s2) / indicator(U.series[s2], 'sma', [filterDays])[U.idx[s2][i]] - 1) * 100 });
        add(ok ? s2 : safe, w0);
      });
    } else {
      const top = Math.max(1, Math.round(pfNum(strat, strat.top, 3)));
      const ranked = eligible.map(s2 => ({ sym: s2, score: momentum(s2) })).filter(x => Number.isFinite(x.score)).sort((a, b) => b.score - a.score);
      const picks = ranked.slice(0, top), slot = 1 / top;
      const chosen = picks.filter(x => passes(x.sym, x.score));
      const w = chosen.length ? weigh(chosen.map(x => x.sym)) : [];
      const invested = chosen.length * slot;
      chosen.forEach((x, k) => add(x.sym, strat.weighting === 'invvol' ? w[k] * invested : slot));
      add(safe, 1 - invested);
      ranked.forEach((x, k) => info.push({ sym: x.sym, score: x.score, rank: k + 1, ok: chosen.includes(x) }));
    }
    return { weights: out, info, safe };
  }

  function backtestPortfolio(U, strat, opt) {
    const cal = U.cal, from = Math.max(1, opt.from | 0), to = Math.min(cal.n - 1, opt.to == null ? cal.n - 1 : opt.to);
    const capital = opt.capital || 10000, fee = (opt.fee || 0) / 100, slip = (opt.slip || 0) / 100, band = opt.band == null ? 0.02 : opt.band;
    const freq = strat.rebalance || 'monthly', record = opt.record !== false;
    const hold = {}; let cash = capital;
    const equity = record ? new Float64Array(to - from + 1) : null, rebal = [];
    let pending = null, peak = capital, maxDD = 0, sumR = 0, sumR2 = 0, prev = capital, days = 0, orders = 0, turnover = 0, invested = 0;
    const price = (sym, i, k) => { const j = U.idx[sym][i]; return j >= 0 ? U.series[sym][k][j] : NaN; };
    for (let i = from; i <= to; i++) {
      if (pending) {
        // value everything at today's open, then trade toward the targets: sells first, then buys
        let E = cash; const val0 = {};
        for (const sym in hold) { const p = price(sym, i, 'open'); val0[sym] = hold[sym] * p; E += val0[sym]; }
        const tgt = pending.weights, syms = new Set([...Object.keys(hold), ...Object.keys(tgt)]); syms.delete('cash');
        const buys = [];
        for (const sym of syms) {
          const want = (tgt[sym] || 0) * E, have = val0[sym] || 0, diff = want - have;
          const full = !tgt[sym] || !have;
          if (Math.abs(diff) < band * E && !full) continue;
          if (diff < 0) {
            const p = price(sym, i, 'open') * (1 - slip), sh = Math.min(hold[sym], -diff / price(sym, i, 'open'));
            cash += sh * p * (1 - fee); hold[sym] -= sh; if (hold[sym] < 1e-9) delete hold[sym];
            orders++; turnover += sh * p;
          } else if (diff > 0) buys.push([sym, diff]);
        }
        const need = buys.reduce((a, [, d]) => a + d, 0), scale = need > cash ? cash / need : 1;
        for (const [sym, d] of buys) {
          const spend = d * scale, p = price(sym, i, 'open') * (1 + slip);
          if (!(p > 0) || spend <= 0) continue;
          hold[sym] = (hold[sym] || 0) + spend * (1 - fee) / p; cash -= spend;
          orders++; turnover += spend;
        }
        pending = null;
      }
      let E = cash, risky = 0;
      for (const sym in hold) { const v = hold[sym] * price(sym, i, 'close'); E += v; if (sym !== (strat.safe || 'cash')) risky += v; }
      if (record) equity[i - from] = E;
      invested += E > 0 ? risky / E : 0;
      if (E > peak) peak = E;
      maxDD = Math.max(maxDD, 1 - E / peak);
      if (i > from) { const r = E / prev - 1; sumR += r; sumR2 += r * r; days++; }
      prev = E;
      if (i < to && (i === from || isRebalanceDay(cal, i, freq))) {
        const t = portfolioTargets(U, strat, i);
        pending = t;
        if (record) rebal.push({ i, weights: t.weights, info: t.info });
      }
    }
    const final = prev, years = Math.max(1 / 252, (cal.t[to] - cal.t[from]) / 365.25);
    const mean = days ? sumR / days : 0, sd = days ? Math.sqrt(Math.max(0, sumR2 / days - mean * mean)) : 0;
    const m = {
      final, totalReturn: (final / capital - 1) * 100, cagr: (Math.pow(Math.max(final, 1e-9) / capital, 1 / years) - 1) * 100,
      maxDD: maxDD * 100, sharpe: sd > 0 ? mean / sd * Math.sqrt(252) : 0, trades: orders, years,
      exposure: invested / (to - from + 1) * 100, turnover: turnover / capital / years * 100,
      winRate: 0, avgTrade: 0,
    };
    m.calmar = m.maxDD > 0 ? m.cagr / m.maxDD : m.cagr;
    return { from, to, equity, rebal, metrics: m, holdings: hold, cash };
  }

  // What the portfolio should hold now (for the live bot): targets from the latest close.
  function decidePortfolio(U, strat) { return portfolioTargets(U, strat, U.cal.n - 1); }

  const pfDials = () => ({
    top: { label: 'How many funds to hold', v: 3, min: 1, max: 5, step: 1, tune: true },
    look: { label: 'Momentum lookback (days)', v: 126, min: 21, max: 252, step: 21, tune: true },
    filter: { label: 'Trend average (days)', v: 150, min: 50, max: 300, step: 25, tune: true },
  });
  const pfBase = (o) => Object.assign({ type: 'portfolio', builtin: true, rebalance: 'monthly', safe: 'SHY', weighting: 'equal', lookMode: 'blend', absFilter: 'none', top: { p: 'top' }, look: { p: 'look' }, filter: { p: 'filter' }, params: pfDials() }, o);
  const levDials = (o) => Object.assign({
    boost: { label: 'Boost: how many times the S&P 500 (x)', v: 1.5, min: 1, max: 2, step: 0.25, tune: true },
    trendDays: { label: 'Trend average (days)', v: 150, min: 50, max: 300, step: 25, tune: true },
    band: { label: 'Buffer around the average (%)', v: 3, min: 0, max: 5, step: 1, tune: true },
    tv: { label: 'Target volatility (% a year)', v: 21, min: 10, max: 30, step: 1, tune: false },
    volDays: { label: 'Volatility lookback (days)', v: 20, min: 10, max: 60, step: 5, tune: false },
    cap: { label: 'Most boost allowed (x)', v: 2, min: 1, max: 2, step: 0.25, tune: false },
  }, o);
  const levBase = (o) => pfBase(Object.assign({ mode: 'leverage', assets: ['SPY', 'SSO'], safe: 'BIL', base: 'SPY', lev: 'SSO', levX: 2, rebalance: 'daily', steer: 'trend',
    boost: { p: 'boost' }, trendDays: { p: 'trendDays' }, band: { p: 'band' }, tv: { p: 'tv' }, volDays: { p: 'volDays' }, cap: { p: 'cap' } }, o));
  const PORTFOLIOS = [
    levBase({ id: 'lev-gentle', name: 'Gentle boost: 1.5x while trending up (researched)', params: levDials(),
      desc: 'Holds 1.5x the S&P 500 (a mix of the S&P 500 fund and a 2x fund) while it is more than 3% above its 150-day average, and T-bills after it falls 3% below. The only research pick that beat holding in both fresh tests: 1950–2000 and 1928–1949. Over 1928–2026 it grew 11.5% a year against 9.6%, with a worst drop of 54% against 84%. It still trailed holding in 2021–2026, and a sudden one-day crash can hit before it switches.' }),
    levBase({ id: 'lev-steer', name: 'Smooth boost: trend + volatility steering (researched)', steer: 'vol', params: levDials({
      boost: { label: 'Boost when not steering (x)', v: 1.5, min: 1, max: 2, step: 0.25, tune: false },
      trendDays: { label: 'Trend average (days)', v: 200, min: 50, max: 300, step: 25, tune: true },
      band: { label: 'Buffer around the average (%)', v: 2, min: 0, max: 5, step: 1, tune: true },
      tv: { label: 'Target volatility (% a year)', v: 21, min: 10, max: 30, step: 1, tune: true } }),
      desc: 'While the S&P 500 is above its 200-day average, holds more when the market is calm and less when it is wild (aiming for 21% yearly volatility, at most 2x); T-bills otherwise. Best numbers in the 1950–2000 fresh exam (16.0% a year against 12.7%, worst drop 39% against 48%) and the smallest drop of 2021–2026. It was not the rule\'s pick, because it trailed holding in 2011–2020, and it trades more often.' }),
    levBase({ id: 'lev-moderate', name: 'Moderate boost: 2x while trending up (researched)', params: levDials({
      boost: { label: 'Boost: how many times the S&P 500 (x)', v: 2, min: 1, max: 2, step: 0.25, tune: true },
      band: { label: 'Buffer around the average (%)', v: 2, min: 0, max: 5, step: 1, tune: true } }),
      desc: 'Holds 2x the S&P 500 while it is above its 150-day average, T-bills otherwise. The most growth of the sensible options: 13.5% a year over 1928–2026. But it failed the 1950–2000 exam: on Black Monday 1987 it lost about 35% in one day, before its switch could react. It also lost 35% in 2022.' }),
    pfBase({ id: 'pf-balanced', name: 'Balanced: stocks, bonds and gold (researched)', mode: 'fixed', assets: ['SPY', 'TLT', 'GLD'], weights: { SPY: 50, TLT: 35, GLD: 15 },
      desc: 'Half in the S&P 500, a third in long-term government bonds and the rest in gold, topped back up every month. In the research it had much smaller crashes than stocks alone (in 2008 it lost 10% while the S&P 500 lost 37%), but it grew more slowly and trailed the S&P 500 badly in 2021–2026, when bonds fell with stocks.' }),
    pfBase({ id: 'pf-steady', name: 'Steady: mostly bonds (researched)', mode: 'fixed', assets: ['SPY', 'IEF', 'GLD'], weights: { SPY: 30, IEF: 60, GLD: 10 },
      desc: 'Mostly medium-term government bonds, with some stocks and gold. The research\'s smoothest mix: small drops, but slow growth.' }),
    pfBase({ id: 'pf-momentum', name: 'Momentum rotation', mode: 'momentum', assets: ['SPY', 'EFA', 'TLT', 'GLD'],
      desc: 'Each month it holds the 3 of US stocks, international stocks, long-term bonds and gold that have risen most recently. It wasn\'t the research pick, but it held up best in the 2021–2026 exam, while still trailing the S&P 500.' }),
    pfBase({ id: 'pf-trend', name: 'Trend-protected mix', mode: 'trend', assets: ['SPY', 'IEF', 'GLD'], weights: { SPY: 30, IEF: 50, GLD: 20 },
      desc: 'A mix of stocks, bonds and gold where each part steps aside into short-term bonds while its price is below its long-term average. Very small drops, low growth.' }),
    pfBase({ id: 'pf-6040', name: 'Classic 60/40', mode: 'fixed', assets: ['SPY', 'IEF'], weights: { SPY: 60, IEF: 40 },
      desc: 'The traditional mix: 60% US stocks and 40% medium-term Treasury bonds, rebalanced monthly.' }),
    pfBase({ id: 'pf-permanent', name: 'Permanent portfolio', mode: 'fixed', assets: ['SPY', 'TLT', 'GLD', 'SHY'], weights: { SPY: 25, TLT: 25, GLD: 25, SHY: 25 },
      desc: 'A quarter each in stocks, long-term bonds, gold and short-term bonds (cash-like): built to hold up in any economy.' }),
    pfBase({ id: 'pf-spy', name: 'S&P 500 only', mode: 'fixed', assets: ['SPY'], weights: { SPY: 100 }, desc: 'Just the S&P 500 index fund, for comparison.' }),
  ];

  root.TL = {
    DAY, dayToISO, makeSeries, extendSeries, indexOnOrAfter, indicator,
    IND, CMP, RECIPES, GOALS, blankStrategy, defaultRisk, tunables, withValues, clone, val,
    describeRule, describeOperand, fmtNum, riskOf,
    backtest, buyHoldCurve, curveStats, score, paramSpace, decide,
    alignUniverse, portfolioTargets, backtestPortfolio, decidePortfolio, isRebalanceDay, PORTFOLIOS, WARM,
  };
})(typeof self !== 'undefined' ? self : globalThis);
