// Smoke test: loads the site at a phone and a desktop size, opens every tab,
// and fails if anything is logged as an error or the page scrolls sideways.
//
//   npm install --no-save playwright && npx playwright install chromium
//   node tests/smoke.js
//
// If cdn.jsdelivr.net is blocked where you run it, point LWC_FILE at a local
// copy of lightweight-charts.standalone.production.js (v4.2.3).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const VIEWPORTS = [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1366, height: 900 } },
];

const server = http.createServer((req, res) => {
  let file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  let failed = false;
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ ...vp, locale: 'en-US' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => { if (r.url().startsWith(url)) errors.push('failed to load ' + r.url()); });
    if (process.env.LWC_FILE) {
      const lwc = fs.readFileSync(process.env.LWC_FILE);
      await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ body: lwc, contentType: 'text/javascript' }));
    }
    // Web fonts are decoration; don't let a blocked font host fail the test.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#dataStamp:not(:has-text("Loading"))', { timeout: 15000 }).catch(() => errors.push('prices never loaded'));
    const sideways = [];
    for (const tab of await page.$$eval('[role=tab]', bs => bs.map(b => b.dataset.tab))) {
      await page.click(`[role=tab][data-tab="${tab}"]`);
      await page.waitForTimeout(800);
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      if (w[0] > w[1]) sideways.push(`${tab} (${w[0]}px wide in ${w[1]}px)`);
    }
    // Font aborts log as console errors; those are expected.
    const real = errors.filter(e => !/ERR_FAILED|ERR_CERT/.test(e) || e.startsWith('failed to load'));
    const ok = !real.length && !sideways.length;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${vp.name} ${vp.viewport.width}x${vp.viewport.height}`);
    real.forEach(e => console.log('  console error: ' + e));
    sideways.forEach(s => console.log('  scrolls sideways: ' + s));
    if (!ok) failed = true;
    await ctx.close();
  }
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
