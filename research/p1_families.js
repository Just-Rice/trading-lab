const B = require('./pbench.js');
const { P, evalBoth, fm, bm } = B;
const UNIS = {
  classes: ['SPY', 'EFA', 'EEM', 'TLT', 'IEF', 'GLD', 'DBC', 'VNQ'],
  wide: ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'IEF', 'LQD', 'TIP', 'GLD', 'SLV', 'DBC', 'VNQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLP', 'XLY', 'XLI', 'XLU', 'XLB'],
  core: ['SPY', 'EFA', 'TLT', 'GLD'],
};
const res = [];
const add = (label, strat) => res.push({ label, ...evalBoth(strat) });
// fixed mixes
add('Fixed: 100% SPY', B.SPY);
add('Fixed: 60/40 SPY/IEF', B.SIXTY);
add('Fixed: 60/40 SPY/TLT', P({ mode: 'fixed', assets: ['SPY', 'TLT'], weights: { SPY: 60, TLT: 40 } }));
add('Fixed: permanent (SPY/TLT/GLD/SHY)', P({ mode: 'fixed', assets: ['SPY', 'TLT', 'GLD', 'SHY'], weights: { SPY: 25, TLT: 25, GLD: 25, SHY: 25 } }));
add('Fixed: all-weather style', P({ mode: 'fixed', assets: ['SPY', 'TLT', 'IEF', 'GLD', 'DBC'], weights: { SPY: 30, TLT: 40, IEF: 15, GLD: 7.5, DBC: 7.5 } }));
add('Fixed: equal asset classes', P({ mode: 'fixed', assets: UNIS.classes, weights: Object.fromEntries(UNIS.classes.map(s => [s, 1])) }));
add('Fixed: SPY/TLT/GLD 50/30/20', P({ mode: 'fixed', assets: ['SPY', 'TLT', 'GLD'], weights: { SPY: 50, TLT: 30, GLD: 20 } }));
// trend (hold each asset while above its average)
for (const [un, assets] of Object.entries(UNIS)) for (const f of [100, 150, 200, 250]) for (const safe of ['cash', 'SHY']) for (const wt of ['equal', 'invvol'])
  add(`Trend ${un} sma${f} safe ${safe} ${wt}`, P({ mode: 'trend', assets, filter: { v: f }, safe, weighting: wt }));
// momentum rotation
for (const [un, assets] of Object.entries(UNIS)) for (const top of [1, 2, 3, 4, 5]) for (const lk of ['blend', 63, 126, 252]) for (const af of ['none', 'positive', 'trend']) for (const wt of ['equal', 'invvol']) {
  if (top >= assets.length) continue;
  add(`Mom ${un} top${top} ${lk} ${af} ${wt}`, P({ mode: 'momentum', assets, top: { v: top }, look: { v: lk === 'blend' ? 126 : lk }, lookMode: lk === 'blend' ? 'blend' : 'single', absFilter: af, filter: { v: 200 }, safe: 'SHY', weighting: wt }));
}
res.sort((a, b) => b.robust - a.robust);
console.log(`Benchmarks · design 2003-09→2014: SPY ${fm(bm.train.spy)} | 60/40 ${fm(bm.train.sixty)}`);
console.log(`             check  2015→2020:    SPY ${fm(bm.valid.spy)} | 60/40 ${fm(bm.valid.sixty)}\n`);
console.log('Robust = worse of (design, check) score vs SPY. SPY = 0. Top 25 of', res.length);
for (const r of res.slice(0, 25)) console.log(r.robust.toFixed(3).padStart(7), r.label.padEnd(44), '| design', fm(r.t), '| check', fm(r.v));
console.log('\nFixed mixes:'); for (const r of res.filter(x => x.label.startsWith('Fixed'))) console.log(r.robust.toFixed(3).padStart(7), r.label.padEnd(44), '| design', fm(r.t), '| check', fm(r.v));
console.log('\nBeat SPY in both periods:', res.filter(r => r.robust > 0).length, 'of', res.length, ' | by family:', ['Fixed', 'Trend', 'Mom'].map(f => f + ' ' + res.filter(r => r.label.startsWith(f) && r.robust > 0).length + '/' + res.filter(r => r.label.startsWith(f)).length).join(', '));

