#!/usr/bin/env node
/* The automatic daily bot. Run by .github/workflows/auto-trade.yml each weekday
 * morning, New York time. For each bot in live/bot.json it fetches daily prices,
 * decides on yesterday's close with the same engine the page uses (js/core.js),
 * and places orders on the Alpaca practice (paper) account.
 * Keys come from the repository secrets ALPACA_KEY_ID and ALPACA_SECRET_KEY. */
'use strict';
const fs = require('fs');
const path = require('path');
require('../js/core.js');
require('../js/alpaca.js');
const { TL, TLAlpaca } = globalThis;

const ROOT = path.join(__dirname, '..');
const file = (p) => path.join(ROOT, p);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(file(p), 'utf8')); } catch (e) { return d; } };
const writeJSON = (p, x) => fs.writeFileSync(file(p), JSON.stringify(x, null, 1) + '\n');

function nyDay(d = new Date()) {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
}

// Five years of adjusted daily prices from Yahoo, same treatment as scripts/update_data.py.
async function prices(sym) {
  const now = Math.floor(Date.now() / 1000), start = now - 5 * 366 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${start}&period2=${now + 86400}&interval=1d&events=div%2Csplit`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (trading-lab bot)' } });
  if (!r.ok) throw new Error(`price download failed (${r.status})`);
  const res = (await r.json()).chart.result[0];
  const q = res.indicators.quote[0], adj = res.indicators.adjclose[0].adjclose, off = res.meta.gmtoffset || -14400;
  const raw = { s: sym, t: [], o: [], h: [], l: [], c: [], v: [] };
  res.timestamp.forEach((ts, i) => {
    const [o, h, l, c, a] = [q.open[i], q.high[i], q.low[i], q.close[i], adj[i]];
    if ([o, h, l, c, a].some(x => x == null) || c <= 0) return;
    const f = a / c, day = Math.floor((ts + off) / 86400);
    if (raw.t.length && raw.t[raw.t.length - 1] === day) return;
    raw.t.push(day); raw.o.push(o * f); raw.h.push(h * f); raw.l.push(l * f); raw.c.push(c * f); raw.v.push(q.volume[i] || 0);
  });
  // Today's bar is still forming, so decide on complete days only.
  if (raw.t[raw.t.length - 1] >= nyDay()) for (const k of 'tohlcv') raw[k].pop();
  return TL.makeSeries(raw);
}

// The most a bot may put into one purchase: dollars, or % of the account ("pct").
// Older settings used "allocation" as a % of the account.
function budgetFor(bot, equity) {
  if (bot.budget != null) return bot.budgetType === 'pct' ? equity * bot.budget / 100 : +bot.budget;
  return equity * (+bot.allocation || 0) / 100;
}

async function main() {
  const cfg = readJSON('live/bot.json', { enabled: false, bots: [] });
  const log = readJSON('live/auto-log.json', []);
  const state = readJSON('live/auto-state.json', {});
  const add = (e) => { log.unshift({ time: new Date().toISOString(), ...e }); console.log(JSON.stringify(e)); };

  if (!cfg.enabled || !(cfg.bots || []).length) { console.log('The bot is switched off in live/bot.json. Nothing to do.'); return; }
  const key = process.env.ALPACA_KEY_ID, secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) { console.log('No Alpaca keys: add ALPACA_KEY_ID and ALPACA_SECRET_KEY as repository secrets.'); return; }

  const c = TLAlpaca.client(key, secret, fetch);
  const clock = await c.clock();
  if (!clock.is_open) { console.log('The market is closed today (weekend or holiday). Nothing to do.'); return; }
  const account = await c.account();
  const equity = +account.equity;
  const today = nyDay();

  for (const bot of cfg.bots) {
    const base = { name: bot.name, sym: bot.sym };
    try {
      const s = await prices(bot.sym);
      const pos = await c.position(bot.sym);
      let st = state[bot.sym];
      if (!pos && st) { add({ ...base, action: 'note', note: 'Position closed at Alpaca by a stop-loss or take-profit order since the last run.' }); delete state[bot.sym]; st = null; }
      if (pos && !st) { const p = +pos.avg_entry_price; st = state[bot.sym] = { entryDay: s.t[s.n - 1], entryPrice: p, peakHigh: p, peakClose: p }; }
      if (st) {
        for (let i = TL.indexOnOrAfter(s, st.entryDay); i < s.n; i++) { st.peakHigh = Math.max(st.peakHigh, s.high[i]); st.peakClose = Math.max(st.peakClose, s.close[i]); }
      }
      const d = TL.decide(s, bot.strategy, st ? { ...st } : null);
      const lastClose = s.close[s.n - 1];
      if (d.action === 'buy' && !pos) {
        const snap = await c.snapshot(bot.sym);
        const px = (snap.latestTrade && snap.latestTrade.p) || lastClose;
        const budget = Math.min(budgetFor(bot, equity) * d.risk.size, +account.cash);
        const qty = Math.floor(budget / px);
        if (qty < 1) { add({ ...base, action: 'note', note: `Buy signal, but ${budget.toFixed(2)} dollars is not enough for one share.` }); continue; }
        const o = await TLAlpaca.buy(c, bot.sym, qty, px, d.risk);
        state[bot.sym] = { entryDay: today, entryPrice: px, peakHigh: px, peakClose: px };
        add({ ...base, action: 'buy', qty, price: px, why: d.buy.map(x => x.text).join(' and '), orderId: o.id });
      } else if (d.action === 'sell' && pos) {
        await TLAlpaca.sellAll(c, bot.sym);
        add({ ...base, action: 'sell', qty: +pos.qty, price: +pos.current_price, why: d.why === 'sell rule' ? d.sell.filter(x => x.ok).map(x => x.text).join(' and ') || d.why : d.why });
        delete state[bot.sym];
      } else {
        add({ ...base, action: pos ? 'hold' : 'wait', price: lastClose, why: pos ? 'No sell signal at yesterday\'s close.' : 'Buy rules not met at yesterday\'s close.' });
      }
    } catch (e) {
      add({ ...base, action: 'error', note: e.message });
    }
  }
  writeJSON('live/auto-log.json', log.slice(0, 500));
  writeJSON('live/auto-state.json', state);
}

main().catch(e => { console.error(e); process.exit(1); });
