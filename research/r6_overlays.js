const B = require('./bench.js'); const { C1, C2 } = require('./cands.js');
for (const [name, mk] of [['C1', C1], ['C2', C2]]) {
  console.log(B.fmtRow(name + ' plain', B.evalBasket(mk(), 'train')));
  for (const v of [10, 15, 20, 25]) console.log(B.fmtRow(`${name} + stop-loss ${v}%`, B.evalBasket(mk({ stop: { on: true, v } }), 'train')));
  for (const v of [10, 15, 20, 25]) console.log(B.fmtRow(`${name} + trailing stop ${v}%`, B.evalBasket(mk({ trail: { on: true, v } }), 'train')));
}
