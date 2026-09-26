# Trading Lab: build plan and decisions so far

This is a simulated trading lab for GitHub Pages (planned address: https://just-rice.github.io/trading-lab/). It's plain HTML/CSS/JS with no build step. Charts will use lightweight-charts 4.2.3 from jsDelivr.

## Decisions the user made
- **Prices:** real US stock prices, refreshed nightly by a GitHub Action.
  - Source: Yahoo's chart endpoint, no key needed.
  - Prices are adjusted for splits and dividends, from 2000 onward, for 42 stocks and funds.
- **Strategies:** trend following, momentum breakout and buy-the-dip.
  - All three are editable recipes in a **rule builder**: BUY/SELL rules made from dropdown blocks, combined with all/any.
  - A number in a rule can be fixed, or turned into a "dial" (`strategy.params`) that the auto-tuner is allowed to change.
- **Auto tab (the default):** the auto-tuner plus the "hidden exam".
  - It tunes on the first ~70% of the years, then tests the winners on the rest.
  - It shows a heatmap of results and the top 10 settings.
- **Custom tab:** the rule builder, for making new algorithms and tuning them by hand.
- **Extras:** replay mode (watch trades day by day, with play, pause, speed and a scrubber) and saved setups (localStorage, compared side by side).
- **Live tab, all four options:**
  1. **Forward test:** lock in an algorithm and score it only on days after the lock date. It's recalculated from the nightly data.
  2. **Live watch:** an Alpaca key is pasted in and kept in the browser only.
     - Prices come from the IEX feed, via websocket or polling.
     - Today's price bar is built live, and the page shows what the robot would do right now.
  3. **Alpaca paper account:** orders go to Alpaca's paper-trading API (practice money, real prices). Checked: it accepts requests straight from a web page.
  4. **Auto daily run:** a GitHub Action on weekdays at 15:00 UTC runs the bot settings in `live/bot.json` against the paper account.
     - Keys are stored as repo secrets: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`.
     - It writes `live/auto-log.json`, which the page reads through raw.githubusercontent.com.
- Practice money only. Don't build real-money trading unless the user explicitly asks for it.

## Done
- `scripts/update_data.py` and `data/` (42 tickers, as of 2026-09-24)
- `js/core.js`: indicators, rules, the backtest (decide at close, trade at the next open, stops fill intraday), metrics, goals, the search over settings, and `decide()` for live use. Tested with Node.
- `js/tuner-worker.js`: the auto-tuner and the exam

## Still to build
- `index.html`, `css/styles.css`, `js/app.js`: tabs, stock and date range picker, fees, the charts, metric tiles, trade list, replay
- `js/builder.js`: the rule builder UI
- `js/live.js` and `js/alpaca.js`: forward tests, live watch, Alpaca account panel, bot.json helper
- `scripts/auto-trade.js`, plus the workflows `.github/workflows/pages.yml` (push, nightly data update, deploy) and `auto-trade.yml`
- Create the GitHub repo, turn on Pages, and add the project to the home page (checklist in `~/.claude/CLAUDE.md`)
