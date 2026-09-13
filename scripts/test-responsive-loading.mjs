// Local browser regression: synthetic responses only; no accounts or external APIs.
// Run `npx playwright install chromium` once, then `npm run test:loading`.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(tmpdir(), 'qcu-loading-checks');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const pages = ['index', 'today', 'schedule', 'workspace', 'buildings', 'settings', 'google', 'campus-eta', 'onboarding', 'admin'];
const dashboard = { status: 'OK', profile: { name: 'Test Student' }, entries: [], buildings: [], tasks: [], notes: [] };
const adminUser = { userId: 'test-student', displayName: 'Test Student', accountStatus: 'ACTIVE', onboardingState: 'ACTIVE' };
const admin = { users: [adminUser], total: 1, pageSize: 20, filters: { campuses: [], programs: [], sections: [] }, counts: { total: 1, today: 0, week: 0, active: 1, suspended: 0 }, audit: [], refreshedAt: new Date().toISOString() };
function reply(path) {
  if (path.endsWith('/bootstrap')) return { authenticated: true, routing: 'dashboard' };
  if (path.endsWith('/dashboard')) return dashboard;
  if (path.endsWith('/session')) return { status: 'OK', user: { userId: 'test', name: 'Test Student' } };
  if (path.endsWith('/onboarding/status')) return { status: 'OK', stage: 'WELCOME' };
  if (path.endsWith('/google/status')) return { connected: false, status: 'not_connected' };
  if (path.endsWith('/admin/users')) return admin;
  return { status: 'OK', data: [] };
}
async function checkAdminDetails(page) {
  const button = page.getByRole('button', { name: 'View Test Student', exact: true });
  const width = await button.evaluate(el => el.getBoundingClientRect().width);
  const label = await button.getAttribute('aria-label');
  for (const status of [503, 200]) {
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { started = resolve; });
    let calls = 0;
    const handler = async route => {
      calls++;
      started();
      await gate;
      await route.fulfill({ status, json: status === 503 ? { error: 'Details temporarily unavailable' } : {
        user: adminUser, profiles: [], enrollments: [], schedule: [], cor: [], dependencies: {}, protected: true
      } });
    };
    await page.route('**/api/admin/users?userId=*', handler);
    await button.click();
    await requested;
    const pending = page.locator('#users button');
    assert(await pending.isDisabled(), 'Admin View stays disabled until details resolve');
    assert.equal(await pending.getAttribute('aria-busy'), 'true');
    assert.equal(await pending.evaluate(el => el.getBoundingClientRect().width), width);
    await pending.evaluate(el => el.click());
    release();
    await page.waitForFunction(() => !document.querySelector('#users button').disabled);
    assert.equal(calls, 1, 'Duplicate View clicks must not request details again');
    assert.equal(await button.getAttribute('aria-busy'), null);
    assert.equal(await button.getAttribute('aria-label'), label);
    assert.equal(await button.evaluate(el => el.classList.contains('btn-spinner')), false);
    if (status === 503) {
      assert.match(await page.locator('#message').innerText(), /temporarily unavailable/);
      assert.equal(await page.locator('#details').evaluate(el => el.open), false);
    } else {
      assert.equal(await page.locator('#details').evaluate(el => el.open), true);
      await page.locator('#close-dialog').click();
    }
    await page.unroute('**/api/admin/users?userId=*', handler);
  }
  console.log('PASS admin details spinner, duplicate-click prevention, failure recovery, and successful retry');
}
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1440]) {
    for (const name of pages) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/api/')) {
          await gate;
          return route.fulfill({ json: reply(url.pathname) });
        }
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/${name}.html`, { waitUntil: 'domcontentloaded' });
      const state = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('.skeleton-pulse, .skeleton-line, .bus-skeleton-bar')].filter(el => el.checkVisibility());
        const header = [...document.querySelectorAll('#auth-loading .page-header, #app-header, [data-loading-cover]')].find(el => el.checkVisibility());
        const nav = [...document.querySelectorAll('#auth-loading .bottom-nav, #bottom-nav')].find(el => el.checkVisibility());
        return {
          count: visible.length,
          animated: visible.some(el => getComputedStyle(el, '::after').animationName === 'qcu-shimmer'),
          header: header?.getBoundingClientRect().height,
          nav: nav?.getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth > innerWidth,
          // Include individual shapes: overflow-x:hidden must not mask clipped skeletons.
          clipped: visible.some(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; })
        };
      });
      assert(state.count > 5, `${name} at ${width}: missing placeholders`);
      assert(state.animated, `${name} at ${width}: static loading state`);
      assert(state.header > 0, `${name} at ${width}: header collapsed`);
      if (state.nav !== undefined) assert(state.nav >= 50, `${name} at ${width}: navigation collapsed`);
      assert(!state.overflow && !state.clipped, `${name} at ${width}: overflow ${JSON.stringify(state)}`);
      if (name === 'schedule') {
        const rows = await page.locator('#schedule-rows').evaluate(body => ({
          width: body.getBoundingClientRect().width,
          rows: [...body.rows].map(row => row.getBoundingClientRect().width),
          bars: [...body.querySelectorAll('.skeleton-pulse')].map(bar => bar.getBoundingClientRect().width)
        }));
        assert(rows.rows.every(row => row >= rows.width - 2), `Schedule at ${width}: collapsed placeholder rows`);
        assert(rows.bars.every(bar => bar >= 12), `Schedule at ${width}: collapsed placeholder bars`);
      }
      if ([390,1440].includes(width) && ['index','schedule','onboarding','admin'].includes(name)) await page.screenshot({ path: resolve(output, `${name}-${width}.png`) });
      release();
      await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
      if (name === 'index') await page.waitForFunction(() => getComputedStyle(document.getElementById('auth-loading')).display === 'none');
      if (name === 'admin' && width === 390) await checkAdminDetails(page);
      assert.deepEqual(errors, [], `${name} at ${width}: runtime errors`);
      await context.close();
    }
    console.log(`PASS all 10 loading pages at ${width}px: animated, contained, and cleared after response`);
  }
  const context = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) { await gate; return route.fulfill({ status: 503, json: { error: 'Unavailable' } }); }
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${origin}/today.html`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('.loading-brand-title').evaluate(el => getComputedStyle(el,'::after').animationName), 'none');
  release();
  await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
  assert.match(await page.locator('#load-notice-dashboard').innerText(), /unavailable/i);
  assert.equal(await page.getByRole('button', { name: 'Try again' }).count(), 1);
  // Exercise the actual shared action helper through failure and duplicate clicks.
  const result = await page.evaluate(async () => {
    const button = document.createElement('button'); button.className = 'btn btn-primary'; button.textContent = 'Save changes'; document.body.append(button);
    const width = button.getBoundingClientRect().width;
    let unblock, calls = 0;
    const gate = new Promise(resolve => { unblock = resolve; });
    const action = window.QCULoading.action(button, async () => { calls++; await gate; throw Error('Test failure'); }).catch(() => {});
    const busy = button.disabled && button.getAttribute('aria-busy') === 'true';
    const sameWidth = width === button.getBoundingClientRect().width;
    await window.QCULoading.action(button, () => calls++);
    unblock(); await action;
    const clean = !button.disabled && !button.hasAttribute('aria-busy') && !button.classList.contains('btn-spinner') && button.textContent === 'Save changes';
    button.remove();
    return { busy, sameWidth, clean, calls };
  });
  assert.deepEqual(result, { busy: true, sameWidth: true, clean: true, calls: 1 });
  await context.close();
  console.log('PASS reduced motion, failed request recovery, stable button size, duplicate-action prevention, and spinner cleanup');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
