// Real admin UI -> real Functions handlers -> the actual Apps Script in an
// in-memory Sheets/Drive emulator. No production accounts are changed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { loadAppsScript, parseOutput } from './_apps-script-emulator.mjs';
import { platformSessionHeader } from '../functions/api/auth/_lib.js';
import { callAction } from '../functions/api/repo/sheets-adapter.js';
import { onRequestGet, onRequestPost } from '../functions/api/admin/users.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';

const root = resolve('.');
const env = { APPS_SCRIPT_URL: 'https://sheets.test/', APPS_SCRIPT_SECRET: 'admin-browser-signing-secret', GOOGLE_SESSION_SECRET: 'admin-browser-session-secret' };
const admin = { googleSub: 'test-admin', email: 'myscheduleqcu@gmail.com', emailVerified: true, issuedAt: Date.now() };
const student = { googleSub: 'test-student', email: 'student@example.test', emailVerified: true, issuedAt: Date.now() };
const gs = await loadAppsScript({ repoRoot: root, secret: env.APPS_SCRIPT_SECRET });
gs.setupDatabase();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), env.APPS_SCRIPT_URL, 'Only synthetic Apps Script requests are allowed');
  return new Response(JSON.stringify(parseOutput(gs.doPost({ postData: { contents: init.body } }))));
};
for (const [actor, name] of [[admin, 'Administrator'], [student, 'Zoë Niño & 李']]) {
  await callAction(env, 'batch.write', actor, { ops: [{ kind: 'users', id: 'user_' + actor.googleSub, row: { email: actor.email, displayName: name } }] });
}
for (let i = 0; i < 26; i++) {
  const actor = { googleSub: 'fixture-' + i, email: `fixture-${i}@example.test` };
  await callAction(env, 'batch.write', actor, { ops: [{ kind: 'users', id: 'user_' + actor.googleSub, row: { email: actor.email, displayName: 'Fixture ' + i } }] });
}
const posts = [];
let dropMutationResponse = false, failNextList = false, heldRead = null;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/admin/users') {
      const buffers = [];
      for await (const chunk of request) buffers.push(chunk);
      const body = request.method === 'POST' ? Buffer.concat(buffers) : undefined;
      if (body) posts.push(JSON.parse(body.toString()));
      if (request.method === 'GET' && !url.searchParams.has('userId')) {
        if (heldRead) { const pending = heldRead; heldRead = null; pending.started(); await pending.gate; }
        if (failNextList) { failNextList = false; response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', error: 'Directory temporarily unavailable' })); return; }
      }
      const webRequest = new Request(`http://${request.headers.host}${request.url}`, { method: request.method, headers: request.headers, body });
      const context = { env, request: webRequest };
      const result = await middleware({ ...context, next: () => request.method === 'POST' ? onRequestPost(context) : onRequestGet(context) });
      response.statusCode = result.status;
      for (const [key, value] of result.headers) if (key !== 'set-cookie') response.setHeader(key, value);
      if (result.headers.getSetCookie().length) response.setHeader('Set-Cookie', result.headers.getSetCookie());
      response.end(await result.text());
      return;
    }
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + sep) || !(url.pathname === '/admin.html' || url.pathname.startsWith('/assets/'))) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch (error) { response.writeHead(500).end(String(error)); }
});
let browser;
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = resolve(tmpdir(), 'qcu-admin-checks');
await mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== origin) return route.abort();
    if (dropMutationResponse && route.request().method() === 'POST') {
      const result = await route.fetch();
      if (result.ok()) { dropMutationResponse = false; return route.abort('failed'); }
      return route.fulfill({ response: result });
    }
    return route.continue();
  });
  const cookie = (await platformSessionHeader({ env, request: new Request(origin) }, admin)).split(';')[0];
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/admin.html');
  await page.waitForFunction(() => document.getElementById('results').textContent === '28 matching accounts');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('page').textContent === 'Page 2');
  assert.equal(await page.locator('#users tr').count(), 3);
  await page.getByRole('searchbox').fill('Niño');
  await page.waitForFunction(() => document.getElementById('results').textContent === '1 matching accounts');
  assert.match(await page.locator('#users').innerText(), /Zoë Niño & 李/);

  async function openStudent() {
    await page.getByRole('button', { name: 'View Zoë Niño & 李', exact: true }).click();
    await page.locator('#details').waitFor({ state: 'visible' });
  }
  async function fillAction(operation) {
    await page.locator('#operation').selectOption(operation);
    await page.locator('#reason').fill('Verified admin workflow');
    if (operation === 'purge') await page.locator('#confirm').fill('user_test-student');
    await page.locator('#ack').check();
  }
  async function waitState(status) {
    await page.locator('#details').waitFor({ state: 'hidden' });
    await page.waitForFunction(status => document.querySelector('#users .badge')?.textContent === status, status);
  }

  await openStudent();
  assert.equal(await page.locator('#operation option[value="reactivate"]').getAttribute('disabled'), '', await page.locator('#operation').evaluate(el => el.outerHTML));
  await fillAction('suspend');
  await context.clearCookies({ name: 'qcu_csrf' });
  await page.locator('#apply').click();
  await waitState('SUSPENDED');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].mutationId, posts[1].mutationId, 'Expired-token recovery must retain the same action ID');
  assert.match(await page.locator('#account-result').innerText(), /suspended/);
  console.log('PASS pagination, Unicode search, valid actions, expired-token recovery, and suspension through the real API');

  await openStudent();
  assert.equal(await page.locator('#operation option[value="suspend"]').getAttribute('disabled'), '');
  await fillAction('reactivate');
  dropMutationResponse = true;
  const initial = (await callAction(env, 'admin.user.read', admin, { userId: 'user_test-student' })).user.version;
  await page.locator('#apply').click();
  await page.waitForFunction(() => document.getElementById('action-message').textContent.includes('did not confirm'));
  assert(await page.locator('#apply').isEnabled());
  const lost = posts.at(-1).mutationId;
  await page.locator('#apply').click();
  await waitState('ACTIVE');
  assert.equal(posts.at(-1).mutationId, lost);
  assert.equal((await callAction(env, 'admin.user.read', admin, { userId: 'user_test-student' })).user.version, initial + 1);
  console.log('PASS lost mutation response retries the saved result without repeating the account change');

  await openStudent();
  await fillAction('close');
  failNextList = true;
  await page.locator('#apply').click();
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('Directory temporarily unavailable'));
  assert.match(await page.locator('#account-result').innerText(), /closed/);
  await page.getByRole('button', { name: 'Refresh data' }).click();
  await waitState('CLOSED');
  await openStudent();
  await fillAction('purge');
  await page.screenshot({ path: resolve(output, 'delete-confirmation.png') });
  await page.locator('#apply').click();
  await page.waitForFunction(() => document.getElementById('results').textContent === '0 matching accounts');
  assert.match(await page.locator('#account-result').innerText(), /Account deleted/);
  await page.getByRole('searchbox').fill('');
  await page.locator('select[name="status"]').selectOption('DELETED');
  await page.waitForFunction(() => document.getElementById('results').textContent === '1 matching accounts');
  assert.match(await page.locator('#users').innerText(), /DELETED/);
  await page.getByRole('button', { name: 'View user_test-student', exact: true }).click();
  await page.locator('#details').waitFor({ state: 'visible' });
  assert(await page.locator('#action-form').isHidden());
  await page.locator('#close-dialog').click();
  console.log('PASS closure, separate save/refresh outcomes, permanent deletion, and read-only deleted identities');

  // A filter change arriving during a slow directory request must not disappear.
  let release, started;
  const requested = new Promise(resolve => { started = resolve; });
  heldRead = { started, gate: new Promise(resolve => { release = resolve; }) };
  await page.getByRole('button', { name: 'Refresh data' }).click();
  await requested;
  await page.getByRole('searchbox').fill('Nobody matches');
  // Wait for the UI's debounce before releasing the in-flight request.
  await new Promise(resolve => setTimeout(resolve, 450));
  release();
  await page.waitForFunction(() => document.getElementById('results').textContent === '0 matching accounts');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'admin-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('PASS queued filters and browser runtime checks');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
