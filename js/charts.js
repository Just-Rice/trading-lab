/* Charts: the results panel (score tiles, price + money charts, replay, trade list)
 * and the auto-tuner's heatmap. Uses lightweight-charts for the time-series charts. */
(function () {
  'use strict';
  const LWC = window.LightweightCharts;
  const FALLBACK = { '--surface': '#1a1a19', '--muted': '#898781', '--grid': '#2c2c2a', '--axis': '#383835', '--ink': '#ffffff', '--ink-2': '#c3c2b7', '--bench': '#898781', '--good': '#0ca30c', '--bad': '#d03b3b', '--shade': 'rgba(57,135,229,.1)', '--surface-3': '#2e2e2b' };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || FALLBACK[n] || '#3987e5';
  const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
  const registry = new Set();

  /* ---------- formatting ---------- */
  const fmt = {
    money(x) { if (!Number.isFinite(x)) return '–'; const a = Math.abs(x); return (x < 0 ? '−$' : '$') + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })); },
    price(x) { return Number.isFinite(x) ? '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–'; },
    pct(x, d = 1) { return Number.isFinite(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d) + '%' : '–'; },
    pctPlain(x, d = 1) { return Number.isFinite(x) ? Math.abs(x).toFixed(d) + '%' : '–'; },
    num(x, d = 2) { return Number.isFinite(x) ? x.toFixed(d) : '–'; },
    date(day) { return new Date(day * 86400000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }); },
    year(day) { return new Date(day * 86400000).getUTCFullYear(); },
    signClass(x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- chart base ---------- */
  function baseOptions() {
    return {
      autoSize: true,
      layout: { background: { type: 'solid', color: css('--surface') }, textColor: css('--muted'), fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: 11 },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      rightPriceScale: { borderColor: css('--axis'), scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { borderColor: css('--axis'), rightOffset: 2, minBarSpacing: 0.05 },
      crosshair: { mode: 0, vertLine: { color: css('--axis'), labelBackgroundColor: css('--ink-2') }, horzLine: { color: css('--axis'), labelBackgroundColor: css('--ink-2') } },
      localization: { priceFormatter: (p) => p >= 1000 ? Math.round(p).toLocaleString('en-US') : p.toFixed(2) },
    };
  }
  function makeChart(el, onTheme) {
    const chart = LWC.createChart(el, baseOptions());
    const entry = { chart, onTheme };
    registry.add(entry);
    return { chart, dispose() { registry.delete(entry); chart.remove(); } };
  }
  function restyleAll() {
    for (const e of registry) { e.chart.applyOptions(baseOptions()); if (e.onTheme) e.onTheme(); }
    document.dispatchEvent(new CustomEvent('tl-theme'));
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restyleAll);

  const T = (day) => day * 86400;

  // Keep two charts scrolled and zoomed together.
  function syncCharts(a, b) {
    let busy = false;
    const link = (x, y) => x.timeScale().subscribeVisibleLogicalRangeChange(r => {
      if (busy || !r) return; busy = true; y.timeScale().setVisibleLogicalRange(r); busy = false;
    });
    link(a, b); link(b, a);
  }

  /* ---------- results panel ---------- */
  const SPEEDS = [[5, 'Slow'], [20, 'Normal'], [60, 'Fast'], [250, 'Very fast']];

  class Results {
    constructor(root) {
      this.root = root;
      root.innerHTML = `
        <div class="card results">
          <div class="res-head"><h2 class="r-title">Results</h2><span class="sub r-sub"></span></div>
          <p class="summary-line r-summary"></p>
          <div class="tiles main r-tiles"></div>
          <details class="fold more-numbers"><summary>More numbers</summary><div class="tiles r-more"></div></details>
          <div class="replay">
            <button class="btn sm primary r-play" aria-label="Play replay">▶ Replay</button>
            <label>Speed <select class="r-speed">${SPEEDS.map(([v, l]) => `<option value="${v}"${v === 20 ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <input type="range" class="r-scrub" min="0" max="1" value="1" aria-label="Replay position">
            <span class="rp-read r-read"><span class="muted">Watch the robot trade day by day.</span></span>
            <button class="btn sm ghost r-exit hidden">Show everything</button>
          </div>
          <div class="chart-tools">
            <label class="check"><input type="checkbox" class="r-log" checked> Log scale</label><span class="help-dot" tabindex="0" role="note" aria-label="Log scale shows percentage moves at the same size, so a 10% move in 2003 looks as big as a 10% move in 2025." title="Log scale shows percentage moves at the same size, so a 10% move in 2003 looks as big as a 10% move in 2025." data-tip="Log scale shows percentage moves at the same size, so a 10% move in 2003 looks as big as a 10% move in 2025.">?</span>
            <label class="check"><input type="checkbox" class="r-candles"> Candles</label>
          </div>
          <div class="chart-label">The price, with every buy and sell</div>
          <div class="legend r-plegend"></div>
          <div class="chart chart-lg r-pchart"></div>
          <div class="chart-label">Your money vs just holding</div>
          <div class="legend r-mlegend"></div>
          <div class="chart chart-sm r-mchart"></div>
          <details class="fold trades"><summary class="r-tsum">Every trade</summary><div class="tbl-wrap r-trades"></div></details>
          <div class="r-luck"></div>
        </div>`;
      const q = (c) => root.querySelector(c);
      this.el = { title: q('.r-title'), sub: q('.r-sub'), summary: q('.r-summary'), more: q('.r-more'), tiles: q('.r-tiles'), play: q('.r-play'), speed: q('.r-speed'), scrub: q('.r-scrub'), read: q('.r-read'), exit: q('.r-exit'), log: q('.r-log'), candles: q('.r-candles'), plegend: q('.r-plegend'), mlegend: q('.r-mlegend'), pchart: q('.r-pchart'), mchart: q('.r-mchart'), tsum: q('.r-tsum'), trades: q('.r-trades') };
      this.replay = { on: false, playing: false, k: 0, raf: 0 };
      luckPanel(root.querySelector('.r-luck'), async () => {
        const c = this.ctx; if (!c) return null;
        const raw = await TLApp.loadRaw(c.series.sym);
        return { kind: 'stock', raw: { s: raw.s, t: raw.t, o: raw.o, h: raw.h, l: raw.l, c: raw.c, v: raw.v }, strategy: c.strat, opt: { from: c.from, to: c.to, capital: c.capital, fee: c.fee, slip: c.slip, tax: c.tax } };
      });
      this.el.play.onclick = () => this.togglePlay();
      this.el.exit.onclick = () => this.exitReplay();
      this.el.scrub.oninput = () => { this.pause(); this.enterReplay(+this.el.scrub.value); };
      this.el.log.onchange = () => this.applyScale();
      this.el.candles.onchange = () => { if (this.data) { this.buildSeries(); this.fillAll(); } };
    }

    ensureCharts() {
      if (this.pc) return;
      this.pc = makeChart(this.el.pchart, () => this.recolor());
      this.mc = makeChart(this.el.mchart, () => this.recolor());
      syncCharts(this.pc.chart, this.mc.chart);
      this.pc.chart.subscribeCrosshairMove(p => this.onCross(p));
      this.mc.chart.subscribeCrosshairMove(p => this.onCross(p));
    }

    render(ctx) {
      this.exitReplay(true);
      this.ctx = ctx;
      const { series: s, strat } = ctx;
      const opt = { from: ctx.from, to: ctx.to, capital: ctx.capital, fee: ctx.fee, slip: ctx.slip, tax: ctx.tax };
      const res = TL.backtest(s, strat, opt);
      const bh = TL.buyHoldCurve(s, res.from, res.to, ctx.capital);
      const bhStats = TL.curveStats(bh, res.metrics.years);
      this.res = res; this.bh = bh; this.bhStats = bhStats;
      this.el.title.textContent = ctx.title || strat.name;
      this.el.sub.textContent = `${s.sym} · ${fmt.date(s.t[res.from])} – ${fmt.date(s.t[res.to])} · ${res.metrics.years.toFixed(1)} years`;
      this.renderTiles();
      this.prepareData();
      this.ensureCharts();
      this.buildSeries();
      this.fillAll();
      this.renderTrades();
      return res;
    }

    renderTiles() {
      const m = this.res.metrics, b = this.bhStats, cap = this.ctx.capital, sym = this.ctx.series.sym;
      const bhFinal = TL.afterTaxHold(cap * (1 + b.totalReturn / 100), cap, m.years, this.ctx.tax);
      const bhCagr = (Math.pow(bhFinal / cap, 1 / m.years) - 1) * 100;
      const ahead = m.final >= bhFinal;
      const meta = window.TLApp && TLApp.metaOf(sym);
      this.el.summary.innerHTML = `Over ${m.years.toFixed(0)} years, this robot turned ${fmt.money(cap)} into <b class="${ahead ? 'up' : 'down'}">${fmt.money(m.final)}</b>. Just holding ${sym === 'USMKT' ? 'the US market' : esc(sym)} would have made ${fmt.money(bhFinal)}. Its worst drop was ${fmt.pctPlain(m.maxDD, 0)} (holding: ${fmt.pctPlain(b.maxDD, 0)}).${this.ctx.tax ? ` <span class="muted">After estimated tax: the robot paid ${fmt.money(m.taxPaid)}; holding is taxed once at the end.</span>` : ''}${meta && meta.closeOnly ? ` <span class="muted">This long-history series has one price a day, so trades happen at the next day's close.</span>` : ''}`;
      const vs = (bb, better) => `<div class="cmp">Just holding: ${bb}${better == null ? '' : better ? ' · <span class="up">▲ robot ahead</span>' : ' · <span class="down">▼ robot behind</span>'}</div>`;
      const tile = ([l, v, c]) => `<div class="tile"><div class="lab">${l}</div><div class="val">${v}</div>${c}</div>`;
      this.el.tiles.innerHTML = [
        ['Money at the end', fmt.money(m.final), vs(fmt.money(bhFinal), ahead)],
        ['Growth per year', fmt.pct(m.cagr), vs(fmt.pct(bhCagr), m.cagr > bhCagr)],
        ['Worst drop', fmt.pctPlain(m.maxDD), vs(fmt.pctPlain(b.maxDD), m.maxDD < b.maxDD)],
      ].map(tile).join('');
      this.el.more.innerHTML = [
        ['Smoothness (Sharpe ratio)', fmt.num(m.sharpe), vs(fmt.num(b.sharpe), m.sharpe > b.sharpe) + '<div class="cmp">Growth divided by how bumpy the ride was. Higher is better.</div>'],
        ['Trades', String(m.trades), `<div class="cmp">${m.trades ? fmt.pctPlain(m.winRate, 0) + ' of them made money' : 'No trades'}</div>`],
        ['Time in the market', fmt.pctPlain(m.exposure, 0), `<div class="cmp">Average trade ${fmt.pct(m.avgTrade)}</div>`],
      ].map(tile).join('');
    }

    prepareData() {
      const { series: s, strat } = this.ctx, res = this.res, from = res.from, to = res.to;
      const n = to - from + 1, times = new Array(n);
      for (let i = 0; i < n; i++) times[i] = T(s.t[from + i]);
      const line = [], candles = [], eq = [], bh = [], shade = [];
      for (let i = 0; i < n; i++) {
        const j = from + i;
        line.push({ time: times[i], value: s.close[j] });
        candles.push({ time: times[i], open: s.open[j], high: s.high[j], low: s.low[j], close: s.close[j] });
        eq.push({ time: times[i], value: res.equity[i] });
        bh.push({ time: times[i], value: this.bh[i] });
        if (this.ctx.splitIdx != null) shade.push(j >= this.ctx.splitIdx ? { time: times[i], value: 1 } : { time: times[i] });
      }
      // Lines for any price-scale indicator used in the rules
      const seen = new Map();
      for (const g of [strat.buy, strat.sell]) for (const r of g.rules || []) for (const o of [r.a, r.b]) {
        const d = TL.IND[o.k];
        if (!d || d.scale !== 'price' || !d.args.length) continue;
        const args = o.args.map(x => TL.val(strat, x)), key = o.k + args.join(',');
        if (seen.has(key) || seen.size >= 4) continue;
        const arr = TL.indicator(s, o.k, args), pts = [];
        for (let i = 0; i < n; i++) { const v = arr[from + i]; pts.push(Number.isFinite(v) ? { time: times[i], value: v } : { time: times[i] }); }
        seen.set(key, { label: TL.describeOperand(strat, o), pts });
      }
      const overlays = [...seen.values()];
      const markers = [], few = res.trades.length <= 40;
      for (const t of res.trades) {
        markers.push({ time: T(s.t[t.entryIdx]), position: 'belowBar', shape: 'arrowUp', kind: 'buy', text: few ? 'Buy' : '' });
        if (!t.open) markers.push({ time: T(s.t[t.exitIdx]), position: 'aboveBar', shape: 'arrowDown', kind: 'sell', text: few ? 'Sell' : '' });
      }
      markers.sort((a, b) => a.time - b.time);
      this.data = { times, line, candles, eq, bh, shade, overlays, markers, n };
    }

    buildSeries() {
      const pch = this.pc.chart, mch = this.mc.chart;
      for (const x of this.pSeries || []) pch.removeSeries(x);
      for (const x of this.mSeries || []) mch.removeSeries(x);
      const d = this.data, common = { priceLineVisible: false, lastValueVisible: false };
      const shadeOpts = () => ({ priceScaleId: 'shade', lineColor: 'rgba(0,0,0,0)', topColor: css('--shade'), bottomColor: css('--shade'), lineWidth: 1, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) });
      this.shadeP = d.shade.length ? pch.addAreaSeries(shadeOpts()) : null;
      this.shadeM = d.shade.length ? mch.addAreaSeries(shadeOpts()) : null;
      if (this.shadeP) { pch.priceScale('shade').applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } }); mch.priceScale('shade').applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } }); }
      this.useCandles = this.el.candles.checked;
      this.priceS = this.useCandles
        ? pch.addCandlestickSeries({ ...common, upColor: css('--bench'), downColor: css('--ink-2'), borderVisible: false, wickUpColor: css('--bench'), wickDownColor: css('--ink-2') })
        : pch.addLineSeries({ ...common, color: css('--ink-2'), lineWidth: 1.5, lastValueVisible: true, title: this.ctx.series.sym });
      this.overS = d.overlays.map((o, k) => pch.addLineSeries({ ...common, color: css(SLOTS[k]), lineWidth: 2, crosshairMarkerVisible: false }));
      this.eqS = mch.addLineSeries({ ...common, color: css('--s1'), lineWidth: 2, lastValueVisible: true, title: 'Robot' });
      this.bhS = mch.addLineSeries({ ...common, color: css('--bench'), lineWidth: 2, lineStyle: 2, lastValueVisible: true, title: 'Buy & hold' });
      this.pSeries = [this.shadeP, this.priceS, ...this.overS].filter(Boolean);
      this.mSeries = [this.shadeM, this.eqS, this.bhS].filter(Boolean);
      this.applyScale();
      this.renderLegends();
    }

    recolor() {
      if (!this.priceS) return;
      if (this.useCandles) this.priceS.applyOptions({ upColor: css('--bench'), downColor: css('--ink-2'), wickUpColor: css('--bench'), wickDownColor: css('--ink-2') });
      else this.priceS.applyOptions({ color: css('--ink-2') });
      this.overS.forEach((x, k) => x.applyOptions({ color: css(SLOTS[k]) }));
      this.eqS.applyOptions({ color: css('--s1') });
      this.bhS.applyOptions({ color: css('--bench') });
      if (this.shadeP) { const c = { topColor: css('--shade'), bottomColor: css('--shade') }; this.shadeP.applyOptions(c); this.shadeM.applyOptions(c); }
      this.setMarkers(this.lastMarkerCount == null ? this.data.markers.length : this.lastMarkerCount, true);
    }

    applyScale() {
      if (!this.pc) return;
      const mode = this.el.log.checked ? 1 : 0;
      this.pc.chart.priceScale('right').applyOptions({ mode });
      this.mc.chart.priceScale('right').applyOptions({ mode });
    }

    markerObjs(count) {
      const good = css('--good'), bad = css('--bad');
      return this.data.markers.slice(0, count).map(m => ({ time: m.time, position: m.position, shape: m.shape, text: m.text, color: m.kind === 'buy' ? good : bad }));
    }
    setMarkers(count, force) {
      if (!force && count === this.lastMarkerCount) return;
      this.lastMarkerCount = count;
      this.priceS.setMarkers(this.markerObjs(count));
    }

    fillAll() { this.fillTo(this.data.n - 1); this.pc.chart.timeScale().fitContent(); this.mc.chart.timeScale().fitContent(); }

    fillTo(k) {
      const d = this.data, sl = (a) => a.slice(0, k + 1);
      if (this.shadeP) { this.shadeP.setData(sl(d.shade)); this.shadeM.setData(sl(d.shade)); }
      this.priceS.setData(sl(this.useCandles ? d.candles : d.line));
      this.overS.forEach((x, j) => x.setData(sl(d.overlays[j].pts)));
      this.eqS.setData(sl(d.eq)); this.bhS.setData(sl(d.bh));
      const t = d.times[k];
      let c = 0; while (c < d.markers.length && d.markers[c].time <= t) c++;
      this.setMarkers(c, true);
    }

    pushBar(k) {
      const d = this.data;
      if (this.shadeP) { this.shadeP.update(d.shade[k]); this.shadeM.update(d.shade[k]); }
      this.priceS.update(this.useCandles ? d.candles[k] : d.line[k]);
      this.overS.forEach((x, j) => x.update(d.overlays[j].pts[k]));
      this.eqS.update(d.eq[k]); this.bhS.update(d.bh[k]);
      let c = this.lastMarkerCount || 0;
      while (c < d.markers.length && d.markers[c].time <= d.times[k]) c++;
      this.setMarkers(c);
    }

    renderLegends() {
      const d = this.data;
      const sw = (color, cls = '') => `<i class="sw ${cls}" style="color:${color}"></i>`;
      let p = `<span class="li">${sw(css('--ink-2'))}${esc(this.ctx.series.sym)} price</span>`;
      d.overlays.forEach((o, k) => { p += `<span class="li">${sw(css(SLOTS[k]))}${esc(o.label)}</span>`; });
      p += `<span class="li"><i class="sw mk buy"></i>Buy</span><span class="li"><i class="sw mk sell"></i>Sell</span>`;
      if (d.shade.length) p += `<span class="li"><i class="sw shade"></i>Exam years</span>`;
      p += `<span class="readout r-pread"></span>`;
      this.el.plegend.innerHTML = p;
      this.el.mlegend.innerHTML = `<span class="li">${sw(css('--s1'))}Robot</span><span class="li">${sw(css('--bench'), 'dash')}Buy &amp; hold</span><span class="readout r-mread"></span>`;
    }

    onCross(p) {
      const pr = this.root.querySelector('.r-pread'), mr = this.root.querySelector('.r-mread');
      if (!pr || !mr) return;
      if (!p || p.time == null) { pr.textContent = ''; mr.textContent = ''; return; }
      const i = this.data.times.indexOf(p.time);
      if (i < 0) return;
      const j = this.res.from + i, s = this.ctx.series;
      pr.textContent = `${fmt.date(s.t[j])} · ${fmt.price(s.close[j])}` + this.data.overlays.map(o => o.pts[i].value != null ? ` · ${fmt.price(o.pts[i].value)}` : '').join('');
      const e = this.data.eq[i].value, b = this.data.bh[i].value;
      mr.textContent = `Robot ${fmt.money(e)} · Buy & hold ${fmt.money(b)}`;
    }

    renderTrades() {
      const { series: s } = this.ctx, tr = this.res.trades;
      this.el.tsum.textContent = `Every trade (${tr.length})`;
      if (!tr.length) { this.el.trades.innerHTML = '<p class="hint" style="padding:10px">The rules never triggered a buy in this period.</p>'; return; }
      this.el.trades.innerHTML = `<table class="data"><thead><tr><th>#</th><th class="l">Bought</th><th>Price</th><th class="l">Sold</th><th>Price</th><th class="l">Why it sold</th><th>Days</th><th>Result</th></tr></thead><tbody>${
        tr.map((t, k) => `<tr><td>${k + 1}</td><td class="l">${fmt.date(s.t[t.entryIdx])}</td><td>${fmt.price(t.entryPrice)}</td><td class="l">${t.open ? '<span class="muted">still holding</span>' : fmt.date(s.t[t.exitIdx])}</td><td>${fmt.price(t.exitPrice)}</td><td class="l">${t.open ? '–' : esc(t.why)}</td><td>${t.exitIdx - t.entryIdx}</td><td class="${fmt.signClass(t.ret)}">${fmt.pct(t.ret)}</td></tr>`).join('')
      }</tbody></table>`;
    }

    /* replay */
    togglePlay() { if (this.replay.playing) this.pause(); else this.play(); }
    enterReplay(k) {
      const r = this.replay, d = this.data;
      if (!d) return;
      r.on = true;
      r.k = Math.max(0, Math.min(d.n - 1, k));
      this.el.exit.classList.remove('hidden');
      this.el.scrub.max = d.n - 1; this.el.scrub.value = r.k;
      this.fillTo(r.k);
      this.frame(r.k);
      this.updateRead(r.k);
    }
    play() {
      const r = this.replay, d = this.data;
      if (!d) return;
      if (!r.on || r.k >= d.n - 1) this.enterReplay(Math.min(d.n - 1, 20));
      r.playing = true; r.acc = 0; r.last = performance.now();
      this.el.play.textContent = '❚❚ Pause';
      const tick = (now) => {
        if (!r.playing) return;
        const speed = +this.el.speed.value;
        r.acc += (now - r.last) / 1000 * speed; r.last = now;
        let steps = Math.floor(r.acc);
        if (steps > 0) {
          r.acc -= steps;
          while (steps-- > 0 && r.k < d.n - 1) { r.k++; this.pushBar(r.k); }
          this.frame(r.k); this.updateRead(r.k); this.el.scrub.value = r.k;
        }
        if (r.k >= d.n - 1) { this.pause(); return; }
        r.raf = requestAnimationFrame(tick);
      };
      r.raf = requestAnimationFrame(tick);
    }
    pause() { const r = this.replay; r.playing = false; cancelAnimationFrame(r.raf); this.el.play.textContent = r.on && r.k < (this.data ? this.data.n - 1 : 0) ? '▶ Resume' : '▶ Replay'; }
    exitReplay(silent) {
      const r = this.replay;
      this.pause();
      if (!r.on) return;
      r.on = false;
      this.el.exit.classList.add('hidden');
      this.el.play.textContent = '▶ Replay';
      this.el.read.innerHTML = '<span class="muted">Watch the robot trade day by day.</span>';
      if (!silent && this.data) this.fillAll();
    }
    frame(k) {
      const win = 260;
      this.pc.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, k - win), to: k + 4 });
    }
    updateRead(k) {
      const s = this.ctx.series, j = this.res.from + k;
      const e = this.data.eq[k].value, b = this.data.bh[k].value;
      const holding = this.res.trades.find(t => t.entryIdx <= j && (t.open || t.exitIdx > j));
      this.el.read.innerHTML = `${fmt.date(s.t[j])} · Robot ${fmt.money(e)} <span class="muted">vs buy &amp; hold ${fmt.money(b)} · ${holding ? 'holding the stock' : 'in cash'}</span>`;
    }
  }

  /* ---------- "how much was luck?" panel ----------
   * makeJob() returns the worker message (without n and block); the panel runs it and draws the answer. */
  function luckPanel(el, makeJob) {
    el.innerHTML = `<details class="fold luck"><summary>How much was luck? (stress test)</summary>
      <p class="hint">This builds hundreds of alternative histories from the same years: every real day is kept, but year-long chunks are shuffled into a new order. The robot and just holding both run through each one. If the robot only wins in the order things really happened, its win may have been luck. Trend-following robots look a little worse here than in real markets, because shuffling breaks up some long trends.</p>
      <div class="btns"><button class="btn primary l-run">Run 300 alternative histories</button><span class="muted l-prog"></span></div>
      <div class="l-out"></div></details>`;
    const btn = el.querySelector('.l-run'), prog = el.querySelector('.l-prog'), out = el.querySelector('.l-out');
    btn.onclick = async () => {
      const job = await makeJob();
      if (!job) return;
      btn.disabled = true; prog.textContent = 'Starting…'; out.innerHTML = '';
      const w = new Worker('js/tuner-worker.js');
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') { prog.textContent = `${m.done} of ${m.total}`; return; }
        w.terminate(); btn.disabled = false; prog.textContent = '';
        drawLuck(out, m.out);
      };
      w.onerror = (e) => { w.terminate(); btn.disabled = false; prog.textContent = 'Something went wrong: ' + (e.message || ''); };
      w.postMessage({ type: 'luck', n: 300, block: 252, ...job });
    };
  }
  function drawLuck(el, rows) {
    const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
    const f = rows.map(r => r.final), h = rows.map(r => r.bhFinal);
    const beat = rows.filter(r => r.final > r.bhFinal).length / rows.length * 100, safer = rows.filter(r => r.dd < r.bhDD).length / rows.length * 100;
    el.innerHTML = `<p class="summary-line">In ${rows.length} alternative histories, the robot ended with <b>more money than just holding in ${beat.toFixed(0)}%</b> of them, and had <b>a smaller worst drop in ${safer.toFixed(0)}%</b>.</p>
      <div class="tiles">
        <div class="tile"><div class="lab">Typical result</div><div class="val">${fmt.money(q(f, 0.5))}</div><div class="cmp">Just holding: ${fmt.money(q(h, 0.5))}</div></div>
        <div class="tile"><div class="lab">Bad case (1 in 10)</div><div class="val">${fmt.money(q(f, 0.1))}</div><div class="cmp">Just holding: ${fmt.money(q(h, 0.1))}</div></div>
        <div class="tile"><div class="lab">Good case (1 in 10)</div><div class="val">${fmt.money(q(f, 0.9))}</div><div class="cmp">Just holding: ${fmt.money(q(h, 0.9))}</div></div>
        <div class="tile"><div class="lab">Typical worst drop</div><div class="val">${fmt.pctPlain(q(rows.map(r => r.dd), 0.5), 0)}</div><div class="cmp">Just holding: ${fmt.pctPlain(q(rows.map(r => r.bhDD), 0.5), 0)}</div></div>
      </div>
      <div class="legend"><span class="li"><i class="sw" style="color:${css('--s1')};height:10px;width:10px;border-radius:50%"></i>Robot</span><span class="li"><i class="sw" style="color:${css('--bench')};height:10px;width:10px;border-radius:50%"></i>Just holding</span><span class="li muted">Each dot is one alternative history · money at the end, log scale</span></div>
      <canvas class="luck-dots"></canvas>`;
    const cv = el.querySelector('canvas'), W = cv.parentElement.clientWidth || 600, H = 110, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = '100%'; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const all = [...f, ...h].filter(x => x > 0), lo = Math.log(Math.min(...all)), hi = Math.log(Math.max(...all)), X = (v) => 12 + (Math.log(Math.max(v, 1)) - lo) / (hi - lo || 1) * (W - 24);
    const rowY = { r: 28, h: 64 }, rnd = TL_rand(3);
    g.globalAlpha = 0.55;
    for (const v of f) { g.fillStyle = css('--s1'); g.beginPath(); g.arc(X(v), rowY.r + (rnd() - 0.5) * 16, 3, 0, 7); g.fill(); }
    for (const v of h) { g.fillStyle = css('--bench'); g.beginPath(); g.arc(X(v), rowY.h + (rnd() - 0.5) * 16, 3, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = css('--ink'); g.lineWidth = 2;
    for (const [v, y] of [[q(f, 0.5), rowY.r], [q(h, 0.5), rowY.h]]) { g.beginPath(); g.moveTo(X(v), y - 12); g.lineTo(X(v), y + 12); g.stroke(); }
    g.fillStyle = css('--muted'); g.font = '11px system-ui, sans-serif'; g.textBaseline = 'top';
    for (const v of [q(all, 0.02), q(all, 0.5), q(all, 0.98)]) g.fillText(fmt.money(v), Math.min(W - 60, Math.max(0, X(v) - 20)), 90);
  }
  function TL_rand(seed) { let a = seed; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; }

  /* ---------- heatmap ---------- */
  const RAMP = {
    light: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    dark: ['#104281', '#184f95', '#256abf', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb'],
  };
  function isDark() { return css('color-scheme') === 'dark' || getComputedStyle(document.documentElement).colorScheme === 'dark'; }

  function heatmap(wrap, opts) {
    // opts: { xAxis:{key,label,vals}, yAxis, cells: Map("x|y" -> score), best:{x,y}, fmt, onPick(x,y) }
    wrap.innerHTML = '';
    const box = document.createElement('div'); box.className = 'heat-wrap';
    const cv = document.createElement('canvas'); box.appendChild(cv);
    const tip = document.createElement('div'); tip.className = 'tip hidden'; box.appendChild(tip);
    wrap.appendChild(box);
    const legend = document.createElement('div'); legend.className = 'heat-legend';
    wrap.appendChild(legend);
    const { xAxis, yAxis, cells } = opts;
    const scores = [...cells.values()].filter(Number.isFinite);
    const lo = Math.min(...scores), hi = Math.max(...scores);
    legend.innerHTML = `<span>Worse (${scores.length ? opts.fmt(lo) : '–'})</span><span class="ramp"></span><span>Better (${scores.length ? opts.fmt(hi) : '–'})</span><span class="nodata"></span><span>Not tried or too few trades</span>`;
    let geo = null;
    function draw() {
      const W = box.clientWidth || 500, left = 54, bottom = 38, top = 6, right = 6;
      const cellH = Math.max(10, Math.min(30, 260 / yAxis.vals.length));
      const H = top + bottom + cellH * yAxis.vals.length;
      const dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const cw = (W - left - right) / xAxis.vals.length;
      const ramp = isDark() ? RAMP.dark : RAMP.light, surf = css('--surface'), nod = css('--surface-3');
      geo = { left, top, cw, ch: cellH, W, H };
      for (let yi = 0; yi < yAxis.vals.length; yi++) for (let xi = 0; xi < xAxis.vals.length; xi++) {
        const v = cells.get(xAxis.vals[xi] + '|' + yAxis.vals[yi]);
        const x = left + xi * cw, y = top + (yAxis.vals.length - 1 - yi) * cellH;
        let col = nod;
        if (Number.isFinite(v)) { const t = hi > lo ? (v - lo) / (hi - lo) : 1; col = ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))]; }
        g.fillStyle = col;
        g.fillRect(x, y, Math.max(1, cw - (cw > 6 ? 1 : 0)), cellH - 1);
      }
      if (opts.best) {
        const xi = xAxis.vals.indexOf(opts.best.x), yi = yAxis.vals.indexOf(opts.best.y);
        if (xi >= 0 && yi >= 0) {
          const bx = left + xi * cw, by = top + (yAxis.vals.length - 1 - yi) * cellH;
          g.lineWidth = 5; g.strokeStyle = css('--surface'); g.strokeRect(bx - 1, by - 1, cw + 1, cellH + 1);
          g.lineWidth = 2.5; g.strokeStyle = css('--ink'); g.strokeRect(bx - 1, by - 1, cw + 1, cellH + 1);
        }
      }
      g.fillStyle = css('--muted'); g.font = '11px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'top';
      const xEvery = Math.ceil(xAxis.vals.length / Math.max(1, Math.floor((W - left) / 38)));
      xAxis.vals.forEach((v, i) => { if (i % xEvery === 0) g.fillText(String(v), left + i * cw + cw / 2, top + yAxis.vals.length * cellH + 4); });
      g.fillStyle = css('--ink-2'); g.font = '600 11.5px system-ui, sans-serif';
      g.fillText(xAxis.label, left + (W - left - right) / 2, H - 15);
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = css('--muted'); g.font = '11px system-ui, sans-serif';
      const yEvery = Math.ceil(12 / cellH);
      yAxis.vals.forEach((v, i) => { if (i % yEvery === 0) g.fillText(String(v), left - 6, top + (yAxis.vals.length - 1 - i) * cellH + cellH / 2); });
      g.save(); g.translate(11, top + yAxis.vals.length * cellH / 2); g.rotate(-Math.PI / 2);
      g.textAlign = 'center'; g.fillStyle = css('--ink-2'); g.font = '600 11.5px system-ui, sans-serif';
      g.fillText(yAxis.label, 0, 0); g.restore();
    }
    function hit(ev) {
      const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      const xi = Math.floor((x - geo.left) / geo.cw), yiFromTop = Math.floor((y - geo.top) / geo.ch);
      const yi = yAxis.vals.length - 1 - yiFromTop;
      if (xi < 0 || xi >= xAxis.vals.length || yi < 0 || yi >= yAxis.vals.length) return null;
      return { xi, yi, x, y };
    }
    cv.addEventListener('mousemove', (ev) => {
      const h = hit(ev);
      if (!h) { tip.classList.add('hidden'); return; }
      const xv = xAxis.vals[h.xi], yv = yAxis.vals[h.yi], v = cells.get(xv + '|' + yv);
      tip.innerHTML = `${esc(xAxis.label)}: <b>${xv}</b><br>${esc(yAxis.label)}: <b>${yv}</b><br>${v == null ? 'Not tried' : Number.isFinite(v) ? 'Best score here: <b>' + opts.fmt(v) + '</b>' : 'Too few trades'}${opts.onPick && Number.isFinite(v) ? '<br><span class="muted">Click to view</span>' : ''}`;
      tip.classList.remove('hidden');
      const tx = Math.min(h.x + 12, geo.W - tip.offsetWidth - 4);
      tip.style.left = Math.max(0, tx) + 'px'; tip.style.top = Math.max(0, h.y - tip.offsetHeight - 8) + 'px';
      cv.style.cursor = opts.onPick && Number.isFinite(v) ? 'pointer' : 'default';
    });
    cv.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    cv.addEventListener('click', (ev) => {
      const h = hit(ev); if (!h || !opts.onPick) return;
      const xv = xAxis.vals[h.xi], yv = yAxis.vals[h.yi];
      if (Number.isFinite(cells.get(xv + '|' + yv))) opts.onPick(xv, yv);
    });
    draw();
    const ro = new ResizeObserver(() => draw()); ro.observe(box);
    const onTheme = () => draw();
    document.addEventListener('tl-theme', onTheme);
    return { redraw: draw };
  }

  /* ---------- simple multi-line chart (comparisons, live) ---------- */
  function lineChart(el, legendEl) {
    const h = makeChart(el, () => api.recolor());
    let lines = [];
    const api = {
      chart: h.chart,
      set(list, { log = true } = {}) {
        for (const l of lines) h.chart.removeSeries(l.s);
        lines = list.map((x, k) => ({ ...x, k, s: h.chart.addLineSeries({ color: css(x.color || SLOTS[k]), lineWidth: 2, lineStyle: x.dash ? 2 : 0, priceLineVisible: false, lastValueVisible: true }) }));
        lines.forEach(l => l.s.setData(l.pts));
        h.chart.priceScale('right').applyOptions({ mode: log ? 1 : 0 });
        h.chart.timeScale().fitContent();
        if (legendEl) legendEl.innerHTML = lines.map(l => `<span class="li"><i class="sw ${l.dash ? 'dash' : ''}" style="color:${css(l.color || SLOTS[l.k])}"></i>${esc(l.label)}</span>`).join('');
      },
      recolor() { lines.forEach(l => l.s.applyOptions({ color: css(l.color || SLOTS[l.k]) })); if (legendEl) api.set(lines.map(({ s, ...rest }) => rest)); },
      dispose() { h.dispose(); },
    };
    return api;
  }

  window.TLCharts = { Results, heatmap, lineChart, makeChart, restyleAll, luckPanel, fmt, esc, css, SLOTS, T };
})();
