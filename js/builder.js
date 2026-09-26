/* Rule builder: edits a strategy object in place.
 * Every number in a rule can be fixed or linked to a "dial" (strategy.params),
 * which the auto-tuner is allowed to turn. */
(function () {
  'use strict';
  const { esc } = window.TLCharts;

  const UNITS = { days: 'days', width: '×', value: '' };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') el.className = attrs[k];
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) el.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
    for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }

  function slug(label, params) {
    let base = (label || 'dial').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 2)
      .map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w).join('') || 'dial';
    let k = base, n = 2;
    while (params[k]) k = base + n++;
    return k;
  }

  function niceRange(v, min, max, step) {
    const s = step && step !== 'any' ? step : (Math.abs(v) >= 20 ? 5 : 1);
    let lo = Math.max(min != null ? min : -Infinity, Math.round((v / 2) / s) * s);
    let hi = Math.min(max != null ? max : Infinity, Math.round((v * 2) / s) * s);
    if (v <= 0) { lo = v - 10 * s; hi = v + 10 * s; }
    if (hi <= lo) hi = lo + 10 * s;
    return { min: +lo.toFixed(4), max: +hi.toFixed(4), step: s };
  }

  /* A number field that can be fixed or linked to a dial. */
  function numField(st, ref, meta, onChange, rerender) {
    const linked = ref.p != null && st.params[ref.p];
    const wrap = h('span', { class: 'num' + (linked ? ' linked' : '') });
    const input = h('input', { type: 'number', step: meta.step || 'any', value: TL.val(st, ref), 'aria-label': meta.label || 'number' });
    if (linked) input.title = 'Linked to the dial "' + st.params[ref.p].label + '". Change it in the dials list.';
    input.disabled = !!linked;
    input.addEventListener('input', () => {
      const x = parseFloat(input.value);
      if (Number.isFinite(x)) { ref.v = x; onChange(); }
    });
    const sel = h('select', { title: 'Fixed number, or link to a dial the auto-tuner can turn', 'aria-label': 'Link to a dial' });
    sel.append(h('option', { value: '#' }, 'Fixed number'));
    for (const [k, d] of Object.entries(st.params)) sel.append(h('option', { value: k }, 'Dial: ' + d.label));
    sel.append(h('option', { value: '+' }, '＋ Make this a dial the tuner can turn'));
    sel.value = linked ? ref.p : '#';
    sel.addEventListener('change', () => {
      const cur = TL.val(st, ref);
      if (sel.value === '#') { delete ref.p; ref.v = cur; }
      else if (sel.value === '+') {
        const label = meta.dialLabel || meta.label || 'Dial';
        const key = slug(label, st.params);
        st.params[key] = { label, v: cur, ...niceRange(cur, meta.min, meta.max, meta.step), tune: true };
        delete ref.v; ref.p = key;
      } else { delete ref.v; ref.p = sel.value; }
      onChange(); rerender();
    });
    wrap.append(input);
    if (meta.unit) wrap.append(h('span', { class: 'unit' }, meta.unit));
    wrap.append(sel);
    return wrap;
  }

  function operandSelect(o, onPick) {
    const sel = h('select', { class: 'op', 'aria-label': 'Ingredient' });
    const groups = {};
    for (const [k, d] of Object.entries(TL.IND)) (groups[d.group] = groups[d.group] || []).push([k, d]);
    for (const [g, list] of Object.entries(groups)) {
      const og = h('optgroup', { label: g });
      for (const [k, d] of list) og.append(h('option', { value: k, title: d.help || '' }, d.label));
      sel.append(og);
    }
    sel.value = o.k;
    sel.title = (TL.IND[o.k] && TL.IND[o.k].help) || '';
    sel.addEventListener('change', () => onPick(sel.value));
    return sel;
  }

  function operandEditor(st, o, onChange, rerender, other) {
    const frag = h('span', { class: 'operand', style: 'display:contents' });
    frag.append(operandSelect(o, (k) => {
      o.k = k;
      o.args = TL.IND[k].args.map(a => ({ v: a.def }));
      onChange(); rerender();
    }));
    const d = TL.IND[o.k];
    (d.args || []).forEach((a, i) => {
      if (!o.args[i]) o.args[i] = { v: a.def };
      frag.append(numField(st, o.args[i], { label: a.name, unit: UNITS[a.name], min: a.min, max: a.max, step: a.step === 'any' ? 'any' : (a.step || 1), dialLabel: dialLabelFor(o.k, a.name, other) }, onChange, rerender));
    });
    return frag;
  }

  function dialLabelFor(k, arg, other) {
    const d = TL.IND[k];
    if (k === 'value') return other && TL.IND[other.k] && other.k !== 'value' ? TL.IND[other.k].label + ' level' : 'Level';
    if (arg === 'width') return 'Band width';
    return d.label.replace(/ of previous$/, '') + ' (days)';
  }

  function ruleRow(st, group, r, idx, onChange, rerender, isBuy) {
    const row = h('div', { class: 'rule' });
    row.append(operandEditor(st, r.a, onChange, rerender, r.b));
    const cmp = h('select', { class: 'cmp', 'aria-label': 'Comparison' });
    for (const [k, l] of Object.entries(TL.CMP)) cmp.append(h('option', { value: k }, l));
    cmp.value = r.cmp;
    cmp.addEventListener('change', () => { r.cmp = cmp.value; onChange(); });
    row.append(cmp);
    row.append(operandEditor(st, r.b, onChange, rerender, r.a));
    row.append(h('button', { class: 'x', title: 'Remove this rule', 'aria-label': 'Remove rule', onclick: () => { group.rules.splice(idx, 1); onChange(); rerender(); } }, '×'));
    const usesPos = [r.a, r.b].some(o => TL.IND[o.k] && TL.IND[o.k].scale === 'pos');
    if (isBuy && usesPos) row.append(h('p', { class: 'warnline', style: 'flex-basis:100%' }, '⚠ "My position" ingredients only have a value while the robot holds the stock, so this buy rule can never be true.'));
    return row;
  }

  function groupEditor(st, key, onChange, rerender) {
    const g = st[key], isBuy = key === 'buy';
    const box = h('div', { class: 'rule-group ' + key });
    const mode = h('select', { 'aria-label': 'How rules combine' },
      h('option', { value: 'all' }, 'ALL of these are true'), h('option', { value: 'any' }, 'ANY of these is true'));
    mode.value = g.mode;
    mode.addEventListener('change', () => { g.mode = mode.value; onChange(); });
    box.append(h('div', { class: 'rg-head' }, isBuy ? 'BUY when' : 'SELL when', mode));
    g.rules.forEach((r, i) => box.append(ruleRow(st, g, r, i, onChange, rerender, isBuy)));
    box.append(h('button', { class: 'add', onclick: () => {
      g.rules.push(isBuy ? { a: { k: 'close', args: [] }, cmp: '>', b: { k: 'sma', args: [{ v: 200 }] } }
                         : { a: { k: 'pnl', args: [] }, cmp: '>', b: { k: 'value', args: [{ v: 15 }] } });
      onChange(); rerender();
    } }, '＋ Add a rule'));
    if (!g.rules.length) box.append(h('p', { class: 'warnline' }, isBuy ? '⚠ With no buy rules the robot never buys.' : 'No sell rules: the robot only sells through the safety settings below.'));
    return box;
  }

  function riskEditor(st, onChange, rerender) {
    st.risk = Object.assign(TL.defaultRisk(), st.risk || {});
    const r = st.risk, box = h('div', { class: 'risk' });
    const row = (title, sub, item, meta, toggle) => {
      const left = h('div', { class: 'rl' });
      if (toggle) {
        const cb = h('input', { type: 'checkbox', 'aria-label': title });
        cb.checked = !!item.on;
        cb.addEventListener('change', () => { item.on = cb.checked; onChange(); rerender(); });
        left.append(cb);
      }
      left.append(h('div', {}, h('b', {}, title), h('small', {}, sub)));
      const f = numField(st, item, meta, onChange, rerender);
      if (toggle && !item.on) f.style.opacity = .45;
      return h('div', { class: 'risk-row' }, left, f);
    };
    box.append(row('Money per trade', 'Share of your money put into each buy', r.size, { unit: '%', min: 1, max: 100, step: 5, dialLabel: 'Money per trade (%)' }, false));
    box.append(row('Stop-loss', 'Sell if it falls this far below what you paid', r.stop, { unit: '%', min: 1, max: 50, step: 1, dialLabel: 'Stop-loss (%)' }, true));
    box.append(row('Take-profit', 'Sell once it rises this far above what you paid', r.take, { unit: '%', min: 1, max: 300, step: 5, dialLabel: 'Take-profit (%)' }, true));
    box.append(row('Trailing stop', 'Sell if it falls this far from its best price since buying', r.trail, { unit: '%', min: 1, max: 50, step: 1, dialLabel: 'Trailing stop (%)' }, true));
    box.append(row('Time limit', 'Sell after this many trading days', r.maxDays, { unit: 'days', min: 1, max: 500, step: 1, dialLabel: 'Time limit (days)' }, true));
    return box;
  }

  function comboCount(st) {
    return TL.tunables(st).reduce((a, t) => a * (Math.floor((t.max - t.min) / (t.step || 1) + 1e-9) + 1), 1);
  }

  /* The list of dials: value, whether the tuner may turn it, and its range. */
  function dialsEditor(el, st, opts) {
    const { onChange, editableLabels, allowDelete, rerender } = opts;
    el.innerHTML = '';
    const keys = Object.keys(st.params || {});
    if (!keys.length) {
      el.append(h('p', { class: 'hint' }, opts.emptyText || 'No dials yet. Next to any number in a rule, open the little menu and choose "Make this a dial".'));
      return;
    }
    const inUse = usedKeys(st);
    for (const k of keys) {
      const d = st.params[k];
      const card = h('div', { class: 'dial' + (d.tune ? '' : ' off') });
      const tune = h('input', { type: 'checkbox', title: 'Let the auto-tuner turn this dial', 'aria-label': 'Auto-tune ' + d.label });
      tune.checked = !!d.tune;
      tune.addEventListener('change', () => { d.tune = tune.checked; card.classList.toggle('off', !d.tune); onChange(); updateCount(); });
      const name = editableLabels
        ? h('input', { class: 'dial-label', value: d.label, 'aria-label': 'Dial name', oninput: (e) => { d.label = e.target.value; onChange(true); } })
        : h('span', { class: 'dial-name' }, d.label);
      const top = h('div', { class: 'dial-top' }, h('label', { class: 'check', title: 'Auto-tune' }, tune, 'Tune'), name);
      if (allowDelete) top.append(h('button', { class: 'x', title: inUse.has(k) ? 'Remove dial (the rules keep its current number)' : 'Remove dial', onclick: () => { unlink(st, k); delete st.params[k]; onChange(); rerender(); } }, '×'));
      card.append(top);
      const f = (label, prop, cls) => {
        const i = h('input', { type: 'number', step: 'any', value: d[prop] });
        i.addEventListener('input', () => { const x = parseFloat(i.value); if (Number.isFinite(x)) { d[prop] = prop === 'step' ? Math.max(1e-6, x) : x; onChange(prop !== 'v'); updateCount(); } });
        return h('label', { class: cls || '' }, label, i);
      };
      card.append(h('div', { class: 'dial-range' }, f('Now', 'v'), f('Lowest', 'min', 'rng'), f('Highest', 'max', 'rng'), f('Step', 'step', 'rng')));
      if (!inUse.has(k) && st.type !== 'portfolio') card.append(h('div', { class: 'dial-count' }, 'Not used by any rule yet.'));
      el.append(card);
    }
    const count = h('div', { class: 'dial-count' });
    el.append(count);
    function updateCount() {
      const n = comboCount(st), t = TL.tunables(st).length;
      count.textContent = t ? `${n.toLocaleString('en-US')} possible combinations of the ${t} tuned dial${t > 1 ? 's' : ''}.` : 'No dials are ticked for tuning.';
    }
    updateCount();
  }

  function usedKeys(st) {
    const s = new Set();
    const walk = (x) => { if (x && typeof x === 'object') { if (x.p) s.add(x.p); for (const k in x) if (k !== 'params') walk(x[k]); } };
    walk({ buy: st.buy, sell: st.sell, risk: st.risk });
    return s;
  }
  function unlink(st, key) {
    const walk = (x) => { if (x && typeof x === 'object') { if (x.p === key) { x.v = st.params[key].v; delete x.p; } for (const k in x) if (k !== 'params') walk(x[k]); } };
    walk({ buy: st.buy, sell: st.sell, risk: st.risk });
  }

  /* Everything below the header: dials, buy rules, sell rules, safety settings. */
  function renderBody(el, st, onChange) {
    const rerender = () => renderBody(el, st, onChange);
    el.innerHTML = '';
    el.append(h('h2', {}, 'Dials'));
    el.append(h('p', { class: 'hint' }, 'Dials are named numbers you can reuse in several rules and hand to the auto-tuner. Tick "Tune" to let the tuner try values between lowest and highest.'));
    const dials = h('div', { class: 'dials' });
    dialsEditor(dials, st, { onChange: (quiet) => onChange(quiet), editableLabels: true, allowDelete: true, rerender });
    el.append(dials);
    el.append(h('button', { class: 'add', style: 'margin-top:8px', onclick: () => {
      const key = slug('Dial', st.params);
      st.params[key] = { label: 'New dial', v: 20, min: 10, max: 60, step: 5, tune: true };
      onChange(); rerender();
    } }, '＋ Add a dial'));
    el.append(h('h2', {}, 'Rules'));
    el.append(h('p', { class: 'hint' }, 'Checked at every day\'s close. The robot trades at the next morning\'s open. Hover an ingredient for what it means.'));
    el.append(groupEditor(st, 'buy', onChange, rerender));
    el.append(groupEditor(st, 'sell', onChange, rerender));
    el.append(h('h2', {}, 'Safety & sizing'));
    el.append(riskEditor(st, onChange, rerender));
  }

  /* Plain-English summary of a strategy. */
  function summary(st) {
    const list = (g) => g.rules.length ? `<ul>${g.rules.map(r => `<li>${esc(TL.describeRule(st, r))}</li>`).join('')}</ul>` : ' <i>never</i>';
    const r = TL.riskOf(st), extra = [];
    if (Number.isFinite(r.stop)) extra.push(`stop-loss ${r.stop}%`);
    if (Number.isFinite(r.take)) extra.push(`take-profit ${r.take}%`);
    if (Number.isFinite(r.trail)) extra.push(`trailing stop ${r.trail}%`);
    if (Number.isFinite(r.maxDays)) extra.push(`sell after ${r.maxDays} days`);
    return `<b>Buy</b> when ${st.buy.mode === 'any' ? 'any' : 'all'} of:${list(st.buy)}<b>Sell</b> when ${st.sell.mode === 'any' ? 'any' : 'all'} of:${list(st.sell)}` +
      `<div>Puts <b>${Math.round(r.size * 100)}%</b> of the money into each trade${extra.length ? '; also ' + extra.join(', ') : ''}.</div>`;
  }

  window.TLBuilder = { renderBody, dialsEditor, summary, comboCount, h };
})();
