// Real service-worker tests against synthetic local APIs. No student data or
// production services. The baseline is the committed network-first worker.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(tmpdir(), 'qcu-cache-checks');
await mkdir(output, { recursive: true });
const baseline = new Map(['index.html', 'assets/js/app.js', 'service-worker.js'].map(path => [path, execFileSync('git', ['show', 'HEAD:' + path], { cwd: root })]));
const hasLegacyBaseline = baseline.get('index.html').includes('/api/v1/bootstrap');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
let variant = 'before', identity = 'student-a:login-1', title = 'Programming', revision = 1, loggedIn = true;
let requests = [], failDashboard = false, editedWorker = false;
const entries = () => [{ entryId: 'entry-1', day: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long' }).format(), title, code: 'CC102', start: '00:01', end: '23:59', units: 3 }];
const dashboard = () => ({ status: 'OK', authenticated: true, routing: 'dashboard', cacheKey: identity + ':' + revision, profile: { userId: identity.split(':')[0], name: identity.startsWith('student-b') ? 'Student B' : 'Student A' }, entries: entries(), buildings: [], tasks: [], notes: [] });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://local');
  const record = { path: url.pathname + url.search, bytes: 0 };
  requests.push(record);
  const send = (status, body, type, headers = {}) => {
    const bytes = Buffer.from(body);
    record.bytes = bytes.length;
    response.writeHead(status, { 'Content-Type': type, ...headers }).end(bytes);
  };
  if (url.pathname.startsWith('/api/')) {
    await new Promise(done => setTimeout(done, url.searchParams.has('check') ? 40 : 200));
    let body = { status: 'OK', data: [] }, status = 200;
    if (url.pathname.endsWith('/bootstrap')) body = { status: 'OK', authenticated: loggedIn, routing: 'dashboard' };
    else if (url.pathname.endsWith('/dashboard')) {
      if (!loggedIn) { status = 401; body = { status: 'UNAUTHENTICATED', authenticated: false }; }
      else if (failDashboard && !url.searchParams.has('check')) { status = 503; body = { error: 'Fixture unavailable' }; }
      else body = url.searchParams.has('check') ? { status: 'OK', routing: 'dashboard', cacheKey: dashboard().cacheKey } : dashboard();
    } else if (url.pathname.startsWith('/api/google/')) body = { status: 'NOT_CONNECTED', connected: false };
    return send(status, JSON.stringify(body), 'application/json', { 'Cache-Control': 'no-store' });
  }
  // Match Cloudflare Pages' .html -> extensionless canonical redirects.
  if (url.pathname.endsWith('.html')) return send(302, '', 'text/plain', { Location: url.pathname === '/index.html' ? '/' : url.pathname.slice(0, -5) });
  const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : extname(url.pathname) ? url.pathname : url.pathname + '.html');
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return send(403, '', 'text/plain');
  try {
    const key = path.slice(1);
    let bytes = variant === 'before' && baseline.has(key) ? baseline.get(key) : await readFile(file);
    if (editedWorker && key === 'service-worker.js') bytes = Buffer.from(bytes.toString().replace(/const RELEASE = "[^"]+"/, 'const RELEASE = "fixture-next-release"'));
    await new Promise(done => setTimeout(done, 20));
    send(200, bytes, mime[extname(file)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch { send(404, 'Missing fixture resource', 'text/plain'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://cache.localhost:${server.address().port}`;
let browser;
const metrics = {};
async function ready(page) {
  await page.locator('#auth-dashboard').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[data-loading-region]'));
  await page.locator('#today-grid').getByText(title, { exact: true }).waitFor();
}
try {
  browser = await chromium.launch({ headless: true, args: [
    '--host-resolver-rules=MAP cache.localhost 127.0.0.1', '--no-proxy-server'
  ] });
  for (const mode of hasLegacyBaseline ? ['before', 'after'] : ['after']) {
    variant = mode;
    const context = await browser.newContext({ timezoneId: 'Asia/Manila', viewport: { width: 1280, height: 900 } });
    // Only unrelated third-party URLs are blocked; same-origin APIs are served
    // by the fixture HTTP server so the real service worker handles requests.
    await context.route(/^https:\/\//, route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    console.log('Checking ' + mode + ' worker');
    requests = [];
    await page.goto(origin + '/'); await ready(page);
    const startupCalls = requests.filter(r => /\/api\/v1\/(dashboard|bootstrap)/.test(r.path)).length;
    assert.equal(startupCalls, mode === 'before' ? 2 : 1, 'cold startup request count');
    await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not activate')), 12000))
    ]));
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    requests = [];
    const started = performance.now();
    await page.reload(); await ready(page);
    const elapsed = performance.now() - started;
    const assetRequests = requests.filter(r => r.path.startsWith('/assets/'));
    metrics[mode] = { coldStartupCalls: startupCalls, warmReadyMs: Math.round(elapsed), warmAssetRequests: assetRequests.length, warmAssetBytes: assetRequests.reduce((sum, r) => sum + r.bytes, 0), warmDataCalls: requests.filter(r => /\/api\/v1\/(dashboard|bootstrap)/.test(r.path)).map(r => r.path) };
    if (mode === 'before') { await context.close(); continue; }
    assert.equal(assetRequests.length, 0, 'repeat navigation serves release assets from Cache Storage');
    assert.deepEqual(metrics.after.warmDataCalls, ['/api/v1/dashboard?check=1']);
    const keys = await page.evaluate(async () => {
      const result = [];
      for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) result.push(request.url);
      return result;
    });
    assert(!keys.some(key => key.includes('/api/')), 'private API data never enters the shared service worker cache');
    assert(keys.some(key => key.endsWith('/workspace.html')), 'workspace is precached');
    const card = await page.locator('.home-today-card').elementHandle();
    const calendar = await page.locator('.soft-cal-cell[data-day-name]').first().elementHandle();
    await page.waitForFunction(() => document.querySelector('#live-time')?.textContent.includes(':'));
    await new Promise(done => setTimeout(done, 2100));
    assert(await card.evaluate(node => node.isConnected), 'clock ticks preserve class cards');
    assert(await calendar.evaluate(node => node.isConnected), 'clock ticks preserve calendar buttons and focus');
    console.log('PASS cache serves all repeat assets; API responses excluded; clock ticks preserve DOM');

    // A stale snapshot remains visible during a failed background refresh.
    await page.evaluate(() => { const value = JSON.parse(sessionStorage.getItem('qcu-dashboard-v1')); value.at -= 61_000; sessionStorage.setItem('qcu-dashboard-v1', JSON.stringify(value)); });
    failDashboard = true;
    await page.reload(); await ready(page);
    await page.getByText(/Refresh failed\. Showing your last loaded content/).waitFor();
    failDashboard = false; title = 'Updated programming';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('#today-grid').getByText(title, { exact: true }).waitFor();
    console.log('PASS failed background refresh preserves content; retry displays current data');

    await context.setOffline(true);
    await page.goto(origin + '/workspace');
    await page.getByText(/offline|unavailable/i).first().waitFor();
    assert.equal(await page.locator('#task-list').getByText('Private task').count(), 0);
    await context.setOffline(false);
    console.log('PASS offline navigation loads the shell and reports unavailable private data');

    // Account switching and denied access must invalidate the previous snapshot.
    identity = 'student-b:login-2';
    await page.goto(origin + '/schedule.html');
    await page.waitForFunction(() => !document.querySelector('[data-loading-region]'));
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qcu-dashboard-v1')).data.profile.userId), 'student-b');
    loggedIn = false;
    await page.goto(origin + '/');
    await page.locator('#auth-landing').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('qcu-dashboard-v1')), null);
    loggedIn = true; identity = 'student-a:login-3';
    await page.goto(origin + '/'); await ready(page);
    console.log('PASS account switching replaces snapshots; session denial clears them');

    // Active forms survive deployment activation. The next navigation gets the
    // new worker's shell and assets; the open tab offers a refresh action.
    editedWorker = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
      const worker = registration.installing || registration.waiting;
      if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('New worker did not activate')), 12000);
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
          if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('New worker installation failed')); }
        });
      });
    });
    await page.getByText('An update is ready. Refresh when you have finished editing.').waitFor();
    const cacheNames = await page.evaluate(() => caches.keys());
    assert.deepEqual(cacheNames.filter(key => key.startsWith('qcu-schedule-')), ['qcu-schedule-fixture-next-release']);
    editedWorker = false;
    await page.screenshot({ path: resolve(output, 'dashboard-cache.png'), fullPage: true });
    const other = await context.newPage();
    await other.goto(origin + '/workspace.html');
    await other.waitForFunction(() => !document.querySelector('[data-loading-region]'));
    await page.evaluate(() => window.QCUData.invalidate('logout'));
    await other.getByText('Please sign in again to continue.', { exact: false }).waitFor();
    assert.equal(await other.evaluate(() => sessionStorage.getItem('qcu-dashboard-v1')), null);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS deployment update keeps the open page; logout clears other tabs');
    await context.close();
  }
  await writeFile(resolve(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
  console.log('Local fixture timing only (40 ms account check, 200 ms full API). Results: ' + output);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
