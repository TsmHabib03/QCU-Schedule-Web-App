// Synthetic Google + real Functions + Apps Script emulator. No live sign-ins.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadAppsScript, parseOutput } from './_apps-script-emulator.mjs';
import { onRequestGet as start } from '../functions/api/auth/google/start.js';
import { onRequestGet as callback } from '../functions/api/auth/google/callback.js';
import { onRequestPost as complete } from '../functions/api/auth/complete.js';
import { onRequestGet as sessionRead } from '../functions/api/auth/session.js';
import { readPlatformSession, pendingLoginHeader, clearAllAuthCookies } from '../functions/api/auth/_lib.js';
import { callAction } from '../functions/api/repo/sheets-adapter.js';

const origin = 'https://portal.test';
const env = { GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-client-secret',
  GOOGLE_SESSION_SECRET: 'synthetic-login-cookie-secret', GOOGLE_PUBLIC_ORIGIN: origin,
  APPS_SCRIPT_URL: 'https://sheets.test/', APPS_SCRIPT_SECRET: 'synthetic-login-signing-secret' };
const gs = await loadAppsScript({ repoRoot: resolve('.'), secret: env.APPS_SCRIPT_SECRET });
gs.setupDatabase();
const originalFetch = globalThis.fetch;
let subject = 'first-student', readFailures = 0, dropWrite = false, badSignature = false, exchanges = 0;
const commands = [];
globalThis.fetch = async (url, init) => {
  if (String(url) === env.APPS_SCRIPT_URL) {
    const command = JSON.parse(JSON.parse(init.body).canonical);
    commands.push(command);
    if (badSignature) return Response.json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid signature' } });
    if (command.action === 'snapshot.read' && readFailures-- > 0) return new Response('Synthetic database cold start', { status: 503 });
    const output = parseOutput(gs.doPost({ postData: { contents: init.body } }));
    if (command.action === 'batch.write' && dropWrite) { dropWrite = false; throw Error('Saved response lost'); }
    return Response.json(output);
  }
  if (String(url) === 'https://oauth2.googleapis.com/token') {
    exchanges++;
    return Response.json({ access_token: 'large-access-token-'.repeat(500), refresh_token: 'large-refresh-token-'.repeat(500), expires_in: 3600 });
  }
  assert.equal(String(url), 'https://openidconnect.googleapis.com/v1/userinfo');
  return Response.json({ sub: subject, email: subject + '@example.test', email_verified: true, name: 'Niño & 李', picture: '' });
};
function cookies(response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }
async function login(returnTo = '/') {
  const response = await start({ env, request: new Request(origin + '/api/auth/google/start?returnTo=' + encodeURIComponent(returnTo)) });
  assert.equal(response.status, 200);
  const html = await response.text();
  const target = new URL(JSON.parse(html.match(/window\.location\.replace\(("[\s\S]*?")\)/)[1]));
  return { env, request: new Request(origin + '/api/auth/google/callback?state=' + target.searchParams.get('state') + '&code=synthetic-code', { headers: { Cookie: cookies(response) } }) };
}
function resume(cookie, requestOrigin = origin) {
  return complete({ env, request: new Request(origin + '/api/auth/complete', { method: 'POST', headers: { Origin: requestOrigin, Cookie: cookie } }) });
}
try {
  const canonical = await start({ env, request: new Request('https://preview.test/api/auth/google/start?returnTo=%2Fonboarding.html') });
  assert.equal(canonical.status, 302);
  assert.equal(canonical.headers.get('Location'), origin + '/api/auth/google/start?returnTo=%2Fonboarding.html');
  assert.equal(canonical.headers.get('Set-Cookie'), null, 'Do not set state on the wrong origin');
  let response = await callback(await login('/onboarding.html'));
  assert.equal(response.headers.get('Location'), '/onboarding.html');
  const issued = response.headers.getSetCookie().find(value => value.startsWith('qcu_platform_session='));
  assert(issued.length < 2000, 'A first login with very large Google tokens still has a small cookie');
  const session = await readPlatformSession({ env, request: new Request(origin, { headers: { Cookie: issued } }) });
  assert.equal(session.googleSub, subject);
  assert.equal(session.accessToken, undefined);
  assert.equal(session.refreshToken, undefined);
  assert.equal((await sessionRead({ env, request: new Request(origin + '/api/auth/session', { headers: { Cookie: issued } }) })).status, 200);
  assert.equal(exchanges, 1);
  console.log('PASS first login, canonical-origin cookie handoff, large Google tokens and small usable platform session');

  subject = 'cold-start-student'; readFailures = 1;
  response = await callback(await login());
  assert.equal(response.headers.get('Location'), '/?auth=onboarding', 'A transient read failure recovers within the first login');
  const reads = commands.filter(command => command.action === 'snapshot.read' && command.actor.googleSub === subject);
  assert.equal(reads.length, 2);
  assert.notEqual(reads[0].nonce, reads[1].nonce, 'Read retries need fresh signed nonces');

  subject = 'pending-student'; readFailures = 2;
  const priorExchanges = exchanges;
  response = await callback(await login('/onboarding.html'));
  assert.equal(response.headers.get('Location'), '/?auth=finishing');
  assert(!response.headers.getSetCookie().some(value => value.startsWith('qcu_platform_session=')));
  const pending = cookies(response);
  assert.equal((await resume(pending, 'https://unrelated.test')).status, 403);
  assert.equal((await resume('')).status, 401);
  response = await resume(pending);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).destination, '/onboarding.html');
  assert.equal(exchanges, priorExchanges + 1, 'Database recovery does not require a second Google exchange');
  assert(response.headers.getSetCookie().some(value => value.startsWith('qcu_login_pending=;') && value.includes('Max-Age=0')));
  assert(clearAllAuthCookies(new Request(origin)).some(value => value.startsWith('qcu_login_pending=;')));
  const oldIdentity = { googleSub: subject, email: subject + '@example.test', emailVerified: true, issuedAt: Date.now() - 601000 };
  assert.equal((await resume(await pendingLoginHeader({ env, request: new Request(origin) }, oldIdentity))).status, 401);
  assert.equal((await resume(await pendingLoginHeader({ env, request: new Request(origin) }, { ...oldIdentity, issuedAt: Date.now(), emailVerified: false }))).status, 401);
  console.log('PASS bounded read retry, pending verified login, same-origin enforcement, expiry and no second Google sign-in');

  subject = 'lost-login-response'; dropWrite = true;
  response = await callback(await login());
  assert.equal(response.headers.get('Location'), '/?auth=onboarding');
  assert.equal(commands.filter(command => command.action === 'batch.write' && command.actor.googleSub === subject).length, 1);
  assert.equal((await callAction(env, 'snapshot.read', { googleSub: subject, issuedAt: Date.now() })).entities.users.length, 1);
  badSignature = true;
  const unavailable = await sessionRead({ env, request: new Request(origin + '/api/auth/session', { headers: { Cookie: issued } }) });
  assert.equal(unavailable.status, 503, 'Server signing problems are not student session expiry');
  badSignature = false;
  console.log('PASS lost login save response reconciles without duplicate writes; server credential failures are not false session expiry');

  const invalid = await callback({ env, request: new Request(origin + '/api/auth/google/callback?state=wrong&code=unused') });
  assert.match(invalid.headers.get('Location'), /state_mismatch/);
} finally { globalThis.fetch = originalFetch; }
