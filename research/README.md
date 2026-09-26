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
