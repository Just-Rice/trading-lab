// Does the simulated leverage match real 2x and 3x funds? Use SPY/QQQ daily returns with the same cost model.
const fs = require('fs'); const X = require('./xbench.js');
const L = JSON.parse(fs.readFileSync(__dirname + '/xdata/lev.json'));
const rfByDay = new Map(X.D.d.map((d, i) => [d, X.D.rf[i]]));
function compare(base, fund, lev, start) {
  const days = Object.keys(L[fund]).map(Number).filter(d => d >= start && L[base][d] && rfByDay.has(d)).sort((a, b) => a - b);
  let sim = 1, real = 1;
  for (let k = 1; k < days.length; k++) {
    const d0 = days[k - 1], d1 = days[k];
    const rb = L[base][d1] / L[base][d0] - 1, rf = rfByDay.get(d1);
    sim *= 1 + lev * rb + (1 - lev) * rf - ((lev - 1) * X.COST.spread + Math.min(1, lev - 1) * X.COST.levFee) / 252;
    real *= 1 + (L[fund][d1] / L[fund][d0] - 1);
  }
  const yrs = days.length / 252;
  console.log(`${fund} (${lev}x ${base}) ${days[0]}→${days[days.length - 1]}: real ${((real ** (1 / yrs) - 1) * 100).toFixed(1)}%/yr · simulated ${((sim ** (1 / yrs) - 1) * 100).toFixed(1)}%/yr`);
}
compare('SPY', 'SSO', 2, 20060622); compare('SPY', 'UPRO', 3, 20090626); compare('QQQ', 'QLD', 2, 20060622); compare('QQQ', 'TQQQ', 3, 20100212);
