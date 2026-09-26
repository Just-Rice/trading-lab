const B = require('./bench.js');
const { TL, evalBasket, fmtRow } = B;
const bhStrat = B.strat('Buy & hold', {}, { mode: 'all', rules: [B.rule(B.op('close'), '>', B.op('value', B.N(0)))] }, { mode: 'any', rules: [] });
console.log('TRAIN 2000-2014, 10 ETFs (median across funds)');
console.log(fmtRow('Buy & hold (engine)', evalBasket(bhStrat, 'train')));
for (const r of TL.RECIPES) console.log(fmtRow('Built-in: ' + r.name, evalBasket(r, 'train')));
