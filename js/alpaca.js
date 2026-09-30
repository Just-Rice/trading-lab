/* Alpaca client for the practice (paper) account and the free IEX price feed.
 * Shared by the page (live watch) and the Node script behind the automatic daily bot.
 * Only the paper-trading address is ever used, so real money can't be touched. */
(function (root) {
  'use strict';
  const PAPER = 'https://paper-api.alpaca.markets';
  const DATA = 'https://data.alpaca.markets';
  const STREAM = 'wss://stream.data.alpaca.markets/v2/iex';

  function client(key, secret, fetchImpl) {
    const f = fetchImpl || root.fetch.bind(root);
    async function call(base, path, opts = {}) {
      const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
      if (opts.body) headers['Content-Type'] = 'application/json';
      const r = await f(base + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!r.ok) {
        const err = new Error((data && data.message) || `Alpaca said ${r.status}`);
        err.status = r.status; err.data = data;
        throw err;
      }
      return data;
    }
    return {
      key, secret,
      account: () => call(PAPER, '/v2/account'),
      clock: () => call(PAPER, '/v2/clock'),
      positions: () => call(PAPER, '/v2/positions'),
      position: (sym) => call(PAPER, `/v2/positions/${encodeURIComponent(sym)}`).catch(e => { if (e.status === 404) return null; throw e; }),
      orders: (status = 'all', limit = 25) => call(PAPER, `/v2/orders?status=${status}&limit=${limit}&direction=desc&nested=true`),
      openOrdersFor: (sym) => call(PAPER, `/v2/orders?status=open&symbols=${encodeURIComponent(sym)}`),
      cancelOrder: (id) => call(PAPER, `/v2/orders/${id}`, { method: 'DELETE' }),
      closePosition: (sym) => call(PAPER, `/v2/positions/${encodeURIComponent(sym)}`, { method: 'DELETE' }),
      submitOrder: (o) => call(PAPER, '/v2/orders', { method: 'POST', body: o }),
      cancelAllOrders: () => call(PAPER, '/v2/orders', { method: 'DELETE' }),
      closeAllPositions: () => call(PAPER, '/v2/positions?cancel_orders=true', { method: 'DELETE' }),
      snapshot: (sym) => call(DATA, `/v2/stocks/${encodeURIComponent(sym)}/snapshot?feed=iex`),
      dailyBars: (sym, startISO) => call(DATA, `/v2/stocks/${encodeURIComponent(sym)}/bars?timeframe=1Day&start=${startISO}&adjustment=all&feed=iex&limit=1000`),
    };
  }

  const r2 = (x) => Math.round(x * 100) / 100;

  // Buy whole shares at market. Stop-loss and take-profit, if set, ride along as
  // real orders at Alpaca ("bracket" when both, "one-triggers-other" when one),
  // good until cancelled, so they work even when nothing is watching.
  async function buy(c, sym, qty, refPrice, risk) {
    const o = { symbol: sym, qty: String(qty), side: 'buy', type: 'market', time_in_force: 'gtc' };
    const hasStop = Number.isFinite(risk.stop), hasTake = Number.isFinite(risk.take);
    if (hasStop) o.stop_loss = { stop_price: String(r2(refPrice * (1 - risk.stop / 100))) };
    if (hasTake) o.take_profit = { limit_price: String(r2(refPrice * (1 + risk.take / 100))) };
    if (hasStop && hasTake) o.order_class = 'bracket';
    else if (hasStop || hasTake) o.order_class = 'oto';
    return c.submitOrder(o);
  }

  // Sell everything in one stock: cancel its waiting orders first (a stop-loss
  // order would otherwise "hold" the shares), then close the position.
  async function sellAll(c, sym) {
    const open = await c.openOrdersFor(sym);
    for (const o of open || []) { try { await c.cancelOrder(o.id); } catch (e) { /* already gone */ } }
    if (open && open.length) await new Promise(r => setTimeout(r, 800));
    return c.closePosition(sym);
  }

  // Live trades over a websocket. Calls onTrade({price, time}) and onStatus(text, ok).
  function stream(key, secret, sym, onTrade, onStatus) {
    let ws, closed = false;
    try { ws = new root.WebSocket(STREAM); } catch (e) { onStatus('Live stream unavailable', false); return { close() {} }; }
    ws.onmessage = (ev) => {
      let msgs; try { msgs = JSON.parse(ev.data); } catch (e) { return; }
      for (const m of msgs) {
        if (m.T === 'success' && m.msg === 'connected') ws.send(JSON.stringify({ action: 'auth', key, secret }));
        else if (m.T === 'success' && m.msg === 'authenticated') { ws.send(JSON.stringify({ action: 'subscribe', trades: [sym] })); onStatus('Streaming live trades', true); }
        else if (m.T === 'error') onStatus(`Stream: ${m.msg}${m.code === 406 ? ' (another tab may be streaming)' : ''}`, false);
        else if (m.T === 't' && m.S === sym) onTrade({ price: m.p, size: m.s, time: m.t });
      }
    };
    ws.onclose = () => { if (!closed) onStatus('Live stream closed; checking prices every few seconds instead', false); };
    ws.onerror = () => onStatus('Live stream error; checking prices every few seconds instead', false);
    return { close() { closed = true; try { ws.close(); } catch (e) { /* ignore */ } } };
  }

  root.TLAlpaca = { client, buy, sellAll, stream, PAPER, DATA };
})(typeof self !== 'undefined' ? self : globalThis);
