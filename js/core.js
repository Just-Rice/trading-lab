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
    dist:    { label: '% above average', group: 'Momentum', args: [{ name: 'days', def: 50, min: 2, max: 400 }], scale: 'pct', help: 'How far the price is above (positive) or below (negative) its N-day average, in percent.' },
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
      case 'dist': return `% above ${a[0]}-day average`;
      case 'atrPct': return `daily swing size % (${a[0]} days)`;
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

  root.TL = {
    DAY, dayToISO, makeSeries, extendSeries, indexOnOrAfter, indicator,
    IND, CMP, RECIPES, GOALS, blankStrategy, defaultRisk, tunables, withValues, clone, val,
    describeRule, describeOperand, fmtNum, riskOf,
    backtest, buyHoldCurve, curveStats, score, paramSpace, decide,
  };
})(typeof self !== 'undefined' ? self : globalThis);
