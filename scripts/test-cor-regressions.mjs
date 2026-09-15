// Offline regression tests. No real accounts, files, or external services.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { platformSessionHeader } from '../functions/api/auth/_lib.js';
import { Users, CorRecords, CorDrafts, Concurrency } from '../functions/api/repo/index.js';
import { onRequestPost as upload } from '../functions/api/v1/cor/upload.js';
import { onRequestPost as processCor } from '../functions/api/v1/cor/process.js';
import { onRequestPost as review } from '../functions/api/v1/cor/review.js';
import { onRequestGet as statusGet } from '../functions/api/v1/cor/status.js';

const source = readFileSync(new URL('../assets/js/onboarding.js', import.meta.url), 'utf8');
const draft = { studentInfo: { firstName: { value: 'Test' }, lastName: { value: 'Student' }, studentNumber: { value: '123' } }, enrollmentInfo: { program: 'BSCS', yearLevel: 1, term: 'First' }, subjects: [{ subjectCode: 'CS101', subjectName: 'Computing', units: 3, schedule: [] }] };
function element() {
  const classes = new Set();
  const attributes = new Map();
  let value = '';
  return { get value() { return value; }, set value(v) { value = String(v); }, disabled: false, hidden: false, style: {}, textContent: '', innerHTML: '', children: [], events: {},
    classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x, b) => b ? classes.add(x) : classes.delete(x) },
    addEventListener(name, fn) { this.events[name] = fn; }, querySelectorAll() { return []; }, querySelector() { return element(); },
    getAttribute(name) { return attributes.get(name) ?? null; }, setAttribute(name,value) { attributes.set(name,value); }, removeAttribute(name) { attributes.delete(name); }, hasAttribute(name) { return attributes.has(name); },
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } };
}
async function harness(uploadResult, stage = 'WELCOME', overrides = {}) {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const steps = ['welcome', 'upload', 'processing', 'review', 'confirm', 'success'].map(x => get('step-' + x));
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const c = { console, crypto: globalThis.crypto, FormData: class { append() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById: get, querySelectorAll: selector => selector.includes('data-loading-') ? [] : steps, createElement: element },
    addEventListener() {},
    location: {}, scrollTo() {}, setTimeout() {}, clearInterval: id => timers.delete(id), setInterval: fn => { timers.set(++timerId, fn); return timerId; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      let data;
      if (overrides[url]) { data = overrides[url]; if (data instanceof Error) throw data; }
      else if (url.includes('/status?requestId=')) data = overrides['/api/v1/cor/status'] || { status:'OK', hasImport:false };
      else if (url.endsWith('/session')) data = { status: 'OK', user: { userId: 'test', name: 'Test' } };
      else if (url.endsWith('/onboarding/status')) data = { status: 'OK', stage, corRecordId: 'cor-test' };
      else if (url.endsWith('/upload')) data = uploadResult;
      else if (url.endsWith('/result')) data = { status: 'OK', hasResult: true, result: draft };
      else if (url.endsWith('/status')) data = { status: 'OK', importStatus: 'PROCESSING' };
      else if (url.endsWith('/review')) data = { status: 'OK' };
      else if (url.endsWith('/confirm')) data = { status: 'ERROR', error: 'Please correct your schedule.' };
      else throw Error('Unexpected request: ' + url);
      return { json: async () => data };
    } };
  c.window = c;
  vm.runInNewContext(readFileSync(new URL('../assets/js/loading.js',import.meta.url),'utf8'),c);
  vm.runInNewContext(source, c);
  await new Promise(setImmediate);
  get('file-input').files = [{ name: 'cor.pdf', type: 'application/pdf', size: 12 }];
  get('file-input').events.change();
  return { c, get, calls, timers };
}

const extracted = await harness({ status: 'EXTRACTED', corRecordId: 'cor-test', result: draft });
await extracted.c.uploadCor();
assert(extracted.get('step-review').classList.contains('active'));
assert(!extracted.calls.some(x => x.url.endsWith('/process')));
assert.equal(extracted.get('review-program').value, 'BSCS');
extracted.get('review-firstName').value = '';
await extracted.c.saveAndConfirm();
assert.equal(extracted.get('review-save-btn').disabled, false);
extracted.get('review-firstName').value = 'Corrected';
extracted.get('review-program').value = 'BSCS';
await extracted.c.saveAndConfirm();
assert(extracted.get('step-confirm').classList.contains('active'));
await extracted.c.confirmAndActivate();
assert(extracted.get('confirm-error').classList.contains('visible'));
assert.equal(JSON.parse(extracted.calls.find(x => x.url.endsWith('/confirm')).options.body).draft.studentInfo.firstName.value, 'Corrected');
console.log('PASS extracted upload, compact program, validation retry, reviewed draft handoff, visible confirmation errors');

