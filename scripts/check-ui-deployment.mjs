// Read-only production checks; never signs in or writes student records.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const origin = process.argv[2] || 'https://qcu-schedule-web-app.pages.dev';
const root = new URL('../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), {
    cache: 'no-store', signal: AbortSignal.timeout(35000), ...options,
  });
  assert(response.ok || options.redirect === 'manual', `${path}: HTTP ${response.status}`);
  return response;
}

const files = [
  'settings.html', 'campus-eta.html', 'service-worker.js',
  'assets/js/app.js', 'assets/js/settings.js', 'assets/js/google-connection.js',
  'assets/js/eta.js', 'assets/css/settings.css', 'assets/css/soft-ui.css',
  'assets/css/eta.css',
];
await Promise.all(files.map(async path => {
  const [response, local] = await Promise.all([request('/' + path), readFile(new URL(path, root))]);
  const remote = Buffer.from(await response.arrayBuffer());
  assert.equal(sha(remote), sha(local), `${path}: deployed contents differ from local release`);
  console.log(`PASS live release matches ${path}`);
}));

const health = await (await request('/api/v1/health')).json();
assert.equal(health.status, 'OK');
assert.equal(health.persistence, 'sheets');
for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_SESSION_SECRET', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_SECRET']) {
  assert.equal(health.env[key], 'set', `${key} must be configured`);
}
console.log('PASS production Functions have Sheets and OAuth configuration');

assert.equal(health.env.GOOGLE_PUBLIC_ORIGIN, origin);
// Integration endpoints require a platform session before their handlers run.
// An anonymous check verifies that gate; it cannot exercise a live OAuth exchange.
for (const path of ['/api/google/status', '/api/google/callback']) {
  const response = await request(path, { redirect: 'manual' });
  assert.equal(response.status, 401, `${path}: anonymous access must be refused`);
  const result = await response.json();
  assert.equal(result.error, 'Sign in first.');
  console.log(`PASS ${path} requires platform sign-in`);
}

const retired = await request('/google.html', { redirect: 'manual' });
assert([404, 410].includes(retired.status), `Retired page unexpectedly returned ${retired.status}`);
console.log('PASS standalone Google Integration page is retired');
