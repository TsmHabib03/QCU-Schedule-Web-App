// Browser UX checks with synthetic API replies; never uploads student files.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { pageErrorResponse } from '../functions/_errors.js';

const root = resolve('.');
const output = resolve(tmpdir(), 'qcu-cor-ux-checks');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  if (path === '/unavailable') {
    const error = pageErrorResponse();
    res.writeHead(error.status, Object.fromEntries(error.headers)).end(await error.text());
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': (mime[extname(file)] || 'application/octet-stream') + '; charset=utf-8' }).end(content);
  } catch { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(await readFile(resolve(root, '404.html'))); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const draft = {
  studentInfo: { studentNumber: '2026-12345', firstName: 'Niño', middleName: '李', lastName: 'Dela Cruz', suffix: '' },
  enrollmentInfo: { program: 'BSCS', yearLevel: 2, term: 'First semester 2026–2027', campus: 'San Bartolome', section: 'SBCS2A' },
  subjects: [{ subjectCode: 'CS101', subjectName: 'Computing & Society <intro>', units: 3, confidence: 'medium', schedule: [{ day: 'Monday', time: { start: '08:00', end: '09:30' } }] }],
};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  let stage = 'WELCOME', statusCode = 200, sessionCode = 200, reviewCode = 200, confirmSucceeds = false;
  let importStatus = 'REVIEW_REQUIRED', hasImport = true, abortUpload = false, uploadGate = null;
  let statusGate = null, calls = [], statusReply = null, bootstrapCode = 200, completeCode = 503, completeGate = null;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    calls.push({ path: url.pathname, body: route.request().postData(), id: route.request().headers()['x-request-id'] });
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname.endsWith('/session')) return reply(sessionCode === 200 ? { status: 'OK', user: { userId: 'ux-student', name: 'Niño & 李 ' + 'Student '.repeat(12) } } : { status: sessionCode === 403 ? 'FORBIDDEN' : 'SERVICE_UNAVAILABLE' }, sessionCode);
    if (url.pathname.endsWith('/bootstrap')) return reply(bootstrapCode === 200 ? { authenticated: false } : { status: 'SERVICE_UNAVAILABLE' }, bootstrapCode);
    if (url.pathname.endsWith('/auth/complete')) {
      if (completeGate) await completeGate;
      return reply(completeCode === 200 ? { status: 'OK', destination: '/onboarding.html' } : { status: 'SERVICE_UNAVAILABLE' }, completeCode);
    }
    if (url.pathname.endsWith('/onboarding/status')) return reply({ status: 'OK', stage, corRecordId: stage === 'WELCOME' ? null : 'cor-ux' });
    if (url.pathname.endsWith('/cor/upload')) {
      if (uploadGate) await uploadGate;
      if (abortUpload) return route.abort('failed');
      return reply({ status: 'EXTRACTED', corRecordId: 'cor-ux', result: draft });
    }
    if (url.pathname.endsWith('/cor/status')) {
      if (statusGate) await statusGate;
      return reply(statusReply || (statusCode === 200 ? { status: 'OK', hasImport, importStatus, corRecordId: hasImport ? 'cor-ux' : null } : { status: 'SERVICE_UNAVAILABLE' }), statusCode);
    }
    if (url.pathname.endsWith('/result')) return reply({ status: 'OK', hasResult: true, result: draft });
    if (url.pathname.endsWith('/review')) return reply({ status: reviewCode === 200 ? 'OK' : 'UNAUTHORIZED' }, reviewCode);
    if (url.pathname.endsWith('/cancel')) return reply({ status: 'CANCELLED' });
    if (url.pathname.endsWith('/confirm')) {
      importStatus = 'COMPLETE';
      if (confirmSucceeds) return reply({ status: 'COMPLETE', corRecordId: 'cor-ux' });
      return route.abort('failed');
    }
    if (url.pathname.endsWith('/process')) return reply({ status: 'REVIEW_REQUIRED', result: draft });
    return reply({ status: 'OK', data: [] });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const active = step => page.locator('#step-' + step).waitFor({ state: 'visible' });
  const message = id => page.locator('#' + id).innerText();
  async function noOverflow() {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page overflow');
  }
  async function selectFile(file) {
    await page.locator('#file-input').evaluate((input, spec) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([spec.bytes], spec.name, { type: spec.type, lastModified: 42 }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, file);
  }
  const validFile = { name: 'COR Niño 李.PDF', type: '', bytes: '%PDF-1.4 synthetic' };

  sessionCode = 503;
  await page.goto(origin + '/onboarding.html');
  await page.locator('#processing-retry').waitFor({ state: 'visible' });
  assert.match(await message('processing-message'), /could not check your session/i);
  sessionCode = 200;
  await page.locator('#processing-retry').click();
  await active('welcome');
  await page.locator('#welcome-start-btn').click();
  await active('upload');
  assert.equal(await page.locator('#step-upload h2').evaluate(el => document.activeElement === el), true);
  await page.locator('#upload-zone').focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles([]);
  await selectFile({ ...validFile, bytes: '' });
  assert.match(await message('upload-error'), /empty/i);
  await selectFile({ ...validFile, name: 'cor.txt', type: 'text/plain' });
  assert.match(await message('upload-error'), /PDF, JPG, or PNG/);
  assert(await page.locator('#upload-btn').isDisabled());
  assert.equal(calls.filter(call => call.path.endsWith('/upload')).length, 0);
  await selectFile(validFile);
  assert(!(await page.locator('#upload-btn').isDisabled()), 'A valid PDF with no MIME can be selected');
  assert.match(await message('file-name'), /Niño 李/);
  console.log('PASS session retry, keyboard file chooser, empty/invalid files, missing MIME and Unicode filename');

  let release;
  uploadGate = new Promise(resolve => { release = resolve; });
  abortUpload = true;
  await page.locator('#upload-btn').click();
  await page.waitForFunction(() => document.getElementById('upload-btn').disabled);
  assert(await page.locator('#upload-back').isDisabled());
  assert(await page.locator('#upload-remove').isDisabled());
  assert.equal(await page.locator('#upload-progress-bar').getAttribute('role'), 'progressbar');
  await page.evaluate(() => uploadCor());
  release();
  await active('review');
  assert.equal(calls.filter(call => call.path.endsWith('/upload')).length, 1);
  assert.equal(await page.getByLabel('Program *', { exact: true }).inputValue(), 'BSCS');
  assert.match(await message('subject-list'), /Computing & Society <intro>/);
  assert.equal(await page.locator('#subject-list script').count(), 0);
  await page.getByLabel('First Name *', { exact: true }).fill('Zoë & <李>');
  await page.getByLabel('Middle Name', { exact: true }).fill('');
  await page.getByLabel('Program *', { exact: true }).fill('BSIT');
  stage = 'REVIEW';
  await page.reload();
  await active('review');
  assert.equal(await page.locator('#review-firstName').inputValue(), 'Zoë & <李>');
  assert.equal(await page.locator('#review-middleName').inputValue(), '');
  assert.equal(await page.locator('#review-program').inputValue(), 'BSIT');
  console.log('PASS interrupted upload recovers saved result once; unsaved edits, cleared values and program corrections survive reload');

  reviewCode = 401;
  await page.locator('#review-save-btn').click();
  await page.locator('#processing-sign-in').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#processing-sign-in').getAttribute('href'), '/api/auth/google/start?returnTo=%2Fonboarding.html');
  reviewCode = 200;
  await page.reload();
  await active('review');
  assert.equal(await page.locator('#review-firstName').inputValue(), 'Zoë & <李>');
  await page.locator('#review-firstName').fill('');
  await page.locator('#review-save-btn').click();
  assert.equal(await page.locator('#review-firstName').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#review-firstName').evaluate(el => el === document.activeElement), true);
  await page.locator('#review-firstName').fill('Zoë & <李>');
  await page.locator('#review-save-btn').click();
  await active('confirm');
  const saved = JSON.parse(calls.filter(call => call.path.endsWith('/review')).at(-1).body);
  assert.equal(saved.enrollmentInfo.program.value, 'BSIT');
  await page.locator('#confirm-btn').click();
  // A lost confirm response (network abort) must keep the user on the confirm
  // step with their draft intact — never bounce back to review or assume success.
  await page.locator('#confirm-error').waitFor({ state: 'visible' });
  assert(await page.locator('#step-confirm').isVisible());
  assert.match(await message('confirm-error'), /kept|try again/i);
  // A retry that succeeds completes the flow.
  confirmSucceeds = true;
  await page.locator('#confirm-btn').click();
  await active('success');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('qcu-cor-draft')), null);
  console.log('PASS lost confirm response stays on confirm with draft kept; retry completes');

  stage = 'PROCESSING'; importStatus = 'PROCESSING'; statusCode = 503;
  await page.reload();
  await page.locator('#processing-retry').waitFor({ state: 'visible' });
  assert.match(await message('processing-message'), /could not check/i);
  statusCode = 200; importStatus = 'REVIEW_REQUIRED';
  let releaseStatus;
  statusGate = new Promise(resolve => { releaseStatus = resolve; });
  const beforeRetry = calls.filter(call => call.path.endsWith('/cor/status')).length;
  await page.locator('#processing-retry').click();
  await page.evaluate(() => resumeProcessing());
  releaseStatus();
  await active('review');
  statusGate = null;
  assert.equal(calls.filter(call => call.path.endsWith('/cor/status')).length, beforeRetry + 1);

  // An upload whose save is unknown keeps the same ID when the same file is selected.
  await page.evaluate(() => sessionStorage.clear());
  stage = 'WELCOME'; hasImport = false; uploadGate = null; abortUpload = true;
  await page.reload(); await active('welcome');
  await page.locator('#welcome-start-btn').click();
  await selectFile(validFile); await page.locator('#upload-btn').click();
  await page.locator('#processing-select-file').waitFor({ state: 'visible' });
  const firstId = calls.filter(call => call.path.endsWith('/upload')).at(-1).id;
  await page.locator('#processing-select-file').click();
  await selectFile(validFile); await page.locator('#upload-btn').click();
  await page.locator('#processing-select-file').waitFor({ state: 'visible' });
  assert.equal(calls.filter(call => call.path.endsWith('/upload')).at(-1).id, firstId);
  console.log('PASS failed polling stops with recovery, duplicate retry is guarded, and unknown uploads reuse their request ID');

  sessionCode = 403;
  await page.reload();
  await active('processing');
  assert.match(await message('processing-message'), /administrator/);
  assert(await page.locator('#processing-retry').isHidden());
  assert(await page.locator('#processing-select-file').isHidden());
  sessionCode = 200;

  // Bounded visual batch: the same key states at desktop and narrow mobile.
  await page.evaluate(() => sessionStorage.clear());
  stage = 'REVIEW'; hasImport = true; statusCode = 200; importStatus = 'REVIEW_REQUIRED';
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/onboarding.html'); await active('review');
    await noOverflow();
    assert((await page.locator('#review-firstName').evaluate(el => parseFloat(getComputedStyle(el).fontSize))) >= 16);
    await page.screenshot({ path: resolve(output, `review-${width}.png`), fullPage: true });
    await page.locator('#review-back').click();
    await active('upload');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('qcu-cor-request')), null);
    await selectFile({ ...validFile, name: 'COR-' + 'Long-name-'.repeat(25) + '李.PDF' });
    await noOverflow();
    await page.screenshot({ path: resolve(output, `upload-${width}.png`), fullPage: true });
    const missing = await page.goto(origin + '/old/link/no-longer-here');
    assert.equal(missing.status(), 404);
    assert.equal(await page.getByRole('link', { name: 'Continue COR upload' }).getAttribute('href'), '/onboarding.html');
    assert((await page.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)));
    await noOverflow(); await page.screenshot({ path: resolve(output, `404-${width}.png`), fullPage: true });
    const unavailable = await page.goto(origin + '/unavailable');
    assert.equal(unavailable.status(), 503);
    await page.getByRole('button', { name: 'Try again' }).waitFor({ state: 'visible' });
    await noOverflow(); await page.screenshot({ path: resolve(output, `exception-${width}.png`), fullPage: true });
    await page.goto(origin + '/offline.html');
    await noOverflow(); await page.screenshot({ path: resolve(output, `offline-${width}.png`), fullPage: true });
  }
  bootstrapCode = 503;
  await page.goto(origin + '/');
  await page.locator('#auth-retry').waitFor({ state: 'visible' });
  assert.match(await message('auth-error-msg'), /could not check your account/);
  await page.goto(origin + '/?auth=finishing');
  await page.waitForFunction(() => document.getElementById('auth-finish-message').textContent.includes('could not finish'));
  assert(await page.locator('#google-login-btn').isHidden());
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
    await page.screenshot({ path: resolve(output, `finish-login-${width}.png`), fullPage: true });
  }
  completeCode = 200;
  let releaseLogin;
  completeGate = new Promise(resolve => { releaseLogin = resolve; });
  const completionCount = calls.filter(call => call.path.endsWith('/auth/complete')).length;
  await page.locator('#auth-finish-retry').click();
  await page.locator('#auth-finish-retry').evaluate(button => button.click());
  releaseLogin();
  await page.waitForURL('**/onboarding.html');
  await active('review');
  assert.equal(calls.filter(call => call.path.endsWith('/auth/complete')).length, completionCount + 1);
  console.log('PASS login completion recovery, duplicate retry protection and direct onboarding reauthentication');
  assert.deepEqual(errors, []);
  console.log('PASS account restriction, home retry, nested 404, page exception and desktop/mobile layouts');
  console.log(`Screenshots: ${output}`);
  await context.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
