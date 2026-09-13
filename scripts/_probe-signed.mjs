// Show the raw Apps Script response for a signed call to diagnose INTERNAL_ERROR.
import { loadEnv } from './_sheets-client.mjs';
import { createHmac, randomUUID } from 'node:crypto';

const env = await loadEnv();
const url = new URL(env.APPS_SCRIPT_URL);
url.searchParams.set('action', 'admin.access');
const canonical = JSON.stringify({ action: 'admin.access', payload: {}, actor: { googleSub: 'probe', email: 'probe@example.test', emailVerified: false, issuedAt: Date.now() }, nonce: randomUUID(), timestamp: new Date().toISOString() });
const signature = createHmac('sha256', env.APPS_SCRIPT_SECRET).update(canonical).digest('hex');
const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canonical, signature }), signal: AbortSignal.timeout(60000), redirect: 'follow' });
console.log('HTTP', response.status);
console.log((await response.text()).slice(0, 800));