const duplicate = await harness({ status: 'DUPLICATE', corRecordId: 'cor-test', importStatus: 'REVIEW_REQUIRED' });
await duplicate.c.uploadCor();
assert(duplicate.get('step-review').classList.contains('active'));
assert(!duplicate.calls.some(x => x.url.endsWith('/process')));
console.log('PASS duplicate upload resumes review');

for (const uploadFailure of [new Error('Connection lost after save'), {status:'SERVICE_UNAVAILABLE'}]) {
  const recovered = await harness({}, 'WELCOME', {
    '/api/v1/cor/upload': uploadFailure,
    '/api/v1/cor/status': {status:'OK', hasImport:true, corRecordId:'cor-test', importStatus:'REVIEW_REQUIRED'},
  });
  await recovered.c.uploadCor();
  assert(recovered.get('step-review').classList.contains('active'));
  assert(!recovered.get('upload-error').classList.contains('visible'));
  assert(recovered.calls.some(call => call.url.includes('/status?requestId=')));
}
const lostConfirmation = await harness({status:'EXTRACTED',corRecordId:'cor-test',result:draft}, 'WELCOME', {
  '/api/v1/cor/confirm':new Error('Response lost'),
});
await lostConfirmation.c.uploadCor();
await lostConfirmation.c.saveAndConfirm();
await lostConfirmation.c.confirmAndActivate();
// A lost confirm response must NOT silently assume success or bounce the user
// back to review: they stay on confirm with the draft kept and a retry shown.
assert(lostConfirmation.get('step-confirm').classList.contains('active'));
assert(lostConfirmation.get('confirm-error').classList.contains('visible'));
console.log('PASS lost confirmation response keeps the user on confirm with their draft intact');

const completed = await harness({ status: 'DUPLICATE', corRecordId: 'cor-test', importStatus: 'COMPLETE' });
await completed.c.uploadCor();
assert(completed.get('step-success').classList.contains('active'));
assert.equal(completed.timers.size, 0);
const retryUpload = await harness({ status: 'SERVICE_UNAVAILABLE' });
await retryUpload.c.uploadCor();
await retryUpload.c.uploadCor();
const requestIds = retryUpload.calls.filter(x => x.url.endsWith('/upload')).map(x => x.options.headers['X-Request-ID']);
assert.match(requestIds[0], /^[a-zA-Z0-9_-]{16,100}$/);
assert.equal(requestIds[0], requestIds[1]);
const busy = await harness({ status: 'ACCEPTED', corRecordId: 'cor-test' }, 'WELCOME', {
  '/api/v1/cor/process': { status: 'RATE_LIMITED', retryAfter: 30 },
});
await busy.c.uploadCor();
assert(busy.get('step-processing').classList.contains('active'));
assert.equal(busy.get('upload-btn').disabled, true);
assert.match(busy.get('processing-message').textContent, /30s/);
const expired = await harness({}, 'PROCESSING', {
  '/api/v1/cor/status': { status: 'OK', corRecordId: 'cor-test', importStatus: 'PROCESSING', canResume: true },
  '/api/v1/cor/process': { status: 'REVIEW_REQUIRED', result: draft },
});
assert(expired.get('step-review').classList.contains('active'));
assert.equal(expired.calls.filter(x => x.url.endsWith('/process')).length, 1);
console.log('PASS stable upload IDs, completed duplicates, busy scans, and expired lease recovery');

const pending = await harness({}, 'PROCESSING');
for (let i = 0; i < 61; i++) { for (const fn of [...pending.timers.values()]) await fn(); }
assert(pending.get('step-processing').classList.contains('active'));
assert.equal(pending.get('processing-retry').hidden, false);
assert.equal(pending.timers.size, 0);
console.log('PASS timeout stays on processing with explicit retry');

