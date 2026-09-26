# Research: training the Crash shield

These scripts found the **Crash shield (researched)** strategy. They run on the site's own engine (`js/core.js`) and price files (`data/`), with the same fees and slippage the site uses (0.05% each). Run any of them with `node research/<file>.js`.

## Method

- **Three periods:**
  - 2000–2014 for design and tuning.
  - 2015–2020 for checking.
  - 2021–2026 as a final exam, opened once at the end.
- **Ten funds:** every design is scored on SPY, QQQ, DIA, IWM, VTI, XLE, XLF, XLK, TLT and GLD, taking the median across them. This stops a design from winning because of one lucky stock.
- **Score:** Sharpe ratio improvement over buy & hold, plus a small bonus for yearly growth above buy & hold. Buy & hold scores 0.
- **Choosing settings:** the neighbour-averaged score, which prefers broad stable areas over single spikes.

## What happened, in order

| Script | Question | Finding |
|---|---|---|
| `r1_baselines.js` | How do the built-ins do on 2000–2014? | The trend built-in halves the worst drop but grows a little slower. |
| `r2_families.js` | Which trend, momentum and volatility filters work? | 200–250-day trend filters work across funds; 50–60-day ones are worse than nothing. |
| `r3_hybrid.js`, `r4_refine.js`, `r5_edges.js` | Does adding dip-buying to a trend filter help? | On 2000–2014: about 9–10% a year against 7.1%, with the worst drop cut in half. |
| `r6_overlays.js` | Do stop-losses or trailing stops help? | No. They made every design worse. |
| `r7_valid.js` | Do the finalists survive 2015–2020? | **No.** About 3.5% a year against 11.1%. Fast drop-and-rebound markets punish trend rules. |
| `r8_robust.js`, `r9_f4.js` | What beats holding in **both** periods? | "Slow to sell, quick to buy back" designs. 48% of that grid beat holding in both. |
| `final.js` | The final exam, 2021–2026 | Crash shield: 12.2% a year and a 29% worst drop, against 14.3% and 26% for holding. **Did not pass.** |
| `r10_full.js` | The full 26 years | 8.6% a year against 8.9%, with a worst drop of 39% against 57% (median of the 10 funds). |

## The rules

- **Sell when both are true:** the price is more than 6% below its 200-day average, and the 15-day change is below −4%.
- **Buy when either is true:** the price is above its 200-day average, or the 15-day change is positive.

## Takeaway

No rule tested here reliably beat simply holding an index fund on return across all three periods. The best on offer was about the same long-run growth with smaller crashes, and it cost money in years with sudden drops that bounced straight back, such as 2011 and 2025.

This research has limits. The results are past performance on a small set of funds, and none of it is financial advice.

## Round two: portfolios (`pbench.js`, `p0`–`p3`)

These scripts test robots that hold several funds at once, using `backtestPortfolio` in `js/core.js`. The design years start in **September 2003**, when the bond funds first had a year of history. The check years are 2015–2020, and the final exam is 2021–2026, opened once. The bar is holding the S&P 500 (SPY), with a 60/40 mix for reference.

| Script | Question | Finding |
|---|---|---|
| `p0_sanity.js` | Does the portfolio engine match plain holding? | 100% SPY through the portfolio engine equals SPY buy & hold exactly. |
| `p1_families.js` | Fixed mixes, trend-protected mixes or momentum rotation? | Every fixed mix of stocks, bonds and gold beat SPY on smoothness in both periods. Only 4 of 312 momentum versions did. |
| `p2_refine.js` | Which mix, and does trend protection help? | 50/35/15 SPY/TLT/GLD ("Balanced") leads the stock-heavy mixes. 30/60/10 SPY/IEF/GLD ("Steady") has the best score. Trend protection cut drops further but cost growth. |
| `p3_final.js` | The final exam | Every portfolio trailed SPY in 2021–2026: Balanced 6.9% a year, Steady 4.8%, SPY 15.3%. Bonds fell with stocks in 2022. Momentum (a reference, not the pick) came closest at 11.7%. |

Over 2003–2026, Balanced grew 8.9% a year with a 25% worst drop, against 11.1% and 55% for SPY. Mixing assets gave a much smoother ride, but not more money.

## Round three: trying to beat holding (`leverage/`)

Rounds one and two could only win by dodging crashes. This round tried four ideas that can earn **more** than holding:

- **A.** Leverage with a trend switch.
- **B.** Volatility steering.
- **C.** More clues: trend, momentum, calm markets, the yield curve, credit stress and VIX.
- **D.** Sector rotation among Ken French's 10 industries.

**The rule**, fixed in advance: a robot must earn more per year than holding **and** have a worst drop no bigger than holding's.

**How it was tested.** `fetch_history.py` downloads Ken French's daily market and T-bill returns back to 1926, plus Federal Reserve rate data. `xbench.js` simulates holding 0x–3x the market with costs: a one-day delay, trading costs, borrowing at the T-bill rate plus a spread, and fund fees. `x0_calibrate.js` checks the simulation against the real SSO, UPRO, QLD and TQQQ funds; it comes within 0.2–0.7% a year. The periods were:

- **2001–2020:** design, where a robot had to win in **both** decades.
- **1950–2000:** a fresh exam.
- **1928–1949:** a stress test.

| Robot | 1950–2000 exam | 1928–1949 stress | 2021–2026 | 1928–2026 |
|---|---|---|---|---|
| Just holding | 12.7% · 48% | 3.9% · 84% | 14.0% · 26% | 9.6% · 84% |
| Gentle 1.5x + trend | **13.9% · 47%** | **6.7% · 54%** | 12.5% · 26% | 11.5% · 54% |
| Trend + vol steering (reference, not the rule's pick) | **16.0% · 39%** | **8.4% · 64%** | 12.8% · 22% | 12.8% · 64% |
| Moderate 2x + trend | 15.4% · 57% | **9.7% · 63%** | 12.9% · 42% | 13.5% · 63% |

Figures are growth per year · worst drop; bold means the robot passed the rule in that period.

**Why Moderate 2x failed the 1950–2000 exam** (`x5_why.js`): on Black Monday, 19 October 1987, the market fell 17% in a day while the robot was still at 2x, so it lost about 35% before its switch could react.

**What failed.** 3x leverage had drops of 75–89%. More clues collapsed in the Depression, with a 95% drop. Sector rotation and volatility steering alone had bigger drops than holding. No robot beat holding in 2021–2026.
