import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const child = spawn(process.execPath, ['scripts/dev-server.mjs'], {
  windowsHide: true,
  env: { ...process.env, PORT: String(port), APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', GOOGLE_SESSION_SECRET: 'route-test-only-session-secret', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = new Promise(resolve => child.once('exit', resolve));
child.stderr.on('data', () => {});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Development server did not start')), 10000);
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('development server:')) { clearTimeout(timer); resolve(); }
    });
  });
  for (const [path, status, type, text] of [
    ['/missing/nested/page', 404, 'text/html', /We couldn't find that page/],
    ['/api/unknown', 404, 'application/json', /NOT_FOUND/],
    ['/assets/js/missing.js', 404, 'text/plain', /Resource not found/],
    ['/%E0%A4%A', 400, 'text/html', /Check the page address/],
    ['/onboarding.html', 200, 'text/html', /Upload your COR/],
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status, status, path);
    assert(response.headers.get('Content-Type').includes(type), path);
    assert.match(await response.text(), text, path);
  }
  console.log('PASS real development-server nested 404, missing API/asset, invalid address, and onboarding routes');
} finally {
  child.kill();
  await exited;
}