const env = { GOOGLE_SESSION_SECRET: 'offline-cor-regression-test-secret' };
const user = Users.adopt({ userId: 'regression-user', googleSub: 'regression-sub', state: 'ONBOARDING' });
const context = async (path, body) => {
  const cookie = (await platformSessionHeader({ env, request: new Request('http://127.0.0.1') }, { ...user, ts: Date.now() })).split(';')[0];
  return { env, request: new Request('http://127.0.0.1' + path, { method: 'POST', headers: { Cookie: cookie }, body: body instanceof FormData ? body : JSON.stringify(body || {}) }) };
};
const record = CorRecords.create({ ownerUserId: user.userId, status: 'ACCEPTED', filename: 'missing.pdf' });
Users.update(user, { corRecordId: record.id });
const failed = await processCor(await context('/api/v1/cor/process'));
assert.equal(failed.status, 422);
assert.equal(Concurrency.getDuplicateCorRecord(user.userId), null);
console.log('PASS missing file releases active import');
const form = new FormData();
form.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'cor.pdf');
const unavailable = await upload(await context('/api/v1/cor/upload', form));
assert.equal(unavailable.status, 503);
assert.equal(Concurrency.getDuplicateCorRecord(user.userId), null);
console.log('PASS missing extraction configuration does not create active import');
const originalFetch = globalThis.fetch;
env.GEMINI_API_KEY = 'test-key';
globalThis.fetch = async () => new Response('Synthetic provider failure', { status: 503 });
try {
  const extractionFailure = await upload(await context('/api/v1/cor/upload', form));
  assert.equal(extractionFailure.status, 502);
  assert.equal(Concurrency.getDuplicateCorRecord(user.userId), null);
  assert.equal(user.corRecordId, record.id);
} finally { globalThis.fetch = originalFetch; delete env.GEMINI_API_KEY; }
console.log('PASS extraction failure releases import and restores prior user state');
const reviewRecord = CorRecords.create({ ownerUserId: user.userId, status: 'REVIEW_REQUIRED' });
Users.update(user, { corRecordId: reviewRecord.id });
// A stale/unknown client requestId must not hide the user's live import:
// status falls back to the active record so recovery can proceed.
const staleIdStatus = await statusGet({ env, request: new Request('http://127.0.0.1/api/v1/cor/status?requestId=unknown-stale-id-1234', { headers: { Cookie: (await platformSessionHeader({ env, request: new Request('http://127.0.0.1') }, { ...user, ts: Date.now() })).split(';')[0] } }) });
assert.equal(staleIdStatus.status, 200);
assert.equal((await staleIdStatus.json()).corRecordId, reviewRecord.id);
console.log('PASS unknown requestId falls back to the active import');
CorDrafts.set(reviewRecord.id, draft);
const invalid = await review(await context('/api/v1/cor/review', { ...draft, studentInfo: { ...draft.studentInfo, firstName: { value: '' } } }));
assert.equal(invalid.status, 400);
console.log('PASS API rejects empty wrapped required fields');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const authScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
for (const query of ['', '?auth=dashboard', '?auth=unexpected']) {
  const nodes = new Map(['auth-landing', 'auth-dashboard', 'auth-loading'].map(id => [id, element()]));
  const c = { URLSearchParams, AbortSignal, addEventListener() {}, fetch: async () => ({ json: async () => ({ authenticated: false }) }), document: { readyState: 'complete', querySelectorAll: () => [], getElementById: id => nodes.get(id) }, location: { search: query }, history: { replaceState() {} } };
  c.window = c;
  vm.runInNewContext(authScript, c);
  await new Promise(setImmediate);
  assert.equal(nodes.get('auth-dashboard').style.display, 'none');
  assert.equal(nodes.get('auth-landing').style.display, 'block');
}
console.log('PASS logged-out and unknown auth query routing');

// Verify real markup containment, including content that previously escaped
// the hidden dashboard because of an extra closing div.
const stack = [];
const voids = new Set(['meta', 'link', 'img', 'input', 'br', 'hr', 'source', 'area', 'base', 'embed', 'param', 'track', 'wbr']);
const markup = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
for (const match of markup.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
  const [, closing, rawTag, attributes] = match;
  const tag = rawTag.toLowerCase();
  if (voids.has(tag) || /\/\s*$/.test(attributes)) continue;
  if (closing) assert.equal(stack.pop()?.tag, tag, `Invalid nesting at ${match[0]}`);
  else {
    if (/id="(?:today-grid|home-week-strip|bottom-nav)"/.test(attributes)) assert(stack.some(x => x.id === 'auth-dashboard'));
    if (/class="home-hero-seal"/.test(attributes)) assert.equal(stack.at(-1)?.tag, 'section');
    stack.push({ tag, id: attributes.match(/\bid="([^"]+)"/)?.[1] });
  }
}
assert.equal(stack.length, 0);
console.log('PASS Home HTML nesting and dashboard containment');

const workerSource = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
const handlers = {};
let networkResponse = new Response(JSON.stringify({ status: 'UNAUTHORIZED' }), { status: 401 });
vm.runInNewContext(workerSource, { URL, Response, self: { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => { handlers[name] = fn; } }, fetch: async () => { if (!networkResponse) throw Error('Offline'); return networkResponse; } });
let reply;
const apiEvent = { request: new Request('https://example.test/api/v1/cor/status'), respondWith: promise => { reply = promise; } };
handlers.fetch(apiEvent);
assert.equal((await reply).status, 401);
networkResponse = null;
handlers.fetch(apiEvent);
const offline = await reply;
assert.equal(offline.status, 503);
assert.equal((await offline.json()).status, 'OFFLINE');
console.log('PASS service worker preserves API failures and returns JSON offline');
networkResponse = new Response('Missing page', {status:404});
handlers.fetch({request:new Request('https://example.test/missing'),respondWith:promise=>{reply=promise;}});
assert.equal((await reply).status,404);
console.log('PASS service worker never replaces a network 404 with cached content');
