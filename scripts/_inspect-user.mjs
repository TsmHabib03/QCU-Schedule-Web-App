// Check what the Apps Script sees for given googleSubs (login-path view).
import { loadEnv } from './_sheets-client.mjs';
import { callAction } from '../functions/api/repo/sheets-adapter.js';

const env = await loadEnv();
for (const sub of process.argv.slice(2)) {
  const actor = { googleSub: sub, email: 'probe@example.test', emailVerified: true, issuedAt: Date.now() };
  try {
    const snap = await callAction(env, 'snapshot.read', actor, { kinds: ['users'] });
    const rows = snap.entities?.users || [];
    console.log(sub, '=> isNew:', snap.isNew, 'rows:', JSON.stringify(rows.map(r => ({ userId: r.userId, status: r.accountStatus, purgedAt: r.purgedAt, email: r.email, revoked: r.sessionsRevokedAt }))));
  } catch (error) {
    console.log(sub, '=> ERROR', error.code, error.message);
  }
}
