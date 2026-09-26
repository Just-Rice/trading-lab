/* Finnhub client for live US stock prices (free plan): quotes, market status and a
 * live trade stream. Used by the Live tab as an alternative to Alpaca's price feed. */
(function (root) {
  'use strict';
  const API = 'https://finnhub.io/api/v1';
  const STREAM = 'wss://ws.finnhub.io';

  function client(key) {
    async function call(path) {
      const r = await root.fetch(`${API}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(key)}`);
      let data = null;
      try { data = await r.json(); } catch (e) { /* not JSON */ }
      if (!r.ok) {
        const err = new Error(r.status === 401 ? 'Finnhub did not accept that key' : r.status === 429 ? 'Finnhub rate limit reached; slowing down' : (data && data.error) || `Finnhub said ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return data;
    }
    return {
      key,
      // {c: current, h, l, o, pc: previous close, t: unix seconds}
      quote: (sym) => call(`/quote?symbol=${encodeURIComponent(sym)}`),
      // {isOpen, session: 'pre-market' | 'regular' | 'post-market' | null, holiday}
      marketStatus: () => call('/stock/market-status?exchange=US'),
    };
  }

  // Live trades over a websocket. Calls onTrade({price, time}) and onStatus(text, ok).
  function stream(key, sym, onTrade, onStatus) {
    let ws, closed = false;
    try { ws = new root.WebSocket(`${STREAM}?token=${encodeURIComponent(key)}`); } catch (e) { onStatus('Live stream unavailable', false); return { close() {} }; }
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'subscribe', symbol: sym })); onStatus('Streaming live trades from Finnhub', true); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'trade') {
        let last = null;
        for (const t of m.data || []) if (t.s === sym && (!last || t.t >= last.t)) last = t;
        if (last) onTrade({ price: last.p, time: last.t });
      } else if (m.type === 'error') onStatus('Finnhub stream: ' + m.msg, false);
    };
    ws.onclose = () => { if (!closed) onStatus('Live stream closed; checking prices every few seconds instead', false); };
    ws.onerror = () => onStatus('Live stream error; checking prices every few seconds instead', false);
    return { close() { closed = true; try { ws.send(JSON.stringify({ type: 'unsubscribe', symbol: sym })); ws.close(); } catch (e) { /* ignore */ } } };
  }

  root.TLFinnhub = { client, stream };
})(typeof self !== 'undefined' ? self : globalThis);
