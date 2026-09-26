#!/usr/bin/env python3
"""Download the long history used by the leverage study into research/leverage/xdata/.

- Ken French data library: daily US stock-market returns (with dividends), T-bill returns
  and 10 industry groups, 1926 onward.
- Federal Reserve (FRED): 3-month T-bill, 10-year Treasury, yield curve, corporate-bond
  spread and VIX.
- Yahoo: SPY, SSO, UPRO, QQQ, QLD and TQQQ, to check the simulated leverage.
Then run: node x0_calibrate.js, x1_search.js, x2_sectors.js, x3_exam.js, x4_full.js, x5_why.js
"""
import csv, io, json, os, time, urllib.request, zipfile
from datetime import datetime, timezone

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "xdata")
os.makedirs(HERE, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (trading-lab research)"}


def get(url, timeout=90):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def french(name):
    z = zipfile.ZipFile(io.BytesIO(get(f"https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/{name}_CSV.zip")))
    return z.read(z.namelist()[0]).decode("latin-1")


factors = french("F-F_Research_Data_Factors_daily")
d, mkt, rf = [], [], []
for row in csv.reader(io.StringIO(factors)):
    if len(row) >= 5 and row[0].strip().isdigit() and len(row[0].strip()) == 8:
        d.append(int(row[0])); mkt.append((float(row[1]) + float(row[4])) / 100); rf.append(float(row[4]) / 100)
ind_text, names, ind, started = french("10_Industry_Portfolios_daily"), [], {}, False
for row in csv.reader(io.StringIO(ind_text)):
    cells = [c.strip() for c in row]
    if not started:
        if len(cells) > 5 and cells[0] == "" and cells[1]:
            names = cells[1:11]; started = True; ind = {n: {} for n in names}
        continue
    if not cells or not cells[0].isdigit():
        if ind[names[0]]: break
        continue
    for n, v in zip(names, cells[1:11]):
        x = float(v); ind[n][int(cells[0])] = None if x <= -99 else x / 100


def fred(series):
    out = {}
    for i, row in enumerate(csv.reader(io.StringIO(get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}").decode()))):
        if i and len(row) > 1 and row[1] not in ("", "."):
            out[int(row[0].replace("-", ""))] = float(row[1])
    return out


def ffill(series):
    keys, out, last, j = sorted(series), [], None, 0
    for day in d:
        while j < len(keys) and keys[j] <= day: last = series[keys[j]]; j += 1
        out.append(last if keys and day >= keys[0] else None)
    return out


F = {k: fred(v) for k, v in [("tb3", "DTB3"), ("y10", "DGS10"), ("t10y3m", "T10Y3M"), ("baa", "BAA10Y"), ("vix", "VIXCLS")]}
data = {"d": d, "mkt": mkt, "rf": rf, "ind": {n: [ind[n].get(x) for x in d] for n in names}, **{k: ffill(v) for k, v in F.items()}}
json.dump(data, open(os.path.join(HERE, "research.json"), "w"))


def yahoo(sym):
    r = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=0&period2={int(time.time())}&interval=1d&events=div%2Csplit"))["chart"]["result"][0]
    off = r["meta"].get("gmtoffset", -14400)
    return {int(datetime.fromtimestamp(ts + off, tz=timezone.utc).strftime("%Y%m%d")): a for ts, a in zip(r["timestamp"], r["indicators"]["adjclose"][0]["adjclose"]) if a}


json.dump({s: yahoo(s) for s in ["SPY", "SSO", "UPRO", "QQQ", "QLD", "TQQQ"]}, open(os.path.join(HERE, "lev.json"), "w"))
print("saved", len(d), "days", d[0], "->", d[-1])
