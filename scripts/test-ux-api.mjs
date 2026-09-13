// Real Functions and Apps Script with synthetic Sheets/Drive; no live records.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadAppsScript, parseOutput } from './_apps-script-emulator.mjs';
import { platformSessionHeader } from '../functions/api/auth/_lib.js';
import { callAction } from '../functions/api/repo/sheets-adapter.js';
import { onRequestPost as upload } from '../functions/api/v1/cor/upload.js';
import { onRequestPost as cancel } from '../functions/api/v1/cor/cancel.js';
import { onRequestGet as session } from '../functions/api/auth/session.js';
import { onRequestGet as bootstrap } from '../functions/api/v1/bootstrap.js';
import { onRequest as api } from '../functions/api/_middleware.js';
import { onRequest as page } from '../functions/_middleware.js';

const env = { APPS_SCRIPT_URL: 'https://sheets.test/', APPS_SCRIPT_SECRET: 'ux-api-signing-secret-not-production', GOOGLE_SESSION_SECRET: 'ux-api-session-secret-not-production', GEMINI_API_KEY: 'synthetic' };
const actor = { googleSub: 'ux-student', email: 'ux@example.test', issuedAt: Date.now() };
const gs = await loadAppsScript({ repoRoot: resolve('.'), secret: env.APPS_SCRIPT_SECRET });
gs.setupDatabase();
const originalFetch = globalThis.fetch;
const actions = [];
let failBackend = false;
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), env.APPS_SCRIPT_URL);
  if (failBackend) throw Error('Synthetic private infrastructure detail');
  actions.push(JSON.parse(JSON.parse(init.body).canonical));
  const result = parseOutput(gs.doPost({ postData: { contents: init.body } }));
  if (!result.ok) console.log('Synthetic backend failure:', result.error);
  return Response.json(result);
};
try {
  await callAction(env, 'batch.write', actor, { ops: [{ kind: 'users', id: 'user_ux-student', row: { email: actor.email, displayName: 'Niño & 李', onboardingState: 'AUTHENTICATED' } }] });
  const origin = 'https://portal.test';
  const cookie = (await platformSessionHeader({ env, request: new Request(origin) }, actor)).split(';')[0];
  const context = (path, body, headers = {}) => ({ env, request: new Request(origin + path, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: origin, ...headers }, body }) });
  const form = (filename, type, contents) => {
    const data = new FormData();
    data.append('file', new Blob([contents], { type }), filename);
    return data;
  };
  for (const [filename, type, bytes, expected] of [
    ['COR Niño.PDF', '', '%PDF-1.4 synthetic', 201],
    ['cor.pdf', 'application/octet-stream', '%PDF-1.4 synthetic', 200],
    ['cor.pdf', 'image/png', '%PDF-1.4 synthetic', 400],
    ['cor.pdf', '', '<script>invalid</script>', 400],
    ['cor.pdf', 'application/pdf', '', 400],
    ['cor.txt', 'application/pdf', '%PDF-1.4', 400],
  ]) {
    const result = await upload(context('/api/v1/cor/upload', form(filename, type, bytes), { 'X-Request-ID': 'ux-upload-id-00000001' }));
    assert.equal(result.status, expected, `${filename} (${type}): ${await result.text()}`);
  }
  const start = actions.find(action => action.action === 'cor.start');
  assert.equal(start.payload.mimeType, 'application/pdf');
  const malformed = await upload(context('/api/v1/cor/upload', 'invalid multipart', { 'Content-Type': 'multipart/form-data' }));
  assert.equal(malformed.status, 400);
  const multiple = form('a.pdf', 'application/pdf', '%PDF-1.4');
  multiple.append('file', new Blob(['%PDF-1.4']), 'b.pdf');
  assert.equal((await upload(context('/api/v1/cor/upload', multiple))).status, 400);
  const oversized = await upload(context('/api/v1/cor/upload', 'small body', { 'Content-Length': String(11 * 1024 * 1024) }));
  assert.equal(oversized.status, 413);
  console.log('PASS generic/missing MIME, canonical stored MIME, signatures, empty files, malformed multipart, multiple files, size limit');

  await callAction(env, 'batch.write', actor, { ops: [{ kind: 'schedules', id: 'existing-confirmed-schedule', row: { name: 'Existing schedule', status: 'ACTIVE' } }] });
  const snapshot = await callAction(env, 'snapshot.read', actor);
  assert.equal(snapshot.entities.schedules.length, 1);
  const savedCor = gs.spreadsheet.getSheetByName('COR_Records');
  const corRows = savedCor.getDataRange().getValues();
  const idIndex = corRows[0].indexOf('corRecordId');
  const stateIndex = corRows[0].indexOf('status');
  const corId = corRows[1][idIndex];
  const cancelContext = () => context('/api/v1/cor/cancel', JSON.stringify({ corRecordId: corId }), { 'Content-Type': 'application/json' });
  assert.equal((await cancel(cancelContext())).status, 409, 'A processing upload cannot be replaced');
  const claim = await callAction(env, 'cor.claim', actor, { corRecordId: corId });
  await callAction(env, 'cor.finish', actor, { corRecordId: corId, leaseToken: claim.leaseToken, draft: { subjects: [] } });
  assert.equal((await cancel(cancelContext())).status, 200);
  assert.equal((await cancel(cancelContext())).status, 200, 'Lost-response retries are idempotent');
  const next = await upload(context('/api/v1/cor/upload', form('new.pdf', '', '%PDF-1.4 synthetic'), { 'X-Request-ID': 'ux-upload-id-00000002' }));
  assert.equal(next.status, 201, 'A replacement may use the same file content after closing its old draft');
  assert.notEqual((await next.json()).corRecordId, corId);
  assert.deepEqual((await callAction(env, 'snapshot.read', actor)).entities.schedules, snapshot.entities.schedules, 'Draft replacement leaves confirmed schedules unchanged');
  savedCor.getRange(2, stateIndex + 1).setValue('COMPLETE');
  assert.equal((await cancel(cancelContext())).status, 409, 'A completed COR cannot be cancelled');
  console.log('PASS draft replacement, idempotent cancellation, new scan admission and completed-import protection');

  for (const handler of [session, bootstrap]) {
    assert.equal((await handler(context('/api/auth/session'))).status, 200);
    failBackend = true;
    const result = await handler(context('/api/auth/session'));
    assert.equal(result.status, 503);
    const body = await result.json();
    assert.equal(body.status, 'SERVICE_UNAVAILABLE');
    assert.equal(body.authenticated, undefined, 'A service failure is not an authentication verdict');
    failBackend = false;
  }
  console.log('PASS session and bootstrap outages stay recoverable without false logout');

  const apiContext = context('/api/v1/missing');
  const resourceError = { status: 'NOT_FOUND', error: 'This saved COR is no longer available.', resource: 'cor' };
  let result = await api({ ...apiContext, next: () => Response.json(resourceError, { status: 404 }) });
  assert.equal(result.status, 404);
  assert.deepEqual(await result.json(), resourceError);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  result = await api({ ...apiContext, next: () => new Response('<h1>Not found</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } }) });
  assert.equal(result.status, 404);
  assert.equal((await result.json()).status, 'NOT_FOUND');
  const throws = () => { throw Error('private exception details'); };
  result = await api({ ...apiContext, next: throws });
  assert.equal(result.status, 503);
  assert(!JSON.stringify(await result.json()).includes('private exception'));
  for (const [path, type] of [['/schedule.html', 'text/html'], ['/api/unexpected', 'application/json'], ['/assets/app.js', 'text/plain']]) {
    result = await page({ ...context(path), next: throws });
    assert.equal(result.status, 503);
    assert(result.headers.get('Content-Type').includes(type));
    assert(!(await result.text()).includes('private exception'));
  }
  console.log('PASS resource 404 details, missing endpoint JSON, page/API/asset exceptions and private error redaction');
} finally { globalThis.fetch = originalFetch; }

const handlers = {};
vm.runInNewContext(readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8'), {
  URL, Response,
  self: { location: { origin: 'https://portal.test' }, addEventListener: (event, handler) => { handlers[event] = handler; } },
  fetch: async () => { throw Error('Offline'); },
  caches: { match: async key => key === 'offline.html' ? new Response('<h1>Check your connection</h1>') : undefined },
});
let offlineResponse;
handlers.fetch({ request: { url: 'https://portal.test/nested/uncached', method: 'GET', mode: 'navigate' }, respondWith: pending => { offlineResponse = pending; } });
const offline = await offlineResponse;
assert.equal(offline.status, 503);
assert.match(offline.headers.get('Content-Type'), /text\/html/);
assert.match(await offline.text(), /Check your connection/);
console.log('PASS offline navigation returns the recovery page with HTTP 503');
