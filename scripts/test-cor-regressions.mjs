// Offline regression tests. No real accounts, files, or external services.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { platformSessionHeader } from '../functions/api/auth/_lib.js';
import { Users, CorRecords, CorDrafts, Concurrency } from '../functions/api/repo/index.js';
import { onRequestPost as upload } from '../functions/api/v1/cor/upload.js';
import { onRequestPost as processCor } from '../functions/api/v1/cor/process.js';
import { parseDays, geminiResultToDraft } from '../functions/api/v1/cor/_gemini.js';
import { parseDayTokens, parseDayIndexes } from '../functions/api/_lib/day-time.js';
import { onRequestPost as review } from '../functions/api/v1/cor/review.js';
import { onRequestPost as confirmPost } from '../functions/api/v1/cor/confirm.js';
import { onRequestGet as statusGet } from '../functions/api/v1/cor/status.js';
import { Schedules, ScheduleEntries } from '../functions/api/repo/index.js';

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
async function harness(uploadResult, stage = 'WELCOME', overrides = {}, editors = []) {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const steps = ['welcome', 'upload', 'processing', 'review', 'confirm', 'success'].map(x => get('step-' + x));
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const c = { console, crypto: globalThis.crypto, FormData: class { append() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById: get, querySelectorAll: selector => selector.includes('data-meeting') ? editors : (selector.includes('data-loading-') ? [] : steps), createElement: element },
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

// ---------------------------------------------------------------------------
// The day column of a COR must survive every way it is printed.
// ---------------------------------------------------------------------------
// Regression: the day letters used to be chunked two at a time after
// upper-casing, so "MWF" imported as Friday alone, "MW" and "TTh" imported
// nothing, "Th" became Tuesday and "SAT" became Tuesday. A schedule that does
// not match the COR is worse than no schedule at all.
for (const [printed, expected] of [
  ['M', ['MONDAY']],
  ['MW', ['MONDAY', 'WEDNESDAY']],
  ['MWF', ['MONDAY', 'WEDNESDAY', 'FRIDAY']],
  ['M/W/F', ['MONDAY', 'WEDNESDAY', 'FRIDAY']],
  ['M-W-F', ['MONDAY', 'WEDNESDAY', 'FRIDAY']],
  ['TTh', ['TUESDAY', 'THURSDAY']],
  ['TThS', ['TUESDAY', 'THURSDAY', 'SATURDAY']],
  ['MTWThF', ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']],
  ['M-T-W-TH-F', ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']],
  ['MON WED FRI', ['MONDAY', 'WEDNESDAY', 'FRIDAY']],
  ['Mon/Wed', ['MONDAY', 'WEDNESDAY']],
  ['TH', ['THURSDAY']],
  ['Th', ['THURSDAY']],
  ['T', ['TUESDAY']],
  ['SAT', ['SATURDAY']],
  ['Sun', ['SUNDAY']],
  ['S', ['SATURDAY']],
  ['2:30 PM', []],
]) {
  assert.deepEqual(parseDays(printed), expected, `day column "${printed}"`);
}
assert.deepEqual(parseDays('MWF'), parseDays('M/W/F'), 'separators do not change the meaning');
assert.deepEqual(parseDays(''), [], 'empty stays empty');

// And the draft that the review step displays must carry one meeting per day.
const multiDay = geminiResultToDraft({
  studentNumber: '2021-0001',
  subjects: [{ code: 'CS101', name: 'Computing', units: 3, days: 'MWF', startTime: '8:00AM', endTime: '9:30AM' }],
});
assert.equal(multiDay.subjects[0].schedule.length, 3, 'three meetings for MWF');
assert.deepEqual(multiDay.subjects[0].schedule.map(m => m.day.value), ['MONDAY', 'WEDNESDAY', 'FRIDAY']);
assert.ok(multiDay.subjects[0].schedule.every(m => m.time.start === '08:00' && m.time.end === '09:30'), 'times normalise to 24h on every meeting');
assert.equal(multiDay.validationIssues.filter(i => /no valid day/.test(i.message)).length, 0, 'a readable day column raises no day warning');
const unreadableDay = geminiResultToDraft({ subjects: [{ code: 'CS102', name: 'Data', units: 3, days: 'TBA', startTime: '8:00AM', endTime: '9:00AM' }] });
assert.equal(unreadableDay.validationIssues.filter(i => /no valid day/.test(i.message)).length, 1, 'an unreadable day column is still reported');
console.log('PASS COR day columns import every printed day (MW, MWF, M/W/F, TTh, TThS, Th, SAT)');
// Both extraction paths (the Gemini draft and the OCR text fallback) must read
// the same day column the same way, so neither can drift from the other again.
for (const printed of ['M', 'MW', 'MWF', 'M/W/F', 'TTh', 'TThS', 'MTWThF', 'MON WED FRI', 'Th', 'SAT', 'TBA', 'MW 8:00 AM']) {
  assert.deepEqual(parseDays(printed), parseDayTokens(printed), `shared parser agrees for "${printed}"`);
}
assert.deepEqual(parseDayIndexes('MWF'), [1, 3, 5], 'OCR path gets Monday/Wednesday/Friday');
assert.deepEqual(parseDayIndexes('TTh'), [2, 4], 'OCR path gets Tuesday/Thursday');
assert.deepEqual(parseDayIndexes('MW'), [1, 3], 'OCR path keeps a compact MW');
assert.deepEqual(parseDayIndexes('2:30 PM'), [], 'OCR path does not read a time as a day');
assert.deepEqual(parseDayIndexes('TBA'), [], 'OCR path does not read TBA as Tuesday');
console.log('PASS both extraction paths share one day parser (names and 1-7 indexes)');

// ---------------------------------------------------------------------------
// The class TIME must be the COR's own, not the app's invention.
// ---------------------------------------------------------------------------
// Regression: the window was resolved one value at a time, so a cell printing the
// marker once for the range ("1:00-2:30 PM") kept the start at its 12-hour face
// value — the class was stored as 01:00-14:30, a 13.5-hour window that also broke
// the overlap check, the "live now" state and the day's hour total. A bare
// "1:00-2:30" was silently assumed to be morning.
const printed = (overrides) => geminiResultToDraft({ subjects: [{ code: 'IT 301', name: 'Systems Integration', units: 3, days: 'MW', ...overrides }] }).subjects[0].schedule;
const everyMeeting = (schedule) => schedule.map((m) => `${m.time.start}-${m.time.end}`);

assert.deepEqual(
  everyMeeting(printed({ timeText: '1:00-2:30 PM', startTime: '1:00', endTime: '2:30 PM' })),
  ['13:00-14:30', '13:00-14:30'],
  'a marker printed once for the window resolves both ends'
);
assert.deepEqual(
  everyMeeting(printed({ timeText: '7:30AM-9:00AM', startTime: '7:30AM', endTime: '9:00AM' })),
  ['07:30-09:00', '07:30-09:00'],
  'a marker on both ends is trusted as printed'
);
assert.deepEqual(
  everyMeeting(printed({ startTime: '2:00', endTime: '3:30 PM' })),
  ['14:00-15:30', '14:00-15:30'],
  'the fields alone still share the marker when the text was not transcribed'
);
assert.deepEqual(
  everyMeeting(printed({ timeText: '11:00-1:00 PM', startTime: '11:00', endTime: '1:00 PM' })),
  ['11:00-13:00', '11:00-13:00'],
  'a shared marker never pushes the morning side past noon'
);
assert.deepEqual(
  everyMeeting(printed({ timeText: '0900-1030', startTime: null, endTime: null })),
  ['09:00-10:30', '09:00-10:30'],
  'the documented 4-digit shape reads as printed'
);
// The model transcribes; the parser decides. A model that "helpfully" resolves the
// marker itself must not be able to move the class: the printed text wins.
assert.deepEqual(
  everyMeeting(printed({ timeText: '1:00-2:30 PM', startTime: '01:00', endTime: '02:30' })),
  ['13:00-14:30', '13:00-14:30'],
  'the printed time outranks the model resolving the marker for us'
);

// No marker anywhere: the day is kept, the time is left UNSET and the student is
// asked — never 01:00 because classes are usually in the morning.
const guessed = geminiResultToDraft({ subjects: [{ code: 'IT 302', name: 'Networking', units: 3, days: 'TTh', startTime: '1:00', endTime: '2:30' }] });
assert.equal(guessed.subjects[0].schedule.length, 2, 'both days are kept');
assert.ok(guessed.subjects[0].schedule.every((m) => m.time.start === null && m.time.end === null), 'no time is invented');
assert.equal(guessed.subjects[0].schedule[0].time.sourceText, '1:00 - 2:30', 'the printed text is carried for the review step');
assert.equal(guessed.validationIssues.filter((i) => /AM\/PM marker could not be read/.test(i.message)).length, 1, 'the student is told which class needs a time');
console.log('PASS a printed class window is read from the COR, and an unreadable one asks instead of guessing');

// ---------------------------------------------------------------------------
// Confirm — the last click of onboarding must accept every day shape it can be
// handed, and must never answer with copy the student cannot act on.
// ---------------------------------------------------------------------------
// Regression: the confirm validator checked days against its own title-case
// table while the importer had just started writing canonical names, so EVERY
// confirm answered 400 "Invalid day: MONDAY". The onboarding page has no copy for
// a validation error and fell back to "We could not finish setting up your
// schedule. Your information is kept — try again." — the final click of
// onboarding dead-ended with nothing to retry against. Two more paths reached the
// same message: an empty `room` bag in the reviewed draft crashed the snapshot
// builder (500), and a stale earlier upload shadowed the newest pending record
// (409 "This COR import is no longer active.").
const confirmUser = Users.adopt({ userId: 'confirm-user', googleSub: 'confirm-sub', state: 'ONBOARDING', name: 'Confirm Student' });
const confirmRequest = async (path, body) => {
  const cookie = (await platformSessionHeader({ env, request: new Request('http://127.0.0.1') }, { ...confirmUser, ts: Date.now() })).split(';')[0];
  return { env, request: new Request('http://127.0.0.1' + path, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(body || {}) }) };
};
// Shaped like the reviewed draft: values wrapped by the review step, and the
// empty `room` object it sends when the COR printed no room.
const reviewedDraft = (day, code = 'IT 301') => ({
  studentInfo: { studentNumber: { value: '2026-0001' }, firstName: { value: 'Confirm' }, lastName: { value: 'Student' } },
  enrollmentInfo: { program: { value: 'BSIT' }, yearLevel: { value: '3' }, term: { value: 'First Semester 2026-2027' } },
  subjects: [{
    subjectCode: { value: code, confidence: 'high' },
    subjectName: { value: 'Systems Integration', confidence: 'high' },
    units: { value: '3' },
    schedule: [{ day: { value: day, confidence: 'high' }, time: { start: '08:00', end: '09:30' } }],
    room: {},
  }],
});
for (const [shape, day] of [['canonical name', 'MONDAY'], ['title-case name', 'Monday'], ['OCR Monday-first index', 1]]) {
  const record = CorRecords.create({ ownerUserId: confirmUser.userId, status: 'REVIEW_REQUIRED', filename: 'cor.jpg' });
  Users.update(confirmUser, { corRecordId: record.id });
  const draftForShape = reviewedDraft(day);
  CorDrafts.set(record.id, draftForShape);
  const response = await confirmPost(await confirmRequest('/api/v1/cor/confirm', { corRecordId: record.id, draft: draftForShape }));
  const body = await response.json();
  assert.equal(response.status, 200, `${shape} confirms — got ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  assert.equal(body.status, 'COMPLETE', `${shape} completes onboarding`);
  assert.equal(body.entryCount, 1, `${shape} writes one class`);
  assert.equal(Schedules.getById(body.scheduleId).isActive, true, `${shape} leaves one active schedule`);
  const entry = ScheduleEntries.getByScheduleId(body.scheduleId)[0];
  assert.equal(entry.dayOfWeek, 'MONDAY', `${shape} is stored canonically`);
  assert.equal(entry.dayLabel, 'Monday', `${shape} is stored in the display form every view compares`);
  assert.equal(entry.startTime, '08:00', `${shape} keeps a parseable clock time`);
  assert.equal(entry.locationText, null, 'an empty room bag is never stored as text');
  assert.equal(body.dashboardSnapshot.entries[0].day, 'Monday', `${shape} renders on the week table`);
  assert.equal(body.dashboardSnapshot.entries[0].notes, '', 'entry notes stay a string');
  assert.equal(confirmUser.state, 'ACTIVE', `${shape} activates the account`);
}
console.log('PASS confirm accepts canonical, title-case and numeric days and writes one readable week');

// The committed class keeps the COR's own window: an afternoon class must arrive
// as 13:00, not as 01:00, and a window that cannot run forward is refused.
const afternoon = CorRecords.create({ ownerUserId: confirmUser.userId, status: 'REVIEW_REQUIRED', filename: 'afternoon.jpg' });
Users.update(confirmUser, { corRecordId: afternoon.id });
const afternoonDraft = reviewedDraft('THURSDAY', 'IT 310');
afternoonDraft.subjects[0].schedule[0].time = { start: '13:00', end: '14:30' };
CorDrafts.set(afternoon.id, afternoonDraft);
const committed = await confirmPost(await confirmRequest('/api/v1/cor/confirm', { corRecordId: afternoon.id, draft: afternoonDraft }));
const committedBody = await committed.json();
assert.equal(committed.status, 200, `an afternoon class confirms — got ${committed.status} ${JSON.stringify(committedBody).slice(0, 160)}`);
const afternoonEntry = ScheduleEntries.getByScheduleId(committedBody.scheduleId)[0];
assert.equal(afternoonEntry.startTime, '13:00', 'the COR start time is what is stored');
assert.equal(afternoonEntry.endTime, '14:30', 'the COR end time is what is stored');

const backwards = CorRecords.create({ ownerUserId: confirmUser.userId, status: 'REVIEW_REQUIRED', filename: 'backwards.jpg' });
Users.update(confirmUser, { corRecordId: backwards.id });
const backwardsDraft = reviewedDraft('FRIDAY', 'IT 311');
backwardsDraft.subjects[0].schedule[0].time = { start: '14:30', end: '13:00' };
CorDrafts.set(backwards.id, backwardsDraft);
const refused = await confirmPost(await confirmRequest('/api/v1/cor/confirm', { corRecordId: backwards.id, draft: backwardsDraft }));
const refusedBody = await refused.json();
assert.equal(refused.status, 400, 'a window that does not run forward is refused');
assert.ok(refusedBody.issues.some((i) => /not after the start time/.test(i.message)), `the reason names the window: ${JSON.stringify(refusedBody.issues)}`);
console.log('PASS the confirmed class keeps the COR window and a backwards window is refused');

// A stale earlier upload must never shadow the import the student is looking at:
// sheet order is not chronology, and answering with the OLDEST pending record
// rejected the newest one as "no longer active".
const stale = CorRecords.create({ ownerUserId: confirmUser.userId, status: 'REVIEW_REQUIRED', filename: 'stale.jpg' });
CorRecords.update(stale, { createdAt: '2026-01-01T00:00:00.000Z' });
const fresh = CorRecords.create({ ownerUserId: confirmUser.userId, status: 'REVIEW_REQUIRED', filename: 'fresh.jpg' });
assert.equal(CorRecords.getActiveByUserId(confirmUser.userId).id, fresh.id, 'the newest pending import wins');
const freshDraft = reviewedDraft('TUESDAY', 'IT 302');
CorDrafts.set(fresh.id, freshDraft);
const resumed = await confirmPost(await confirmRequest('/api/v1/cor/confirm', { corRecordId: fresh.id, draft: freshDraft }));
assert.equal(resumed.status, 200, `an abandoned earlier import does not block the current one — got ${resumed.status}`);
assert.equal((await resumed.json()).status, 'COMPLETE');
console.log('PASS the newest pending import is the one confirmed');

// A confirm that died half-way leaves the record at COMMITTING. That must be
// retryable: it is the state the failed click itself produced, and refusing it
// left those students with no button that could finish their setup.
const interrupted = CorRecords.create({ ownerUserId: confirmUser.userId, status: 'REVIEW_REQUIRED', filename: 'interrupted.jpg' });
Users.update(confirmUser, { corRecordId: interrupted.id });
const interruptedDraft = reviewedDraft('WEDNESDAY', 'IT 304');
CorDrafts.set(interrupted.id, interruptedDraft);
// What the crashed attempt left behind: status advanced, nothing written.
CorRecords.update(interrupted, { status: 'COMMITTING' });
const retried = await confirmPost(await confirmRequest('/api/v1/cor/confirm', { corRecordId: interrupted.id, draft: interruptedDraft }));
assert.equal(retried.status, 200, `an interrupted confirm can be retried — got ${retried.status} ${JSON.stringify(await retried.clone().json()).slice(0, 160)}`);
const retriedBody = await retried.json();
assert.equal(retriedBody.status, 'COMPLETE');
assert.equal(retriedBody.entryCount, 1);
assert.equal(CorRecords.getById(interrupted.id).status, 'COMPLETE');
console.log('PASS an interrupted confirm (COMMITTING) is retryable instead of blocking the student');

// Days spelled differently are the same day: the conflict check must still fire.
const conflict = CorRecords.create({ ownerUserId: confirmUser.userId, status: 'REVIEW_REQUIRED', filename: 'clash.jpg' });
Users.update(confirmUser, { corRecordId: conflict.id });
const clashDraft = reviewedDraft('TUESDAY');
clashDraft.subjects.push({
  subjectCode: { value: 'IT 303' }, subjectName: { value: 'Networking' }, units: { value: '3' },
  schedule: [{ day: { value: 'Tuesday' }, time: { start: '09:00', end: '10:30' } }], room: {},
});
CorDrafts.set(conflict.id, clashDraft);
const rejectedClash = await confirmPost(await confirmRequest('/api/v1/cor/confirm', { corRecordId: conflict.id, draft: clashDraft }));
const clashBody = await rejectedClash.json();
assert.equal(rejectedClash.status, 400);
assert.equal(clashBody.status, 'VALIDATION_ERROR');
assert.ok(clashBody.issues.some(i => /Schedule conflict/.test(i.message)), `clash reported: ${JSON.stringify(clashBody.issues)}`);
// A day nobody can read is still reported rather than silently invented.
clashDraft.subjects[1].schedule[0].day = { value: 'Funday' };
const unknownDay = await confirmPost(await confirmRequest('/api/v1/cor/confirm', { corRecordId: conflict.id, draft: clashDraft }));
assert.ok((await unknownDay.json()).issues.some(i => /Unknown day: Funday/.test(i.message)), 'an unreadable day is named');
console.log('PASS overlaps are caught across day spellings and unreadable days are named');

// And the student must be shown that reason instead of the generic copy.
const rejectedDraft = await harness({ status: 'EXTRACTED', corRecordId: 'cor-test', result: draft }, 'WELCOME', {
  '/api/v1/cor/confirm': { status: 'VALIDATION_ERROR', error: 'Please fix the following issues before confirming.', issues: [{ field: 'subjects[0].schedule[0].day', message: 'Unknown day: MONDAY' }] },
});
await rejectedDraft.c.uploadCor();
await rejectedDraft.c.saveAndConfirm();
await rejectedDraft.c.confirmAndActivate();
assert(rejectedDraft.get('step-confirm').classList.contains('active'), 'a rejected confirm keeps the student on the last step');
assert.match(rejectedDraft.get('confirm-error').textContent, /Unknown day: MONDAY/, `shown: ${rejectedDraft.get('confirm-error').textContent}`);
console.log('PASS a rejected confirm names the reason instead of generic copy');

// ---------------------------------------------------------------------------
// Review: the student can correct a day or a time, and what they save is what
// the schedule gets.
// ---------------------------------------------------------------------------
// The review step used to print the detected day and time and nothing else, so a
// class the extractor misread could only be fixed later in the Schedule page. A
// meeting whose AM/PM could not be read arrives with no time at all, and editing
// it here is what turns "the app invented a time" into a checkable value.
const reviewDraft = (schedule) => ({
  studentInfo: { firstName: { value: 'Test' }, lastName: { value: 'Student' }, studentNumber: { value: '123' } },
  enrollmentInfo: { program: { value: 'BSCS' }, yearLevel: { value: 1 }, term: { value: 'First' } },
  subjects: [{ subjectCode: { value: 'CS101' }, subjectName: { value: 'Computing' }, units: { value: 3 }, schedule, room: {} }],
});
const editor = (key, part, value) => {
  const el = element();
  el.value = value;
  el.classList.add(part === 'day' ? 'meeting-day' : 'meeting-time');
  el.setAttribute('data-meeting', key);
  if (part !== 'day') el.setAttribute('data-part', part);
  return el;
};
const withResult = (result) => ({ '/api/v1/cor/result': { status: 'OK', hasResult: true, result } });

const unresolved = reviewDraft([{ day: { value: 'TUESDAY' }, time: { start: null, end: null, sourceText: '1:00-2:30' } }]);
const corrected = await harness({ status: 'EXTRACTED', corRecordId: 'cor-test', result: unresolved }, 'WELCOME', withResult(unresolved), [
  editor('0-0', 'day', 'WEDNESDAY'), editor('0-0', 'start', '13:00'), editor('0-0', 'end', '14:30'),
]);
await corrected.c.uploadCor();
await corrected.c.saveAndConfirm();
assert(corrected.get('step-confirm').classList.contains('active'), 'a corrected class saves and reaches the confirm step');
const savedSubjects = JSON.parse(corrected.calls.find(x => x.url.endsWith('/review')).options.body).subjects;
assert.equal(savedSubjects[0].schedule[0].day.value, 'WEDNESDAY', 'the corrected day is saved');
assert.equal(savedSubjects[0].schedule[0].time.start, '13:00', 'the corrected start time is saved');
assert.equal(savedSubjects[0].schedule[0].time.end, '14:30', 'the corrected end time is saved');
console.log('PASS a class corrected in the review step is what gets saved');

// A class the extractor could not read is finished on this step, not sent on: the
// message names it instead of saving a blank day or a backwards window.
const noDay = reviewDraft([{ day: { value: null }, time: { start: '08:00', end: '09:30' } }]);
const blockedDay = await harness({ status: 'EXTRACTED', corRecordId: 'cor-test', result: noDay }, 'WELCOME', withResult(noDay));
await blockedDay.c.uploadCor();
await blockedDay.c.saveAndConfirm();
assert(blockedDay.get('step-review').classList.contains('active'), 'the student stays on the review step');
assert(!blockedDay.calls.some(x => x.url.endsWith('/review')), 'nothing is saved without a day');
assert.match(blockedDay.get('review-error').textContent, /choose the day/, `shown: ${blockedDay.get('review-error').textContent}`);

const backwardsReview = reviewDraft([{ day: { value: 'MONDAY' }, time: { start: '14:30', end: '13:00' } }]);
const blockedWindow = await harness({ status: 'EXTRACTED', corRecordId: 'cor-test', result: backwardsReview }, 'WELCOME', withResult(backwardsReview));
await blockedWindow.c.uploadCor();
await blockedWindow.c.saveAndConfirm();
assert(!blockedWindow.calls.some(x => x.url.endsWith('/review')), 'a window that runs backwards is not saved');
assert.match(blockedWindow.get('review-error').textContent, /end time must be after the start time/, `shown: ${blockedWindow.get('review-error').textContent}`);

const halfWindow = reviewDraft([{ day: { value: 'MONDAY' }, time: { start: '13:00', end: null } }]);
const blockedHalf = await harness({ status: 'EXTRACTED', corRecordId: 'cor-test', result: halfWindow }, 'WELCOME', withResult(halfWindow));
await blockedHalf.c.uploadCor();
await blockedHalf.c.saveAndConfirm();
assert(!blockedHalf.calls.some(x => x.url.endsWith('/review')), 'half a window is not saved');
assert.match(blockedHalf.get('review-error').textContent, /set the end time as well/, `shown: ${blockedHalf.get('review-error').textContent}`);
console.log('PASS an unreadable day, a backwards window and half a window are finished on the review step, not saved');

