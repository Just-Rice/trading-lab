# Trading Lab

Build a stock-trading robot, tune it on real US market prices, and then test it live with practice money.

**Live site:** https://just-rice.github.io/trading-lab/

It's plain HTML, CSS and JavaScript, with no build step and no server. Charts use [lightweight-charts](https://github.com/tradingview/lightweight-charts) by TradingView.

## What's in it

- **Auto-tune** tries every combination of a strategy's "dials", or a random sample when there are too many. It tunes on the older years only, then gives the winner a **hidden exam** on the recent years it never saw. It also shows a map of every setting it tried and the top 10 settings.
- **Build your own** is a rule builder. You write BUY and SELL rules from dropdown ingredients: prices, averages, highs and lows, bands, RSI, % change, volume and position details. Rules combine with ALL/ANY.
  - Any number in a rule can become a dial that the tuner is allowed to turn.
  - There are safety settings for stop-loss, take-profit, trailing stop, time limit and money per trade.
  - The built-ins are editable recipes made the same way: **Crash shield (researched)**, trend following, momentum breakout and buy the dip. The Crash shield came out of the study in [`research/`](research/). Over 2000–2026 it earned about the same as holding with much smaller crashes, but it trailed holding in 2021–2026.
- **Replay** shows the robot trading day by day, with play, pause, speed and a scrubber.
- **Saved** keeps setups in your browser. You can compare up to five at once, and export or import everything as a file.
- **Live** has four options:
  1. **Forward tests** lock an algorithm's settings and score it only on days after the lock.
  2. **Live watch** streams real prices during market hours from a free [Finnhub](https://finnhub.io) key or your Alpaca account. The robot decides on "today so far". Keys are typed into the page and stay in the browser.
  3. **Alpaca practice account:** live watch can send its orders to your free Alpaca paper account instead of a pretend one.
  4. **Automatic daily bot:** a GitHub Action trades your locked-in algorithms on the Alpaca paper account every weekday. Each bot has a budget, in dollars or as a % of the account, which can be changed later from the Live tab.

## How the simulation works

- Decisions are made at each day's close, and trades happen at the next day's open, so the robot never uses a price it couldn't have known.
- Stop-loss, trailing stop and take-profit are checked against each day's low and high. They fill at the level, or at the open if the price gapped past it.
- Each trade pays a fee and slippage (both adjustable).
- The robot only buys (no short selling). It trades one stock at a time and holds uninvested cash, which earns nothing.
- Prices are adjusted for splits and dividends, for the robot and for buy & hold alike.

The same engine (`js/core.js`) runs in the page, in the tuner's Web Worker and in the daily bot, so all three behave identically.

## Files

| Path | What it does |
|---|---|
| `index.html`, `css/styles.css` | The page |
| `js/core.js` | Indicators, rules, the simulator, scores, the search over settings, live decisions |
| `js/tuner-worker.js` | The auto-tuner, run in the background |
| `js/charts.js` | The results panel, replay and heatmap |
| `js/builder.js` | The rule builder |
| `js/app.js` | The Auto-tune, Build your own and Saved tabs |
| `js/live.js`, `js/alpaca.js`, `js/finnhub.js` | The Live tab, the Alpaca paper-trading client and the Finnhub live-price client |
| `scripts/update_data.py` | Downloads daily prices for 42 stocks and funds from Yahoo Finance into `data/` |
| `scripts/auto-trade.js` | The automatic daily bot |
| `research/` | The study that produced the Crash shield, with its method and results |
| `live/bot.json` | What the daily bot trades (made in the Live tab) |
| `live/auto-log.json`, `live/auto-state.json` | What the bot did, and its open positions |

## GitHub Actions

- **Update prices and publish** (`.github/workflows/pages.yml`) runs on every push and every weeknight at 22:30 UTC. It refreshes `data/` and deploys the site to GitHub Pages.
- **Automatic daily bot** (`.github/workflows/auto-trade.yml`) runs weekdays at 15:00 UTC (11am New York in summer, 10am in winter).
  - It needs two repository secrets, `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY`.
  - It does nothing while `live/bot.json` has `"enabled": false`.

Only Alpaca's **paper** (practice) address is ever used. This is a learning tool, not financial advice.
