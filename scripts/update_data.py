#!/usr/bin/env python3
"""Download daily US stock prices for the Trading Lab and save them under data/.

Prices come from Yahoo Finance's public chart endpoint, which needs no key.
Every price is adjusted for splits and dividends, so a long history can be
tested as one continuous series. Run by the nightly GitHub Action; if a ticker
fails to download, its previous file is kept.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
START = int(datetime(2000, 1, 1, tzinfo=timezone.utc).timestamp())

TICKERS = [
    # (symbol, name, group)
    ("SPY", "S&P 500 index fund", "Index funds"),
    ("QQQ", "Nasdaq-100 index fund", "Index funds"),
    ("DIA", "Dow Jones index fund", "Index funds"),
    ("IWM", "Russell 2000 small-company fund", "Index funds"),
    ("VTI", "Total US stock market fund", "Index funds"),
    ("EFA", "Developed markets outside the US", "International"),
    ("EEM", "Emerging markets", "International"),
    ("TLT", "Long-term US Treasury bonds (20+ years)", "Bonds"),
    ("IEF", "Medium-term US Treasury bonds (7-10 years)", "Bonds"),
    ("SHY", "Short-term US Treasury bonds (1-3 years)", "Bonds"),
    ("BIL", "US Treasury bills (cash-like)", "Bonds"),
    ("AGG", "Total US bond market", "Bonds"),
    ("TIP", "Inflation-protected US Treasury bonds", "Bonds"),
    ("LQD", "Investment-grade corporate bonds", "Bonds"),
    ("GLD", "Gold", "Gold & commodities"),
    ("SLV", "Silver", "Gold & commodities"),
    ("DBC", "Broad commodities", "Gold & commodities"),
    ("VNQ", "US real estate (REITs)", "Real estate"),
    ("XLK", "Technology sector fund", "Sector funds"),
    ("XLF", "Financial sector fund", "Sector funds"),
    ("XLE", "Energy sector fund", "Sector funds"),
    ("XLV", "Health care sector fund", "Sector funds"),
    ("XLP", "Consumer staples sector fund", "Sector funds"),
    ("XLY", "Consumer discretionary sector fund", "Sector funds"),
    ("XLI", "Industrials sector fund", "Sector funds"),
    ("XLU", "Utilities sector fund", "Sector funds"),
    ("XLB", "Materials sector fund", "Sector funds"),
    ("AAPL", "Apple", "Tech"),
    ("MSFT", "Microsoft", "Tech"),
    ("NVDA", "Nvidia", "Tech"),
    ("GOOGL", "Alphabet (Google)", "Tech"),
    ("META", "Meta (Facebook)", "Tech"),
    ("AMZN", "Amazon", "Tech"),
    ("TSLA", "Tesla", "Tech"),
    ("NFLX", "Netflix", "Tech"),
    ("AMD", "AMD", "Tech"),
    ("INTC", "Intel", "Tech"),
    ("ORCL", "Oracle", "Tech"),
    ("ADBE", "Adobe", "Tech"),
    ("CRM", "Salesforce", "Tech"),
    ("PLTR", "Palantir", "Tech"),
    ("BRK-B", "Berkshire Hathaway", "Finance"),
    ("JPM", "JPMorgan Chase", "Finance"),
    ("V", "Visa", "Finance"),
    ("GS", "Goldman Sachs", "Finance"),
    ("JNJ", "Johnson & Johnson", "Health"),
    ("UNH", "UnitedHealth", "Health"),
    ("PFE", "Pfizer", "Health"),
    ("WMT", "Walmart", "Consumer"),
    ("COST", "Costco", "Consumer"),
    ("KO", "Coca-Cola", "Consumer"),
    ("PEP", "PepsiCo", "Consumer"),
    ("MCD", "McDonald's", "Consumer"),
    ("NKE", "Nike", "Consumer"),
    ("DIS", "Disney", "Consumer"),
    ("HD", "Home Depot", "Consumer"),
    ("XOM", "ExxonMobil", "Industry & energy"),
    ("CAT", "Caterpillar", "Industry & energy"),
    ("BA", "Boeing", "Industry & energy"),
]


def sig(x, digits=6):
    """Round to significant figures so old split-adjusted prices keep precision."""
    return float(f"{x:.{digits}g}")


def fetch(symbol):
    now = int(time.time()) + 86400
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?period1={START}&period2={now}&interval=1d&events=div%2Csplit")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (trading-lab data updater)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = json.load(r)
    res = payload["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    adj = res["indicators"]["adjclose"][0]["adjclose"]
    out = {"s": symbol, "t": [], "o": [], "h": [], "l": [], "c": [], "v": []}
    offset = res["meta"].get("gmtoffset", -14400)
    for i, ts in enumerate(res["timestamp"]):
        o, h, l, c, v, a = q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i], adj[i]
        if None in (o, h, l, c, a) or c <= 0:
            continue
        f = a / c  # adjustment factor for splits and dividends
        day = (ts + offset) // 86400  # trading day in New York, as days since 1970
        if out["t"] and out["t"][-1] == day:
            continue
        out["t"].append(day)
        out["o"].append(sig(o * f))
        out["h"].append(sig(h * f))
        out["l"].append(sig(l * f))
        out["c"].append(sig(c * f))
        out["v"].append(int(v or 0))
    return out


def day_str(d):
    return datetime.fromtimestamp(d * 86400, tz=timezone.utc).strftime("%Y-%m-%d")


def main():
    os.makedirs(DATA, exist_ok=True)
    manifest_path = os.path.join(DATA, "manifest.json")
    old = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            old = {t["s"]: t for t in json.load(f).get("tickers", [])}
    entries, failed = [], []
    for symbol, name, group in TICKERS:
        try:
            data = fetch(symbol)
            if len(data["t"]) < 300:
                raise ValueError(f"only {len(data['t'])} rows")
            # Drop today's bar while the market is still open: the file is a daily-close history.
            ny = datetime.now(ZoneInfo("America/New_York"))
            today = datetime(ny.year, ny.month, ny.day, tzinfo=timezone.utc).timestamp() // 86400
            if data["t"][-1] == today and (ny.hour, ny.minute) < (16, 15):
                for k in "tohlcv":
                    data[k].pop()
            with open(os.path.join(DATA, f"{symbol}.json"), "w") as f:
                json.dump(data, f, separators=(",", ":"))
            entries.append({"s": symbol, "n": name, "g": group, "from": day_str(data["t"][0]),
                            "to": day_str(data["t"][-1]), "rows": len(data["t"])})
            print(f"{symbol:6} {len(data['t']):5} rows  {entries[-1]['from']} -> {entries[-1]['to']}")
        except Exception as e:  # keep the previous file if there is one
            failed.append(symbol)
            print(f"{symbol:6} FAILED: {e}", file=sys.stderr)
            if symbol in old and os.path.exists(os.path.join(DATA, f"{symbol}.json")):
                entries.append({**old[symbol], "n": name, "g": group})
        time.sleep(0.4)
    manifest = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "tickers": entries}
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"\n{len(entries)} tickers saved, {len(failed)} failed {failed if failed else ''}")
    if len(failed) == len(TICKERS):
        sys.exit(1)


if __name__ == "__main__":
    main()
