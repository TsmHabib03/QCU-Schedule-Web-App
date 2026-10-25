// Synthetic accounts and intercepted APIs: no real Google authorization or data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { onRequestGet as connect } from '../functions/api/google/connect.js';
import { onRequestGet as callback } from '../functions/api/google/callback.js';
import { onRequestPost as preferences } from '../functions/api/google/preferences.js';
import { safeReturnTo, readOauthState, readSession, CLASSROOM_SCOPES, GMAIL_SCOPE } from '../functions/api/google/_lib.js';

const root = resolve('.');
const output = resolve(tmpdir(), 'qcu-google-connection');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root + sep)) return response.writeHead(403).end();
  try { response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const dashboard = { status: 'OK', profile: { name: 'Test Student', googleAccount: { name: 'Google Student', email: 'student@example.test', emailVerified: true } }, academic: { program: { abbrev: 'BSIT' }, campus: { shortName: 'San Bartolome' } }, entries: [{ entryId: 'c1', day: 'Monday', title: 'Programming', start: '08:00', end: '10:00', code: 'CC102' }], tasks: [], notes: [], buildings: [] };
const connection = () => ({ connected: true, email: 'student@example.test', preferences: { classroom: true, gmail: false, autoRefresh: true }, permissions: { classroom: true, gmail: false } });
const feed = [{ id: 'a1', type: 'assignment', source: 'classroom', title: 'Programming exercise', courseName: 'Programming', postedAt: '2026-10-23T08:00:00Z', link: 'https://classroom.google.com/test' }];
let mode = 'disconnected', prefFailure = false, disconnectFailure = false, prefDelay = false;
let savedPrefs, oauthRequest;
const errors = [];
let browser;
async function contextFor(viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/dashboard')) return route.fulfill({ json: dashboard });
    if (url.pathname.endsWith('/bootstrap')) return route.fulfill({ json: { authenticated: true, routing: 'dashboard' } });
    if (url.pathname === '/api/google/status') {
      if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Service unavailable' } });
      return route.fulfill({ json: mode === 'unconfigured' ? { connected: false, status: 'unconfigured', missing: ['GOOGLE_CLIENT_ID'] } : mode === 'connected' || mode === 'renewal' ? connection() : { connected: false, status: 'not_connected' } });
    }
    if (url.pathname === '/api/google/updates') return route.fulfill(mode === 'renewal' ? { status: 401, json: { status: 'REAUTHORIZE', error: 'Renew authorization' } } : { json: { updates: feed, checkedAt: new Date().toISOString() } });
    if (url.pathname === '/api/google/preferences') {
      savedPrefs = route.request().postDataJSON();
      if (prefDelay) await new Promise(done => setTimeout(done, 250));
      return route.fulfill(prefFailure ? { status: 503, json: { error: 'Preference save failed' } } : { json: { connected: true, preferences: savedPrefs } });
    }
    if (url.pathname === '/api/google/disconnect') {
      if (!disconnectFailure) mode = 'disconnected';
      return route.fulfill(disconnectFailure ? { status: 503, json: { error: 'Service unavailable' } } : { json: { connected: false } });
    }
    if (url.pathname === '/api/google/connect') {
      oauthRequest = url;
      return route.fulfill({ contentType: 'text/html', body: '<p>Synthetic OAuth destination</p>' });
    }
    return route.fulfill({ json: { status: 'OK', data: [] } });
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return context;
}
async function ready(page, suffix = '/settings.html') {
  const currentDocument = page.url().split('#')[0];
  await page.goto(origin + suffix);
  if (currentDocument === (origin + suffix).split('#')[0]) await page.reload();
  await page.waitForFunction(() => !document.querySelector('[data-loading-cover], [data-loading-region]'));
  await page.waitForFunction(() => document.getElementById('google-account-card')?.getAttribute('aria-busy') === 'false');
}
async function geometry(page) {
  const result = await page.locator('#google-connection').evaluate(modal => {
    const r = modal.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, viewport: innerWidth, height: innerHeight, overflow: modal.scrollWidth > modal.clientWidth + 1, border: getComputedStyle(modal).borderWidth, blur: getComputedStyle(modal, '::backdrop').backdropFilter, logoPaths: modal.querySelectorAll('.google-connection-logo svg path').length };
  });
  assert(result.left >= 15 && result.right <= result.viewport - 15 && result.top >= 15 && result.bottom <= result.height - 15, JSON.stringify(result));
  assert(!result.overflow);
  assert.match(result.blur, /blur/);
  assert.equal(result.logoPaths, 4);
  assert.equal(result.border, '0px');
}
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 320, height: 480 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 568, height: 320 }]) {
    mode = 'disconnected';
    const context = await contextFor(viewport);
    const page = await context.newPage();
    await ready(page);
    assert.equal(await page.locator('#profile-badge-label').textContent(), 'Student account', 'Google login email verification alone does not imply Classroom integration');
    assert.equal(await page.locator('#profile-avatar').evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    await page.locator('#profile-email').click();
    assert(await page.locator('#google-connection').evaluate(el => el.open));
    await geometry(page);
    assert.equal(await page.locator('#google-connection-title').textContent(), 'Connect Google Classroom');
    const action = page.getByRole('link', { name: 'Connect Google Account', exact: true });
    assert.equal(await action.getAttribute('href'), '/api/google/connect?return=settings.html%23google-connection');
    assert.equal(await action.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(17, 17, 17)');
    assert.equal(await page.locator('#google-status-indicator').evaluate(el => el.classList.contains('profile-sr-only')), true);
    for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); assert(await page.locator('#google-connection').evaluate(el => el.contains(document.activeElement)), 'Modal traps focus'); }
    await action.scrollIntoViewIfNeeded();
    if ([390, 1440, 320].includes(viewport.width)) await page.screenshot({ path: resolve(output, `disconnected-${viewport.width}.png`) });
    await page.keyboard.press('Escape');
    assert(await page.locator('#profile-card').evaluate(el => el === document.activeElement));
    await page.keyboard.press('Space');
    assert(await page.locator('#google-connection').evaluate(el => el.open));
    await page.locator('#google-connection-close').click();
    await page.keyboard.press('Enter');
    assert(await page.locator('#google-connection').evaluate(el => el.open));
    await page.mouse.click(2, 2);
    assert(!await page.locator('#google-connection').evaluate(el => el.open));
    await context.close();
    console.log(`PASS connection modal at ${viewport.width}×${viewport.height}`);
  }
  mode = 'connected';
  const context = await contextFor({ width: 390, height: 844 });
  const page = await context.newPage();
  await ready(page, '/settings.html?google=connected#google-connection');
  assert.equal(new URL(page.url()).searchParams.get('google'), null, 'Callback query is consumed');
  assert.equal(await page.locator('#profile-badge-label').textContent(), 'Google Verified');
  const profileRing = await page.locator('#profile-avatar').evaluate(el => getComputedStyle(el).backgroundImage);
  for (const rgb of ['66, 133, 244', '234, 67, 53', '251, 188, 5', '52, 168, 83']) assert(profileRing.includes(rgb), 'Ring contains each Google color');
  await page.locator('[data-google-view="all"]').click();
  assert.equal(await page.locator('.google-update-title').textContent(), feed[0].title);
  await page.locator('#google-update-search').fill('no matching title');
  assert.equal(await page.locator('.google-update-title').count(), 0);
  await page.locator('.google-filter-reset').click();
  assert.equal(await page.locator('.google-update-title').count(), 1);
  await geometry(page);
  await page.locator('#google-connection').evaluate(el => { el.scrollTop = 0; document.activeElement?.blur(); });
  await page.screenshot({ path: resolve(output, 'connected-390.png') });
  const headerPage = await context.newPage();
  await headerPage.goto(origin + '/schedule.html');
  await headerPage.waitForFunction(() => window.QCUGoogleConnection?.account?.connected);
  assert.equal(await headerPage.locator('#home-avatar').evaluate(el => getComputedStyle(el).backgroundImage), profileRing, 'Profile and global header use identical Google ring');
  await headerPage.evaluate(() => renderShell());
  assert(await headerPage.locator('#home-avatar').evaluate(el => el.classList.contains('google-verified-avatar')), 'Header rebuild preserves state');
  await page.bringToFront();
  prefDelay = true;
  await page.locator('[data-google-pref="autoRefresh"]').uncheck();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => !document.querySelector('[data-google-pref="autoRefresh"]').disabled);
  prefDelay = false;
  assert.equal(savedPrefs.autoRefresh, false);
  assert.equal(await page.locator('[data-google-pref="autoRefresh"]').isChecked(), false);
  prefFailure = true;
  // A failed save immediately rolls back, so check() would retry the click forever.
  await page.locator('[data-google-pref="autoRefresh"]').click();
  await page.waitForFunction(() => document.querySelector('#google-feedback').textContent.includes('Preference save failed'));
  await page.waitForFunction(() => !document.querySelector('[data-google-pref="autoRefresh"]').disabled);
  assert.equal(await page.locator('[data-google-pref="autoRefresh"]').isChecked(), false, 'Failed preference rolls back');
  prefFailure = false;
  disconnectFailure = true;
  await page.locator('[data-google-action="disconnect"]').click();
  await page.locator('.qcu-dialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#google-feedback').textContent.includes('Could not disconnect'));
  assert.equal(await page.locator('#profile-badge-label').textContent(), 'Google Verified', 'Failed disconnect retains confirmed state');
  disconnectFailure = false;
  await page.locator('[data-google-action="disconnect"]').click();
  await page.locator('.qcu-dialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#profile-badge-label').textContent === 'Student account');
  await headerPage.waitForFunction(() => !document.querySelector('#home-avatar').classList.contains('google-verified-avatar'));
  assert.equal(await page.evaluate(() => localStorage.getItem('qcu-google-integration-v1')), null);
  console.log('PASS confirmed state, matching global avatars, updates, preferences, disconnect and cross-tab refresh');
  mode = 'connected';
  await ready(page, '/settings.html#google-connection');
  await page.locator('[data-google-pref="gmail"]').click();
  await page.waitForURL('**/api/google/connect?**');
  assert.equal(oauthRequest.searchParams.get('gmail'), '1');
  assert.equal(oauthRequest.searchParams.get('return'), 'settings.html#google-connection');
  mode = 'renewal';
  await ready(page, '/settings.html#google-connection');
  await page.locator('[data-google-action="refresh"]').click();
  await page.getByRole('link', { name: 'Reconnect Google Account' }).waitFor();
  mode = 'error';
  await ready(page, '/settings.html#google-connection');
  assert.equal(await page.locator('#profile-badge-label').textContent(), 'Student account');
  mode = 'disconnected';
  await page.getByRole('button', { name: 'Retry connection check' }).click();
  await page.getByRole('link', { name: 'Connect Google Account', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Connect Google Account', exact: true }).click();
  await page.waitForURL('**/api/google/connect?**');
  assert.equal(oauthRequest.searchParams.get('return'), 'settings.html#google-connection');
  assert.equal(oauthRequest.searchParams.get('gmail'), null);
  await ready(page, '/settings.html?google=connected');
  assert.equal(await page.locator('#profile-badge-label').textContent(), 'Student account', 'Forged success query never verifies a disconnected account');
  mode = 'unconfigured';
  await ready(page, '/settings.html#google-connection');
  assert.match(await page.locator('#google-feedback').textContent(), /configuration required/);
  await context.close();
  const offlineContext = await contextFor({ width: 320, height: 480 });
  await offlineContext.addInitScript(({ feed }) => {
    window.fixtureOnline = false;
    Object.defineProperty(navigator, 'onLine', { get: () => window.fixtureOnline });
    if (location.protocol !== 'http:') return;
    localStorage.setItem('qcu-google-integration-v1', JSON.stringify({ email: 'student@example.test', preferences: { classroom: true, gmail: false, autoRefresh: true }, permissions: { classroom: true, gmail: false }, updates: feed, checkedAt: new Date().toISOString() }));
  }, { feed });
  const offlinePage = await offlineContext.newPage();
  await ready(offlinePage, '/settings.html#google-connection');
  assert.equal(await offlinePage.locator('#profile-badge-label').textContent(), 'Student account', 'Cached account cannot grant verification');
  assert.equal(await offlinePage.locator('.google-verified-label').textContent(), 'Saved Google account');
  await offlinePage.locator('[data-google-view="all"]').click();
  assert.equal(await offlinePage.locator('.google-update-title').textContent(), feed[0].title);
  assert(await offlinePage.locator('[data-google-pref="classroom"]').isDisabled());
  mode = 'connected';
  await offlinePage.evaluate(() => { window.fixtureOnline = true; window.dispatchEvent(new Event('online')); });
  await offlinePage.waitForFunction(() => document.querySelector('#profile-badge-label').textContent === 'Google Verified');
  assert(!(await offlinePage.locator('[data-google-pref="classroom"]').isDisabled()));
  await geometry(offlinePage);
  await offlineContext.close();
  assert.deepEqual(errors, []);
  console.log('PASS optional Gmail, renewal, retry, OAuth CTA, offline cache and reconnect states');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }

// Exercise the real OAuth Functions against synthetic Google responses.
const oauthOrigin = 'https://portal.test';
const env = { GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', GOOGLE_SESSION_SECRET: 'synthetic-encryption-secret-123456', GOOGLE_PUBLIC_ORIGIN: oauthOrigin };
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0] || '';
const originalFetch = globalThis.fetch;
try {
  assert.equal(safeReturnTo(null), '/settings.html#google-connection');
  assert.equal(safeReturnTo('https://evil.test'), '/settings.html#google-connection');
  const start = await connect({ env, request: new Request(oauthOrigin + '/api/google/connect?return=settings.html%23google-connection') });
  const authUrl = new URL(start.headers.get('Location'));
  assert.equal(authUrl.searchParams.get('redirect_uri'), oauthOrigin + '/api/google/callback');
  assert.deepEqual(authUrl.searchParams.get('scope').split(' '), CLASSROOM_SCOPES);
  const stateContext = { env, request: new Request(oauthOrigin, { headers: { Cookie: cookie(start) } }) };
  assert.equal((await readOauthState(stateContext)).returnTo, '/settings.html#google-connection');
  globalThis.fetch = async url => String(url).includes('/token') ? Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: CLASSROOM_SCOPES.join(' ') }) : Response.json({ email: 'student@example.test' });
  const finish = await callback({ env, request: new Request(oauthOrigin + '/api/google/callback?code=synthetic&state=' + authUrl.searchParams.get('state'), { headers: { Cookie: cookie(start) } }) });
  assert.equal(finish.headers.get('Location'), '/settings.html?google=connected#google-connection');
  const sessionContext = { env, request: new Request(oauthOrigin, { headers: { Cookie: cookie(finish) } }) };
  assert.equal((await readSession(sessionContext)).email, 'student@example.test');
  const prefs = await preferences({ env, request: new Request(oauthOrigin + '/api/google/preferences', { method: 'POST', headers: { Cookie: cookie(finish) }, body: JSON.stringify({ gmail: true }) }) });
  assert.equal(prefs.status, 409);
  assert.equal((await prefs.json()).authorizationUrl, '/api/google/connect?gmail=1&return=settings.html%23google-connection');
  const gmailStart = await connect({ env, request: new Request(oauthOrigin + '/api/google/connect?gmail=1') });
  assert(new URL(gmailStart.headers.get('Location')).searchParams.get('scope').includes(GMAIL_SCOPE));
  const cancel = await callback({ env, request: new Request(oauthOrigin + '/api/google/callback?error=access_denied', { headers: { Cookie: cookie(gmailStart) } }) });
  assert.equal(cancel.headers.get('Location'), '/settings.html?google=gmail_denied#google-connection');
  const invalid = await callback({ env, request: new Request(oauthOrigin + '/api/google/callback?code=bad&state=wrong') });
  assert.equal(invalid.headers.get('Location'), '/settings.html?google=failed#google-connection');
  const missing = await connect({ env: {}, request: new Request(oauthOrigin + '/api/google/connect') });
  assert.match(missing.headers.get('Location'), /^\/settings\.html\?google=unconfigured.*#google-connection$/);
  assert(!((await readFile('service-worker.js', 'utf8')).includes('/google.html')), 'Retired page is absent from the service worker');
  console.log('PASS real OAuth callback, session, optional Gmail and failure destinations');
  console.log('Screenshots: ' + output);
} finally { globalThis.fetch = originalFetch; }
